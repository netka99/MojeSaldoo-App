import uuid
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.products.models import Product, ProductStock, StockBatch, StockMovement, Warehouse
from apps.products.serializers import ProductSerializer, WarehouseSerializer


class ProductModelTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="product-test-user",
            email="product@test.com",
            password="test12345",
        )

    def test_product_creation_with_requested_fields(self):
        product = Product.objects.create(
            user=self.user,
            name="Kartacze",
            description="Test product",
            unit="kg",
            price_net=Decimal("10.00"),
            price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"),
            sku="KAR-001",
            barcode="5901234567890",
            track_batches=True,
            min_stock_alert=Decimal("5.00"),
            shelf_life_days=7,
            is_active=True,
        )

        self.assertIsInstance(product.id, uuid.UUID)
        self.assertEqual(product.user, self.user)
        self.assertEqual(product.price_net, Decimal("10.00"))
        self.assertEqual(product.price_gross, Decimal("12.30"))
        self.assertEqual(product.vat_rate, Decimal("23.00"))
        self.assertIsNotNone(product.created_at)
        self.assertIsNotNone(product.updated_at)

    def test_product_defaults(self):
        product = Product.objects.create(name="Default Product")

        self.assertEqual(product.unit, "")
        self.assertEqual(product.price_net, Decimal("0"))
        self.assertEqual(product.price_gross, Decimal("0"))
        self.assertEqual(product.vat_rate, Decimal("23.00"))
        self.assertTrue(product.track_batches)
        self.assertEqual(product.min_stock_alert, Decimal("0"))
        self.assertTrue(product.is_active)


class WarehouseModelTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="warehouse-test-user",
            email="warehouse@test.com",
            password="test12345",
        )
        self.other_user = User.objects.create_user(
            username="warehouse-test-other",
            email="warehouse-other@test.com",
            password="test12345",
        )

    def test_warehouse_creation_with_requested_fields(self):
        warehouse = Warehouse.objects.create(
            user=self.user,
            code="MG",
            name="Magazyn główny",
            warehouse_type=Warehouse.WarehouseType.MOBILE,
            address="ul. Testowa 1, 00-001 Warszawa",
            is_active=False,
            allow_negative_stock=True,
            fifo_enabled=False,
        )

        self.assertIsInstance(warehouse.id, uuid.UUID)
        self.assertEqual(warehouse.user, self.user)
        self.assertEqual(warehouse.code, "MG")
        self.assertEqual(warehouse.name, "Magazyn główny")
        self.assertEqual(warehouse.warehouse_type, Warehouse.WarehouseType.MOBILE)
        self.assertEqual(warehouse.address, "ul. Testowa 1, 00-001 Warszawa")
        self.assertFalse(warehouse.is_active)
        self.assertTrue(warehouse.allow_negative_stock)
        self.assertFalse(warehouse.fifo_enabled)
        self.assertIsNotNone(warehouse.created_at)
        self.assertIsNotNone(warehouse.updated_at)

    def test_warehouse_defaults(self):
        warehouse = Warehouse.objects.create(
            user=self.user,
            code="DEF",
            name="Default Warehouse",
        )
        self.assertEqual(warehouse.warehouse_type, Warehouse.WarehouseType.MAIN)
        self.assertEqual(warehouse.address, "")
        self.assertTrue(warehouse.is_active)
        self.assertFalse(warehouse.allow_negative_stock)
        self.assertTrue(warehouse.fifo_enabled)

    def test_code_unique_globally(self):
        Warehouse.objects.create(
            user=self.user,
            code="MG",
            name="First",
        )
        with self.assertRaises(IntegrityError):
            Warehouse.objects.create(
                user=self.other_user,
                code="MG",
                name="Duplicate code different user",
            )

    def test_user_reverse_relation(self):
        w1 = Warehouse.objects.create(
            user=self.user,
            code="W1",
            name="One",
        )
        w2 = Warehouse.objects.create(
            user=self.user,
            code="W2",
            name="Two",
        )
        self.assertCountEqual(self.user.warehouses.all(), [w1, w2])

    def test_cascade_delete_user_removes_warehouses(self):
        Warehouse.objects.create(
            user=self.user,
            code="MG",
            name="Main",
        )
        self.assertEqual(Warehouse.objects.filter(user=self.user).count(), 1)
        self.user.delete()
        self.assertEqual(Warehouse.objects.count(), 0)
        self.assertFalse(Warehouse.objects.filter(code="MG").exists())

    def test_meta_ordering_by_code(self):
        Warehouse.objects.create(user=self.user, code="ZZ", name="Zeta")
        Warehouse.objects.create(user=self.user, code="AA", name="Alpha")
        codes = list(
            Warehouse.objects.filter(user=self.user).values_list("code", flat=True)
        )
        self.assertEqual(codes, ["AA", "ZZ"])


class ProductStockModelTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="stock-test-user",
            email="stock@test.com",
            password="test12345",
        )
        self.product = Product.objects.create(
            user=self.user,
            name="Stocked Item",
            unit="szt",
        )
        self.warehouse_a = Warehouse.objects.create(
            user=self.user,
            code="WA",
            name="Warehouse A",
        )
        self.warehouse_b = Warehouse.objects.create(
            user=self.user,
            code="WB",
            name="Warehouse B",
        )

    def test_product_stock_creation_with_quantities(self):
        row = ProductStock.objects.create(
            product=self.product,
            warehouse=self.warehouse_a,
            quantity_available=Decimal("10.50"),
            quantity_reserved=Decimal("2.00"),
            quantity_total=Decimal("12.50"),
        )

        self.assertIsInstance(row.id, uuid.UUID)
        self.assertEqual(row.product, self.product)
        self.assertEqual(row.warehouse, self.warehouse_a)
        self.assertEqual(row.quantity_available, Decimal("10.50"))
        self.assertEqual(row.quantity_reserved, Decimal("2.00"))
        self.assertEqual(row.quantity_total, Decimal("12.50"))

    def test_product_stock_decimal_defaults(self):
        row = ProductStock.objects.create(
            product=self.product,
            warehouse=self.warehouse_a,
        )
        self.assertEqual(row.quantity_available, Decimal("0"))
        self.assertEqual(row.quantity_reserved, Decimal("0"))
        self.assertEqual(row.quantity_total, Decimal("0"))

    def test_reverse_relations(self):
        s1 = ProductStock.objects.create(
            product=self.product,
            warehouse=self.warehouse_a,
        )
        s2 = ProductStock.objects.create(
            product=self.product,
            warehouse=self.warehouse_b,
        )

        self.assertCountEqual(self.product.stocks.all(), [s1, s2])
        self.assertCountEqual(self.warehouse_a.product_stocks.all(), [s1])
        self.assertCountEqual(self.warehouse_b.product_stocks.all(), [s2])

    def test_unique_product_warehouse(self):
        ProductStock.objects.create(
            product=self.product,
            warehouse=self.warehouse_a,
        )
        with self.assertRaises(IntegrityError):
            ProductStock.objects.create(
                product=self.product,
                warehouse=self.warehouse_a,
            )

    def test_cascade_delete_product_removes_stock(self):
        ProductStock.objects.create(
            product=self.product,
            warehouse=self.warehouse_a,
        )
        self.assertEqual(ProductStock.objects.count(), 1)
        self.product.delete()
        self.assertEqual(ProductStock.objects.count(), 0)

    def test_cascade_delete_warehouse_removes_stock(self):
        ProductStock.objects.create(
            product=self.product,
            warehouse=self.warehouse_a,
        )
        self.assertEqual(ProductStock.objects.count(), 1)
        self.warehouse_a.delete()
        self.assertEqual(ProductStock.objects.count(), 0)


class StockBatchModelTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="batch-test-user",
            email="batch@test.com",
            password="test12345",
        )
        self.product = Product.objects.create(
            user=self.user,
            name="Batch Product",
            unit="szt",
        )
        self.warehouse = Warehouse.objects.create(
            user=self.user,
            code="B1",
            name="Batch warehouse",
        )

    def test_stock_batch_creation_with_requested_fields(self):
        batch = StockBatch.objects.create(
            product=self.product,
            warehouse=self.warehouse,
            batch_number="LOT-2026-01",
            received_date=date(2026, 1, 10),
            expiry_date=date(2026, 6, 30),
            quantity_initial=Decimal("100.00"),
            quantity_remaining=Decimal("75.50"),
            unit_cost=Decimal("12.34"),
        )

        self.assertIsInstance(batch.id, uuid.UUID)
        self.assertEqual(batch.product, self.product)
        self.assertEqual(batch.warehouse, self.warehouse)
        self.assertEqual(batch.batch_number, "LOT-2026-01")
        self.assertEqual(batch.received_date, date(2026, 1, 10))
        self.assertEqual(batch.expiry_date, date(2026, 6, 30))
        self.assertEqual(batch.quantity_initial, Decimal("100.00"))
        self.assertEqual(batch.quantity_remaining, Decimal("75.50"))
        self.assertEqual(batch.unit_cost, Decimal("12.34"))

    def test_stock_batch_optional_fields_null(self):
        batch = StockBatch.objects.create(
            product=self.product,
            warehouse=self.warehouse,
            received_date=date(2026, 2, 1),
            quantity_initial=Decimal("10.00"),
            quantity_remaining=Decimal("10.00"),
        )
        self.assertIsNone(batch.batch_number)
        self.assertIsNone(batch.expiry_date)
        self.assertIsNone(batch.unit_cost)

    def test_reverse_relations(self):
        b = StockBatch.objects.create(
            product=self.product,
            warehouse=self.warehouse,
            received_date=date(2026, 3, 1),
            quantity_initial=Decimal("5.00"),
            quantity_remaining=Decimal("5.00"),
        )
        self.assertCountEqual(self.product.batches.all(), [b])
        self.assertCountEqual(self.warehouse.batches.all(), [b])

    def test_cascade_delete_product_removes_batches(self):
        StockBatch.objects.create(
            product=self.product,
            warehouse=self.warehouse,
            received_date=date(2026, 4, 1),
            quantity_initial=Decimal("1.00"),
            quantity_remaining=Decimal("1.00"),
        )
        self.assertEqual(StockBatch.objects.count(), 1)
        self.product.delete()
        self.assertEqual(StockBatch.objects.count(), 0)

    def test_cascade_delete_warehouse_removes_batches(self):
        StockBatch.objects.create(
            product=self.product,
            warehouse=self.warehouse,
            received_date=date(2026, 4, 1),
            quantity_initial=Decimal("1.00"),
            quantity_remaining=Decimal("1.00"),
        )
        self.assertEqual(StockBatch.objects.count(), 1)
        self.warehouse.delete()
        self.assertEqual(StockBatch.objects.count(), 0)

    def test_default_ordering_fifo_by_received_date(self):
        b_newer = StockBatch.objects.create(
            product=self.product,
            warehouse=self.warehouse,
            received_date=date(2026, 5, 20),
            quantity_initial=Decimal("1.00"),
            quantity_remaining=Decimal("1.00"),
        )
        b_older = StockBatch.objects.create(
            product=self.product,
            warehouse=self.warehouse,
            received_date=date(2026, 5, 10),
            quantity_initial=Decimal("1.00"),
            quantity_remaining=Decimal("1.00"),
        )
        ids = list(
            StockBatch.objects.filter(product=self.product).values_list("id", flat=True)
        )
        self.assertEqual(ids, [b_older.id, b_newer.id])


class ProductSerializerTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="product-serializer-user",
            email="pser@test.com",
            password="test12345",
        )

    def test_create_accepts_decimal_strings_and_stores_decimals(self):
        serializer = ProductSerializer(
            data={
                "name": "Serializer Product",
                "unit": "szt",
                "price_net": "10.50",
                "price_gross": "12.92",
                "vat_rate": "23.00",
                "min_stock_alert": "3.25",
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        product = serializer.save(user=self.user)

        self.assertEqual(product.price_net, Decimal("10.50"))
        self.assertEqual(product.price_gross, Decimal("12.92"))
        self.assertEqual(product.vat_rate, Decimal("23.00"))
        self.assertEqual(product.min_stock_alert, Decimal("3.25"))

    def test_negative_price_net_invalid(self):
        serializer = ProductSerializer(
            data={
                "name": "Bad",
                "unit": "szt",
                "price_net": "-0.01",
            }
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("price_net", serializer.errors)


class WarehouseSerializerTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="warehouse-serializer-user",
            email="wser@test.com",
            password="test12345",
        )

    def test_create_round_trip(self):
        serializer = WarehouseSerializer(
            data={
                "code": "SZ",
                "name": "Serialized warehouse",
                "warehouse_type": Warehouse.WarehouseType.MOBILE,
                "address": "ul. Magazynowa 2",
                "is_active": True,
                "allow_negative_stock": False,
                "fifo_enabled": True,
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        warehouse = serializer.save(user=self.user)

        self.assertEqual(warehouse.code, "SZ")
        self.assertEqual(warehouse.name, "Serialized warehouse")
        self.assertEqual(warehouse.warehouse_type, Warehouse.WarehouseType.MOBILE)
        self.assertEqual(warehouse.address, "ul. Magazynowa 2")
        self.assertTrue(warehouse.is_active)
        self.assertFalse(warehouse.allow_negative_stock)
        self.assertTrue(warehouse.fifo_enabled)


class ProductViewSetAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="api-product-owner",
            email="api-po@test.com",
            password="test12345",
        )
        self.other = User.objects.create_user(
            username="api-product-other",
            email="api-pt@test.com",
            password="test12345",
        )
        Product.objects.create(
            user=self.user,
            name="My catalog item",
            unit="szt",
            price_net=Decimal("1.00"),
            price_gross=Decimal("1.23"),
        )
        Product.objects.create(
            user=self.other,
            name="Other user item",
            unit="kg",
        )

    def test_list_requires_authentication(self):
        response = self.client.get(reverse("product-list"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_list_scoped_to_owner(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("product-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["name"], "My catalog item")

    def test_create_assigns_current_user(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("product-list"),
            {
                "name": "New via API",
                "unit": "op",
                "price_net": "10.00",
                "price_gross": "12.30",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "New via API")
        created = Product.objects.get(id=response.data["id"])
        self.assertEqual(created.user, self.user)


class WarehouseViewSetAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="api-wh-owner",
            email="api-wh@test.com",
            password="test12345",
        )
        self.other = User.objects.create_user(
            username="api-wh-other",
            email="api-who@test.com",
            password="test12345",
        )
        Warehouse.objects.create(
            user=self.user,
            code="OW1",
            name="Owner warehouse",
        )
        Warehouse.objects.create(
            user=self.other,
            code="OW2",
            name="Other warehouse",
        )

    def test_list_scoped_to_owner(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("warehouse-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        codes = {row["code"] for row in response.data["results"]}
        self.assertEqual(codes, {"OW1"})

    def test_create_assigns_current_user(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("warehouse-list"),
            {
                "code": "NW1",
                "name": "New warehouse",
                "warehouse_type": "main",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        wh = Warehouse.objects.get(id=response.data["id"])
        self.assertEqual(wh.user, self.user)


class ProductUpdateStockAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="update-stock-user",
            email="ustock@test.com",
            password="test12345",
        )
        self.other = User.objects.create_user(
            username="update-stock-other",
            email="ustock-o@test.com",
            password="test12345",
        )
        self.product = Product.objects.create(
            user=self.user,
            name="Stocked product",
            unit="szt",
        )
        self.warehouse = Warehouse.objects.create(
            user=self.user,
            code="US1",
            name="Update-stock warehouse",
        )

    def test_update_stock_creates_movement_and_product_stock(self):
        self.client.force_authenticate(user=self.user)
        url = reverse("product-update-stock", kwargs={"pk": self.product.id})
        response = self.client.post(
            url,
            {"warehouse_id": str(self.warehouse.id), "quantity_change": "7.50"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data.get("warehouse_code"), "US1")
        self.assertEqual(Decimal(response.data["quantity"]), Decimal("7.50"))
        self.assertEqual(Decimal(response.data["quantity_before"]), Decimal("0"))
        self.assertEqual(Decimal(response.data["quantity_after"]), Decimal("7.50"))
        stock = ProductStock.objects.get(product=self.product, warehouse=self.warehouse)
        self.assertEqual(stock.quantity_available, Decimal("7.50"))
        self.assertEqual(StockMovement.objects.count(), 1)

    def test_update_stock_amends_existing_movement(self):
        self.client.force_authenticate(user=self.user)
        url = reverse("product-update-stock", kwargs={"pk": self.product.id})
        first = self.client.post(
            url,
            {"warehouse_id": str(self.warehouse.id), "quantity_change": "10.00"},
            format="json",
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        movement_id = first.data["id"]
        second = self.client.post(
            url,
            {"stock_movement_id": movement_id, "quantity_change": "3.00"},
            format="json",
        )
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        stock = ProductStock.objects.get(product=self.product, warehouse=self.warehouse)
        self.assertEqual(stock.quantity_available, Decimal("3.00"))
        movement = StockMovement.objects.get(pk=movement_id)
        self.assertEqual(movement.quantity, Decimal("3.00"))
        self.assertEqual(StockMovement.objects.count(), 1)

    def test_negative_available_rejected_without_allow_negative(self):
        self.client.force_authenticate(user=self.user)
        url = reverse("product-update-stock", kwargs={"pk": self.product.id})
        response = self.client.post(
            url,
            {"warehouse_id": str(self.warehouse.id), "quantity_change": "-1.00"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            ProductStock.objects.filter(
                product=self.product,
                warehouse=self.warehouse,
            ).exists()
        )

    def test_warehouse_wrong_owner_rejected(self):
        foreign_wh = Warehouse.objects.create(
            user=self.other,
            code="FX1",
            name="Foreign",
        )
        self.client.force_authenticate(user=self.user)
        url = reverse("product-update-stock", kwargs={"pk": self.product.id})
        response = self.client.post(
            url,
            {"warehouse_id": str(foreign_wh.id), "quantity_change": "1.00"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_update_stock_accepts_warehouse_code_instead_of_id(self):
        self.client.force_authenticate(user=self.user)
        url = reverse("product-update-stock", kwargs={"pk": self.product.id})
        response = self.client.post(
            url,
            {"warehouse_code": "us1", "quantity_change": "2.00", "movement_type": "purchase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data.get("warehouse_code"), "US1")
        self.assertEqual(response.data["movement_type"], "purchase")
        stock = ProductStock.objects.get(product=self.product, warehouse=self.warehouse)
        self.assertEqual(stock.quantity_available, Decimal("2.00"))
