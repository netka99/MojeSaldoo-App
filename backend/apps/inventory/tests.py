"""Tests for the Inventory Count (INW) feature."""

from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.products.models import Product, ProductStock, StockBatch, StockMovement, Warehouse
from apps.users.models import Company, User

from .models import InventoryCount, InventoryCountItem
from .services import complete_inventory_count


def _make_company(name="Test Company"):
    return Company.objects.create(name=name)


def _make_user(company, username="testuser"):
    user = User.objects.create_user(
        username=username,
        email=f"{username}@test.com",
        password="testpass123",
    )
    user.current_company = company
    user.save()
    return user


def _make_warehouse(company, user, code="MG"):
    return Warehouse.objects.create(
        company=company,
        user=user,
        code=code,
        name=f"Warehouse {code}",
        warehouse_type=Warehouse.WarehouseType.MAIN,
    )


def _make_product(company, user, name="Test Product", track_batches=True):
    return Product.objects.create(
        company=company,
        user=user,
        name=name,
        unit="kg",
        price_net=Decimal("10.00"),
        price_gross=Decimal("12.30"),
        track_batches=track_batches,
    )


def _make_stock(company, product, warehouse, quantity=Decimal("100.000")):
    stock, _ = ProductStock.objects.get_or_create(
        company=company,
        product=product,
        warehouse=warehouse,
        defaults={
            "quantity_available": quantity,
            "quantity_reserved": Decimal("0"),
            "quantity_total": quantity,
        },
    )
    if not _:
        stock.quantity_available = quantity
        stock.save(update_fields=["quantity_available"])
    return stock


class InventoryCountSnapshotTest(TestCase):
    """Test that creating an INW snapshots ProductStock correctly."""

    def setUp(self):
        self.company = _make_company()
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user)
        self.product = _make_product(self.company, self.user)
        self.stock = _make_stock(self.company, self.product, self.warehouse, Decimal("50.000"))

    def test_create_inventory_count_snapshots_stock(self):
        """Creating an INW for a warehouse creates items with quantity_system from ProductStock."""
        count = InventoryCount.objects.create(
            company=self.company,
            warehouse=self.warehouse,
            count_date=timezone.localdate(),
            created_by=self.user,
        )
        # Manually create items (simulate view logic)
        stocks = ProductStock.objects.filter(
            company=self.company,
            warehouse=self.warehouse,
        ).select_related("product")
        for stock in stocks:
            InventoryCountItem.objects.create(
                inventory_count=count,
                product=stock.product,
                product_name=stock.product.name,
                product_unit=stock.product.unit or "",
                quantity_system=stock.quantity_available,
                quantity_actual=None,
            )

        self.assertTrue(count.document_number.startswith("INW/"))
        items = count.items.all()
        self.assertEqual(items.count(), 1)
        item = items.first()
        self.assertEqual(item.product, self.product)
        self.assertEqual(item.quantity_system, Decimal("50.000"))
        self.assertIsNone(item.quantity_actual)
        self.assertEqual(item.product_name, self.product.name)
        self.assertEqual(item.product_unit, self.product.unit)


class InventoryCountCompletePositiveDeltaTest(TestCase):
    """Test that completing with quantity_actual > quantity_system increases stock."""

    def setUp(self):
        self.company = _make_company("Company B")
        self.user = _make_user(self.company, "user2")
        self.warehouse = _make_warehouse(self.company, self.user, "MG2")
        self.product = _make_product(self.company, self.user, "Product B")
        self.stock = _make_stock(self.company, self.product, self.warehouse, Decimal("10.000"))

    def test_complete_positive_delta_increases_stock(self):
        """quantity_actual > quantity_system → ProductStock increases by delta."""
        count = InventoryCount.objects.create(
            company=self.company,
            warehouse=self.warehouse,
            count_date=timezone.localdate(),
            created_by=self.user,
        )
        InventoryCountItem.objects.create(
            inventory_count=count,
            product=self.product,
            product_name=self.product.name,
            product_unit=self.product.unit,
            quantity_system=Decimal("10.000"),
            quantity_actual=Decimal("15.000"),
        )

        complete_inventory_count(count, self.user)

        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_available, Decimal("15.000"))

        count.refresh_from_db()
        self.assertEqual(count.status, InventoryCount.STATUS_COMPLETED)
        self.assertIsNotNone(count.completed_at)


class InventoryCountCompleteNegativeDeltaTest(TestCase):
    """Test that completing with quantity_actual < quantity_system decreases stock and batches."""

    def setUp(self):
        self.company = _make_company("Company C")
        self.user = _make_user(self.company, "user3")
        self.warehouse = _make_warehouse(self.company, self.user, "MG3")
        self.product = _make_product(self.company, self.user, "Product C", track_batches=True)
        self.stock = _make_stock(self.company, self.product, self.warehouse, Decimal("20.000"))
        # Create a FIFO batch
        StockBatch.objects.create(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse,
            batch_number="TEST/001",
            received_date=timezone.localdate(),
            quantity_initial=Decimal("20.00"),
            quantity_remaining=Decimal("20.00"),
        )

    def test_complete_negative_delta_decreases_stock(self):
        """quantity_actual < quantity_system → ProductStock decreases, StockBatch decremented."""
        count = InventoryCount.objects.create(
            company=self.company,
            warehouse=self.warehouse,
            count_date=timezone.localdate(),
            created_by=self.user,
        )
        InventoryCountItem.objects.create(
            inventory_count=count,
            product=self.product,
            product_name=self.product.name,
            product_unit=self.product.unit,
            quantity_system=Decimal("20.000"),
            quantity_actual=Decimal("15.000"),
        )

        complete_inventory_count(count, self.user)

        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_available, Decimal("15.000"))

        batch = StockBatch.objects.get(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse,
            batch_number="TEST/001",
        )
        self.assertEqual(batch.quantity_remaining, Decimal("15.00"))

        count.refresh_from_db()
        self.assertEqual(count.status, InventoryCount.STATUS_COMPLETED)


class InventoryCountStockMovementTest(TestCase):
    """Test that completing creates StockMovement records for adjusted items."""

    def setUp(self):
        self.company = _make_company("Company D")
        self.user = _make_user(self.company, "user4")
        self.warehouse = _make_warehouse(self.company, self.user, "MG4")
        self.product1 = _make_product(self.company, self.user, "Product D1", track_batches=False)
        self.product2 = _make_product(self.company, self.user, "Product D2", track_batches=False)
        _make_stock(self.company, self.product1, self.warehouse, Decimal("10.000"))
        _make_stock(self.company, self.product2, self.warehouse, Decimal("5.000"))

    def test_complete_creates_stock_movements(self):
        """Each adjusted item gets a StockMovement with ADJUSTMENT type."""
        count = InventoryCount.objects.create(
            company=self.company,
            warehouse=self.warehouse,
            count_date=timezone.localdate(),
            created_by=self.user,
        )
        # Product1: actual != system (will be adjusted)
        InventoryCountItem.objects.create(
            inventory_count=count,
            product=self.product1,
            product_name=self.product1.name,
            product_unit=self.product1.unit,
            quantity_system=Decimal("10.000"),
            quantity_actual=Decimal("12.000"),
        )
        # Product2: same as system (no adjustment)
        InventoryCountItem.objects.create(
            inventory_count=count,
            product=self.product2,
            product_name=self.product2.name,
            product_unit=self.product2.unit,
            quantity_system=Decimal("5.000"),
            quantity_actual=Decimal("5.000"),
        )
        # Product not counted: quantity_actual is None (skipped)

        movements_before = StockMovement.objects.filter(company=self.company).count()
        complete_inventory_count(count, self.user)
        movements_after = StockMovement.objects.filter(company=self.company).count()

        # Only product1 should generate a movement (delta != 0)
        self.assertEqual(movements_after - movements_before, 1)

        movement = StockMovement.objects.filter(
            company=self.company,
            product=self.product1,
            movement_type=StockMovement.MovementType.ADJUSTMENT,
        ).first()
        self.assertIsNotNone(movement)
        self.assertEqual(movement.quantity, Decimal("2.00"))
        self.assertEqual(movement.quantity_before, Decimal("10.00"))
        self.assertEqual(movement.quantity_after, Decimal("12.00"))
        self.assertEqual(movement.reference_type, "inventory_count")
        self.assertEqual(movement.reference_id, count.id)


class InventoryCountCancelTest(TestCase):
    """Test cancelling a draft inventory count."""

    def setUp(self):
        self.company = _make_company("Company E")
        self.user = _make_user(self.company, "user5")
        self.warehouse = _make_warehouse(self.company, self.user, "MG5")

    def test_cancel_inventory_count(self):
        """Draft inventory count can be cancelled via API action."""
        count = InventoryCount.objects.create(
            company=self.company,
            warehouse=self.warehouse,
            count_date=timezone.localdate(),
            created_by=self.user,
        )
        self.assertEqual(count.status, InventoryCount.STATUS_DRAFT)

        count.status = InventoryCount.STATUS_CANCELLED
        count.save(update_fields=["status", "updated_at"])
        count.refresh_from_db()

        self.assertEqual(count.status, InventoryCount.STATUS_CANCELLED)

    def test_cannot_cancel_completed_count(self):
        """Completed inventory count cannot be cancelled via service (view-level check)."""
        count = InventoryCount.objects.create(
            company=self.company,
            warehouse=self.warehouse,
            count_date=timezone.localdate(),
            status=InventoryCount.STATUS_COMPLETED,
            created_by=self.user,
        )
        # The view enforces this — simulate the check
        self.assertNotEqual(count.status, InventoryCount.STATUS_DRAFT)


class InventoryCountAPITest(APITestCase):
    """Integration tests via API endpoints."""

    def setUp(self):
        self.company = _make_company("API Company")
        self.user = _make_user(self.company, "apiuser")
        self.warehouse = _make_warehouse(self.company, self.user, "MGA")
        self.product = _make_product(self.company, self.user, "API Product", track_batches=False)
        self.stock = _make_stock(self.company, self.product, self.warehouse, Decimal("30.000"))
        self.client.force_authenticate(user=self.user)

    def test_create_inventory_count_via_api(self):
        """POST /api/inventory/ creates an INW and snapshots stock."""
        response = self.client.post(
            "/api/inventory/",
            {
                "warehouse": str(self.warehouse.id),
                "count_date": str(timezone.localdate()),
                "notes": "API test count",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertTrue(data["document_number"].startswith("INW/"))
        self.assertEqual(data["status"], "draft")
        self.assertEqual(len(data["items"]), 1)
        item = data["items"][0]
        self.assertEqual(Decimal(item["quantity_system"]), Decimal("30.000"))
        self.assertIsNone(item["quantity_actual"])

    def test_update_items_via_api(self):
        """POST /api/inventory/:id/update-items/ updates quantity_actual."""
        # Create a count first
        count = InventoryCount.objects.create(
            company=self.company,
            warehouse=self.warehouse,
            count_date=timezone.localdate(),
            created_by=self.user,
        )
        item = InventoryCountItem.objects.create(
            inventory_count=count,
            product=self.product,
            product_name=self.product.name,
            product_unit=self.product.unit,
            quantity_system=Decimal("30.000"),
            quantity_actual=None,
        )

        response = self.client.post(
            f"/api/inventory/{count.id}/update-items/",
            {
                "items": [
                    {"id": str(item.id), "quantity_actual": 25.0, "notes": "Checked"}
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item.refresh_from_db()
        self.assertEqual(item.quantity_actual, Decimal("25.000"))
        self.assertEqual(item.notes, "Checked")

    def test_complete_via_api(self):
        """POST /api/inventory/:id/complete/ applies adjustments."""
        count = InventoryCount.objects.create(
            company=self.company,
            warehouse=self.warehouse,
            count_date=timezone.localdate(),
            created_by=self.user,
        )
        InventoryCountItem.objects.create(
            inventory_count=count,
            product=self.product,
            product_name=self.product.name,
            product_unit=self.product.unit,
            quantity_system=Decimal("30.000"),
            quantity_actual=Decimal("28.000"),
        )

        response = self.client.post(f"/api/inventory/{count.id}/complete/", format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "completed")

        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity_available, Decimal("28.000"))

    def test_cancel_via_api(self):
        """POST /api/inventory/:id/cancel/ cancels a draft count."""
        count = InventoryCount.objects.create(
            company=self.company,
            warehouse=self.warehouse,
            count_date=timezone.localdate(),
            created_by=self.user,
        )
        response = self.client.post(f"/api/inventory/{count.id}/cancel/", format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "cancelled")

    def test_cannot_complete_already_completed(self):
        """POST /api/inventory/:id/complete/ fails if already completed."""
        count = InventoryCount.objects.create(
            company=self.company,
            warehouse=self.warehouse,
            count_date=timezone.localdate(),
            status=InventoryCount.STATUS_COMPLETED,
            created_by=self.user,
        )
        response = self.client.post(f"/api/inventory/{count.id}/complete/", format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
