import io
import uuid
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase
from django.urls import reverse
from openpyxl import Workbook
from rest_framework import status
from rest_framework.test import APIClient

from apps.products.models import Product, ProductStock, StockBatch, StockMovement, Warehouse
from apps.products.serializers import ProductSerializer, WarehouseSerializer
from apps.users.models import Company, CompanyMembership


def _company_with_user(user, name_suffix="org"):
    co = Company.objects.create(name=f"{user.username} {name_suffix}")
    CompanyMembership.objects.create(user=user, company=co, role="admin", is_active=True)
    return co


class ProductModelTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="product-test-user",
            email="product@test.com",
            password="test12345",
        )
        self.company = _company_with_user(self.user)

    def test_product_creation_with_requested_fields(self):
        product = Product.objects.create(
            user=self.user,
            company=self.company,
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

        self.assertIsInstance(product.uuid, uuid.UUID)
        self.assertEqual(product.user, self.user)
        self.assertEqual(product.price_net, Decimal("10.00"))
        self.assertEqual(product.price_gross, Decimal("12.30"))
        self.assertEqual(product.vat_rate, Decimal("23.00"))
        self.assertIsNotNone(product.created_at)
        self.assertIsNotNone(product.updated_at)

    def test_product_defaults(self):
        co = Company.objects.create(name="Product default co")
        product = Product.objects.create(name="Default Product", company=co)

        self.assertEqual(product.unit, "")
        self.assertEqual(product.price_net, Decimal("0"))
        self.assertEqual(product.price_gross, Decimal("0"))
        self.assertEqual(product.vat_rate, Decimal("23.00"))
        self.assertTrue(product.track_batches)
        self.assertEqual(product.min_stock_alert, Decimal("0"))
        self.assertTrue(product.is_active)
        self.assertEqual(product.pkwiu, "")

    def test_pkwiu_persists(self):
        product = Product.objects.create(
            user=self.user,
            company=self.company,
            name="Classified good",
            pkwiu="62.01.11.0",
        )
        product.refresh_from_db()
        self.assertEqual(product.pkwiu, "62.01.11.0")


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
        self.company = _company_with_user(self.user)
        self.other_company = _company_with_user(self.other_user, "other")

    def test_warehouse_creation_with_requested_fields(self):
        warehouse = Warehouse.objects.create(
            user=self.user,
            company=self.company,
            code="MG",
            name="Magazyn główny",
            warehouse_type=Warehouse.WarehouseType.MOBILE,
            address="ul. Testowa 1, 00-001 Warszawa",
            is_active=False,
            allow_negative_stock=True,
            fifo_enabled=False,
        )

        self.assertIsInstance(warehouse.uuid, uuid.UUID)
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
            company=self.company,
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
            company=self.company,
            code="MG",
            name="First",
        )
        with self.assertRaises(IntegrityError):
            Warehouse.objects.create(
                user=self.other_user,
                company=self.other_company,
                code="MG",
                name="Duplicate code different user",
            )

    def test_user_reverse_relation(self):
        w1 = Warehouse.objects.create(
            user=self.user,
            company=self.company,
            code="W1",
            name="One",
        )
        w2 = Warehouse.objects.create(
            user=self.user,
            company=self.company,
            code="W2",
            name="Two",
        )
        self.assertCountEqual(self.user.warehouses.all(), [w1, w2])

    def test_cascade_delete_user_removes_warehouses(self):
        Warehouse.objects.create(
            user=self.user,
            company=self.company,
            code="MG",
            name="Main",
        )
        self.assertEqual(Warehouse.objects.filter(user=self.user).count(), 1)
        self.user.delete()
        self.assertEqual(Warehouse.objects.count(), 0)
        self.assertFalse(Warehouse.objects.filter(code="MG").exists())

    def test_meta_ordering_by_code(self):
        Warehouse.objects.create(user=self.user, company=self.company, code="ZZ", name="Zeta")
        Warehouse.objects.create(user=self.user, company=self.company, code="AA", name="Alpha")
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
        self.company = _company_with_user(self.user)
        self.product = Product.objects.create(
            user=self.user,
            company=self.company,
            name="Stocked Item",
            unit="szt",
        )
        self.warehouse_a = Warehouse.objects.create(
            user=self.user,
            company=self.company,
            code="WA",
            name="Warehouse A",
        )
        self.warehouse_b = Warehouse.objects.create(
            user=self.user,
            company=self.company,
            code="WB",
            name="Warehouse B",
        )

    def test_product_stock_creation_with_quantities(self):
        row = ProductStock.objects.create(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse_a,
            quantity_available=Decimal("10.50"),
            quantity_reserved=Decimal("2.00"),
            quantity_total=Decimal("12.50"),
        )

        self.assertIsInstance(row.uuid, uuid.UUID)
        self.assertEqual(row.product, self.product)
        self.assertEqual(row.warehouse, self.warehouse_a)
        self.assertEqual(row.quantity_available, Decimal("10.50"))
        self.assertEqual(row.quantity_reserved, Decimal("2.00"))
        self.assertEqual(row.quantity_total, Decimal("12.50"))

    def test_product_stock_decimal_defaults(self):
        row = ProductStock.objects.create(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse_a,
        )
        self.assertEqual(row.quantity_available, Decimal("0"))
        self.assertEqual(row.quantity_reserved, Decimal("0"))
        self.assertEqual(row.quantity_total, Decimal("0"))

    def test_get_or_create_for_creates_with_company_and_zero_quantities(self):
        self.assertEqual(ProductStock.objects.count(), 0)
        row = ProductStock.get_or_create_for(self.product, self.warehouse_a)
        self.assertEqual(ProductStock.objects.count(), 1)
        self.assertEqual(row.company_id, self.company.id)
        self.assertEqual(row.product, self.product)
        self.assertEqual(row.warehouse, self.warehouse_a)
        self.assertEqual(row.quantity_available, Decimal("0"))
        self.assertEqual(row.quantity_reserved, Decimal("0"))
        self.assertEqual(row.quantity_total, Decimal("0"))

    def test_get_or_create_for_returns_existing_row(self):
        existing = ProductStock.objects.create(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse_a,
            quantity_available=Decimal("5"),
            quantity_reserved=Decimal("1"),
            quantity_total=Decimal("6"),
        )
        row = ProductStock.get_or_create_for(self.product, self.warehouse_a)
        self.assertEqual(row.pk, existing.pk)
        self.assertEqual(ProductStock.objects.count(), 1)
        self.assertEqual(row.quantity_available, Decimal("5"))

    def test_get_or_create_for_same_product_different_warehouse_two_rows(self):
        a = ProductStock.get_or_create_for(self.product, self.warehouse_a)
        b = ProductStock.get_or_create_for(self.product, self.warehouse_b)
        self.assertEqual(ProductStock.objects.count(), 2)
        self.assertNotEqual(a.pk, b.pk)
        self.assertEqual(a.warehouse, self.warehouse_a)
        self.assertEqual(b.warehouse, self.warehouse_b)
        self.assertEqual(a.company_id, b.company_id)

    def test_save_sets_quantity_total_to_available_plus_reserved(self):
        row = ProductStock(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse_a,
            quantity_available=Decimal("10"),
            quantity_reserved=Decimal("4"),
            quantity_total=Decimal("999"),
        )
        row.save()
        row.refresh_from_db()
        self.assertEqual(row.quantity_total, Decimal("14"))

    def test_save_with_update_fields_recalculates_quantity_total(self):
        row = ProductStock.objects.create(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse_a,
            quantity_available=Decimal("5"),
            quantity_reserved=Decimal("3"),
        )
        row.quantity_available = Decimal("20")
        row.save(update_fields=["quantity_available"])
        row.refresh_from_db()
        self.assertEqual(row.quantity_total, Decimal("23"))

    def test_reverse_relations(self):
        s1 = ProductStock.objects.create(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse_a,
        )
        s2 = ProductStock.objects.create(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse_b,
        )

        self.assertCountEqual(self.product.stocks.all(), [s1, s2])
        self.assertCountEqual(self.warehouse_a.product_stocks.all(), [s1])
        self.assertCountEqual(self.warehouse_b.product_stocks.all(), [s2])

    def test_unique_product_warehouse(self):
        ProductStock.objects.create(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse_a,
        )
        with self.assertRaises(IntegrityError):
            ProductStock.objects.create(
                company=self.company,
                product=self.product,
                warehouse=self.warehouse_a,
            )

    def test_cascade_delete_product_removes_stock(self):
        ProductStock.objects.create(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse_a,
        )
        self.assertEqual(ProductStock.objects.count(), 1)
        self.product.delete()
        self.assertEqual(ProductStock.objects.count(), 0)

    def test_cascade_delete_warehouse_removes_stock(self):
        ProductStock.objects.create(
            company=self.company,
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
        self.company = _company_with_user(self.user)
        self.product = Product.objects.create(
            user=self.user,
            company=self.company,
            name="Batch Product",
            unit="szt",
        )
        self.warehouse = Warehouse.objects.create(
            user=self.user,
            company=self.company,
            code="B1",
            name="Batch warehouse",
        )

    def test_stock_batch_creation_with_requested_fields(self):
        batch = StockBatch.objects.create(
            company=self.company,
            product=self.product,
            warehouse=self.warehouse,
            batch_number="LOT-2026-01",
            received_date=date(2026, 1, 10),
            expiry_date=date(2026, 6, 30),
            quantity_initial=Decimal("100.00"),
            quantity_remaining=Decimal("75.50"),
            unit_cost=Decimal("12.34"),
        )

        self.assertIsInstance(batch.uuid, uuid.UUID)
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
            company=self.company,
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
            company=self.company,
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
            company=self.company,
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
            company=self.company,
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
            company=self.company,
            product=self.product,
            warehouse=self.warehouse,
            received_date=date(2026, 5, 20),
            quantity_initial=Decimal("1.00"),
            quantity_remaining=Decimal("1.00"),
        )
        b_older = StockBatch.objects.create(
            company=self.company,
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
        self.company = _company_with_user(self.user)

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
        product = serializer.save(user=self.user, company=self.company)

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

    def test_create_with_pkwiu(self):
        serializer = ProductSerializer(
            data={
                "name": "With PKWiU",
                "unit": "szt",
                "pkwiu": "01.11.12.13",
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        product = serializer.save(user=self.user, company=self.company)
        self.assertEqual(product.pkwiu, "01.11.12.13")

    def test_to_representation_includes_pkwiu(self):
        product = Product.objects.create(
            user=self.user,
            company=self.company,
            name="Listed product",
            unit="szt",
            pkwiu="99.88.77",
        )
        data = ProductSerializer(product).data
        self.assertEqual(data["pkwiu"], "99.88.77")


class WarehouseSerializerTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="warehouse-serializer-user",
            email="wser@test.com",
            password="test12345",
        )
        self.company = _company_with_user(self.user)

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
        warehouse = serializer.save(user=self.user, company=self.company)

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
        self.co_user = _company_with_user(self.user)
        self.co_other = _company_with_user(self.other)
        Product.objects.create(
            user=self.user,
            company=self.co_user,
            name="My catalog item",
            unit="szt",
            price_net=Decimal("1.00"),
            price_gross=Decimal("1.23"),
        )
        Product.objects.create(
            user=self.other,
            company=self.co_other,
            name="Other user item",
            unit="kg",
        )
        self.user.current_company = self.co_user
        self.user.save(update_fields=["current_company"])
        self.other.current_company = self.co_other
        self.other.save(update_fields=["current_company"])

    def test_list_requires_authentication(self):
        response = self.client.get(reverse("product-list"))
        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

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
        created = Product.objects.get(uuid=response.data["id"])
        self.assertEqual(created.user, self.user)

    def test_create_accepts_pkwiu(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("product-list"),
            {
                "name": "API PKWiU product",
                "unit": "szt",
                "price_net": "1.00",
                "price_gross": "1.23",
                "pkwiu": "62.01.11.0",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["pkwiu"], "62.01.11.0")
        created = Product.objects.get(uuid=response.data["id"])
        self.assertEqual(created.pkwiu, "62.01.11.0")

    def test_list_includes_pkwiu(self):
        self.client.force_authenticate(user=self.user)
        p = Product.objects.get(name="My catalog item")
        p.pkwiu = "10.20.30"
        p.save(update_fields=["pkwiu"])
        response = self.client.get(reverse("product-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = next(r for r in response.data["results"] if r["id"] == str(p.uuid))
        self.assertEqual(row["pkwiu"], "10.20.30")

    def test_patch_updates_pkwiu(self):
        self.client.force_authenticate(user=self.user)
        p = Product.objects.get(name="My catalog item")
        response = self.client.patch(
            reverse("product-detail", kwargs={"uuid": p.uuid}),
            {"pkwiu": "44.55.66"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["pkwiu"], "44.55.66")
        p.refresh_from_db()
        self.assertEqual(p.pkwiu, "44.55.66")

    def test_list_includes_stock_total(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("product-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data["results"][0]
        self.assertIn("stock_total", row)
        self.assertEqual(row["stock_total"], Decimal("0"))

    def test_stock_snapshot_endpoint(self):
        self.client.force_authenticate(user=self.user)
        p = Product.objects.get(name="My catalog item")
        wh = Warehouse.objects.create(
            user=self.user,
            company=self.co_user,
            code="MGX",
            name="Main snap",
            warehouse_type=Warehouse.WarehouseType.MAIN,
        )
        ProductStock.objects.create(
            company=self.co_user,
            product=p,
            warehouse=wh,
            quantity_available=Decimal("5.25"),
            quantity_reserved=Decimal("0"),
            quantity_total=Decimal("5.25"),
        )
        response = self.client.get(
            reverse("product-stock-snapshot"), {"warehouse_id": str(wh.uuid)}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["warehouse_id"], str(wh.uuid))
        self.assertEqual(response.data["warehouse_name"], "Main snap")
        self.assertEqual(len(response.data["items"]), 1)
        self.assertEqual(response.data["items"][0]["product_id"], str(p.uuid))
        self.assertEqual(response.data["items"][0]["quantity_available"], "5.250")


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
        self.co_user = _company_with_user(self.user)
        self.co_other = _company_with_user(self.other)
        Warehouse.objects.create(
            user=self.user,
            company=self.co_user,
            code="OW1",
            name="Owner warehouse",
        )
        Warehouse.objects.create(
            user=self.other,
            company=self.co_other,
            code="OW2",
            name="Other warehouse",
        )
        self.user.current_company = self.co_user
        self.user.save(update_fields=["current_company"])
        self.other.current_company = self.co_other
        self.other.save(update_fields=["current_company"])

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
        wh = Warehouse.objects.get(uuid=response.data["id"])
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
        self.co_user = _company_with_user(self.user)
        self.co_other = _company_with_user(self.other)
        self.product = Product.objects.create(
            user=self.user,
            company=self.co_user,
            name="Stocked product",
            unit="szt",
        )
        self.warehouse = Warehouse.objects.create(
            user=self.user,
            company=self.co_user,
            code="US1",
            name="Update-stock warehouse",
        )
        self.user.current_company = self.co_user
        self.user.save(update_fields=["current_company"])
        self.other.current_company = self.co_other
        self.other.save(update_fields=["current_company"])

    def test_update_stock_creates_movement_and_product_stock(self):
        self.client.force_authenticate(user=self.user)
        url = reverse("product-update-stock", kwargs={"uuid": self.product.uuid})
        response = self.client.post(
            url,
            {"warehouse_id": str(self.warehouse.uuid), "quantity_change": "7.50"},
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
        url = reverse("product-update-stock", kwargs={"uuid": self.product.uuid})
        first = self.client.post(
            url,
            {"warehouse_id": str(self.warehouse.uuid), "quantity_change": "10.00"},
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
        movement = StockMovement.objects.get(uuid=movement_id)
        self.assertEqual(movement.quantity, Decimal("3.00"))
        self.assertEqual(StockMovement.objects.count(), 1)

    def test_negative_available_rejected_without_allow_negative(self):
        self.client.force_authenticate(user=self.user)
        url = reverse("product-update-stock", kwargs={"uuid": self.product.uuid})
        response = self.client.post(
            url,
            {"warehouse_id": str(self.warehouse.uuid), "quantity_change": "-1.00"},
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
            company=self.co_other,
            code="FX1",
            name="Foreign",
        )
        self.client.force_authenticate(user=self.user)
        url = reverse("product-update-stock", kwargs={"uuid": self.product.uuid})
        response = self.client.post(
            url,
            {"warehouse_id": str(foreign_wh.uuid), "quantity_change": "1.00"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_stock_accepts_warehouse_code_instead_of_id(self):
        self.client.force_authenticate(user=self.user)
        url = reverse("product-update-stock", kwargs={"uuid": self.product.uuid})
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


class CustomerProductPriceAPITests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="cpp-test-user", email="cpp@test.com", password="test12345"
        )
        self.company = _company_with_user(self.user)
        self.user.current_company = self.company
        self.user.save()

        from apps.customers.models import Customer
        self.customer = Customer.objects.create(
            company=self.company,
            name="Test Sklep",
        )
        from apps.products.models import CustomerProductPrice
        self.product = Product.objects.create(
            company=self.company,
            name="Chleb Zwykly",
            unit="szt.",
            price_net=Decimal("3.50"),
            price_gross=Decimal("3.78"),
            vat_rate=Decimal("8.00"),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.base_url = "/api/customer-product-prices/"

    def test_list_prices_for_customer(self):
        from apps.products.models import CustomerProductPrice
        CustomerProductPrice.objects.create(
            company=self.company,
            customer=self.customer,
            product=self.product,
            price_net=Decimal("2.80"),
        )
        response = self.client.get(self.base_url, {"customer": str(self.customer.id)})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["price_net"], "2.80")
        self.assertEqual(results[0]["product_name"], "Chleb Zwykly")

    def test_create_price(self):
        response = self.client.post(
            self.base_url,
            {
                "customer": str(self.customer.id),
                "product": str(self.product.id),
                "price_net": "2.00",
                "note": "staly klient",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["price_net"], "2.00")
        self.assertEqual(response.data["note"], "staly klient")
        from apps.products.models import CustomerProductPrice
        self.assertEqual(
            CustomerProductPrice.objects.filter(
                company=self.company, customer=self.customer, product=self.product
            ).count(),
            1,
        )

    def test_update_price(self):
        from apps.products.models import CustomerProductPrice
        cpp = CustomerProductPrice.objects.create(
            company=self.company,
            customer=self.customer,
            product=self.product,
            price_net=Decimal("2.80"),
        )
        response = self.client.patch(
            f"{self.base_url}{cpp.id}/",
            {"price_net": "1.99"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        cpp.refresh_from_db()
        self.assertEqual(cpp.price_net, Decimal("1.99"))

    def test_delete_price(self):
        from apps.products.models import CustomerProductPrice
        cpp = CustomerProductPrice.objects.create(
            company=self.company,
            customer=self.customer,
            product=self.product,
            price_net=Decimal("2.80"),
        )
        response = self.client.delete(f"{self.base_url}{cpp.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(CustomerProductPrice.objects.filter(id=cpp.id).exists())

    def test_unique_constraint(self):
        self.client.post(
            self.base_url,
            {"customer": str(self.customer.id), "product": str(self.product.id), "price_net": "2.80"},
            format="json",
        )
        response = self.client.post(
            self.base_url,
            {"customer": str(self.customer.id), "product": str(self.product.id), "price_net": "1.50"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class IsServiceFieldTests(TestCase):
    """Tests for the is_service flag — serializer enforcement and API filter."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="service-test-user",
            email="service@test.com",
            password="test12345",
        )
        self.company = _company_with_user(self.user)
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        self.client.force_authenticate(user=self.user)

    def _create_product(self, **kwargs):
        kwargs.setdefault("name", "Physical product")
        return Product.objects.create(
            user=self.user,
            company=self.company,
            unit="szt",
            price_net=Decimal("10.00"),
            price_gross=Decimal("12.30"),
            **kwargs,
        )

    # --- Serializer enforcement ---

    def test_create_service_forces_track_batches_false(self):
        response = self.client.post(
            reverse("product-list"),
            {
                "name": "Naprawa zmywarki",
                "unit": "godz",
                "price_net": "150.00",
                "price_gross": "184.50",
                "is_service": True,
                "track_batches": True,  # should be forced to False
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(response.data["track_batches"])
        product = Product.objects.get(uuid=response.data["id"])
        self.assertFalse(product.track_batches)

    def test_create_service_forces_is_resalable_true(self):
        response = self.client.post(
            reverse("product-list"),
            {
                "name": "Konsultacja IT",
                "unit": "godz",
                "price_net": "200.00",
                "price_gross": "246.00",
                "is_service": True,
                "is_resalable": False,  # should be forced to True
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["is_resalable"])

    def test_update_service_still_enforces_track_batches_false(self):
        product = self._create_product(is_service=True, track_batches=False)
        response = self.client.patch(
            reverse("product-detail", args=[str(product.uuid)]),
            {"track_batches": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product.refresh_from_db()
        self.assertFalse(product.track_batches)

    def test_physical_product_keeps_track_batches(self):
        response = self.client.post(
            reverse("product-list"),
            {
                "name": "Fizyczny towar",
                "unit": "szt",
                "price_net": "5.00",
                "price_gross": "6.15",
                "is_service": False,
                "track_batches": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["track_batches"])

    # --- Filter ---

    def test_filter_is_service_true_returns_only_services(self):
        self._create_product(name="Produkt fizyczny", is_service=False)
        Product.objects.create(
            user=self.user,
            company=self.company,
            name="Usługa serwisowa",
            unit="godz",
            price_net=Decimal("100.00"),
            price_gross=Decimal("123.00"),
            is_service=True,
        )
        response = self.client.get(reverse("product-list"), {"is_service": "true"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = [r["name"] for r in response.data["results"]]
        self.assertIn("Usługa serwisowa", names)
        self.assertNotIn("Produkt fizyczny", names)

    def test_filter_is_service_false_returns_only_physical(self):
        self._create_product(name="Mąka pszenna", is_service=False)
        Product.objects.create(
            user=self.user,
            company=self.company,
            name="Strona internetowa",
            unit="usługa",
            price_net=Decimal("500.00"),
            price_gross=Decimal("615.00"),
            is_service=True,
        )
        response = self.client.get(reverse("product-list"), {"is_service": "false"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = [r["name"] for r in response.data["results"]]
        self.assertIn("Mąka pszenna", names)
        self.assertNotIn("Strona internetowa", names)

    def test_no_filter_returns_both_types(self):
        self._create_product(name="Towar", is_service=False)
        Product.objects.create(
            user=self.user,
            company=self.company,
            name="Usługa",
            unit="godz",
            price_net=Decimal("80.00"),
            price_gross=Decimal("98.40"),
            is_service=True,
        )
        response = self.client.get(reverse("product-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = [r["name"] for r in response.data["results"]]
        self.assertIn("Towar", names)
        self.assertIn("Usługa", names)


class ProductImportTests(TestCase):
    """Tests for POST /api/products/import/ and GET /api/products/import-template/."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="import-test-user",
            email="import@test.com",
            password="test12345",
        )
        self.company = _company_with_user(self.user)
        self.user.current_company = self.company
        self.user.save()

        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _csv_file(self, content: str, filename="produkty.csv"):
        import io
        from django.core.files.uploadedfile import SimpleUploadedFile
        return SimpleUploadedFile(filename, content.encode("utf-8"), content_type="text/csv")

    def _xlsx_file(self, rows: list[list], filename="produkty.xlsx"):
        import io
        from django.core.files.uploadedfile import SimpleUploadedFile
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        for row in rows:
            ws.append(row)
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return SimpleUploadedFile(filename, buf.read(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    # ── Template ──────────────────────────────────────────────────────────

    def test_template_download_returns_xlsx(self):
        resp = self.client.get(reverse("product-import-template"))
        self.assertEqual(resp.status_code, 200)
        self.assertIn("spreadsheetml", resp["Content-Type"])
        self.assertIn("szablon_produkty.xlsx", resp["Content-Disposition"])

    def test_template_requires_auth(self):
        self.client.logout()
        resp = APIClient().get(reverse("product-import-template"))
        self.assertEqual(resp.status_code, 401)

    # ── Dry run — valid CSV ───────────────────────────────────────────────

    def test_dry_run_valid_csv(self):
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%);SKU;Kod kreskowy;Opis;Alert minimalny\r\nChleb;szt;2,50;5;SKU-1;;;;\r\n"
        f = self._csv_file(csv_content)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "true"}, format="multipart")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["dry_run"])
        self.assertEqual(resp.data["valid_count"], 1)
        self.assertEqual(resp.data["error_count"], 0)
        self.assertEqual(Product.objects.filter(company=self.company).count(), 0)  # no commit

    def test_dry_run_valid_xlsx(self):
        rows = [
            ["Nazwa", "Jednostka", "Cena brutto", "VAT (%)", "SKU", "Kod kreskowy", "Opis", "Alert minimalny"],
            ["Masło", "kg", "8.00", "5", "", "", "", ""],
            ["Mąka", "kg", "3.20", "8", "MAK-001", "", "pszenna", "10"],
        ]
        f = self._xlsx_file(rows)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "true"}, format="multipart")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["valid_count"], 2)
        self.assertEqual(resp.data["error_count"], 0)

    # ── Dry run — validation errors ───────────────────────────────────────

    def test_dry_run_missing_required_fields(self):
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%)\r\n;szt;2,50;5\r\nChleb;;2,50;5\r\nChleb;szt;;5\r\nChleb;szt;2,50;\r\n"
        f = self._csv_file(csv_content)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "true"}, format="multipart")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["error_count"], 4)

    def test_dry_run_invalid_vat_rate(self):
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%)\r\nChleb;szt;2,50;7\r\n"
        f = self._csv_file(csv_content)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "true"}, format="multipart")
        self.assertEqual(resp.data["error_count"], 1)
        self.assertEqual(resp.data["errors"][0]["field"], "VAT (%)")

    def test_dry_run_invalid_price(self):
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%)\r\nChleb;szt;abc;5\r\n"
        f = self._csv_file(csv_content)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "true"}, format="multipart")
        self.assertEqual(resp.data["error_count"], 1)
        self.assertEqual(resp.data["errors"][0]["field"], "Cena brutto")

    # ── Commit ────────────────────────────────────────────────────────────

    def test_commit_creates_products(self):
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%);SKU\r\nChleb;szt;2,50;5;SKU-1\r\nMasło;kg;8,00;5;\r\n"
        f = self._csv_file(csv_content)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "false"}, format="multipart")
        self.assertEqual(resp.status_code, 201)
        self.assertFalse(resp.data["dry_run"])
        self.assertEqual(resp.data["created"], 2)
        self.assertEqual(Product.objects.filter(company=self.company).count(), 2)

    def test_commit_calculates_price_net(self):
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%)\r\nChleb;szt;10,00;23\r\n"
        f = self._csv_file(csv_content)
        self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "false"}, format="multipart")
        product = Product.objects.get(company=self.company, name="Chleb")
        # price_net = 10.00 / 1.23 ≈ 8.13
        self.assertAlmostEqual(float(product.price_net), 10.00 / 1.23, places=2)
        self.assertEqual(product.price_gross, Decimal("10.00"))
        self.assertEqual(product.vat_rate, Decimal("23"))

    def test_commit_scoped_to_current_company(self):
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%)\r\nBułka;szt;0,50;5\r\n"
        f = self._csv_file(csv_content)
        self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "false"}, format="multipart")
        p = Product.objects.get(company=self.company, name="Bułka")
        self.assertEqual(p.company, self.company)

    def test_commit_stops_on_errors(self):
        # Mix of valid and invalid rows — commit should be rejected (errors returned, nothing created)
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%)\r\nChleb;szt;2,50;5\r\n;szt;2,50;5\r\n"
        f = self._csv_file(csv_content)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "false"}, format="multipart")
        self.assertEqual(resp.status_code, 200)  # returns preview with errors
        self.assertTrue(resp.data["dry_run"])
        self.assertEqual(Product.objects.filter(company=self.company).count(), 0)

    def test_no_file_returns_400(self):
        resp = self.client.post(reverse("product-import-products"), {}, format="multipart")
        self.assertEqual(resp.status_code, 400)

    # ── Dedup: dry-run preview ────────────────────────────────────────────

    def test_dry_run_shows_update_when_sku_matches(self):
        Product.objects.create(company=self.company, user=self.user, name="Chleb stary", sku="SKU-1", unit="szt",
                               price_gross=Decimal("2.00"), price_net=Decimal("1.90"), vat_rate=Decimal("5"))
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%);SKU\r\nChleb nowa cena;szt;3,00;5;SKU-1\r\n"
        f = self._csv_file(csv_content)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "true"}, format="multipart")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["to_update"], 1)
        self.assertEqual(resp.data["to_create"], 0)
        self.assertEqual(resp.data["to_skip"], 0)

    def test_dry_run_shows_update_when_name_matches_no_sku(self):
        Product.objects.create(company=self.company, user=self.user, name="Chleb", sku="", unit="szt",
                               price_gross=Decimal("2.00"), price_net=Decimal("1.90"), vat_rate=Decimal("5"))
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%)\r\nChleb;szt;3,00;5\r\n"
        f = self._csv_file(csv_content)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "true"}, format="multipart")
        self.assertEqual(resp.data["to_update"], 1)
        self.assertEqual(resp.data["to_create"], 0)

    def test_dry_run_shows_create_for_new_products(self):
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%)\r\nBagietka;szt;3,50;5\r\n"
        f = self._csv_file(csv_content)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "true"}, format="multipart")
        self.assertEqual(resp.data["to_create"], 1)
        self.assertEqual(resp.data["to_update"], 0)
        self.assertEqual(resp.data["to_skip"], 0)

    # ── Dedup: commit ─────────────────────────────────────────────────────

    def test_commit_updates_existing_product_by_sku(self):
        p = Product.objects.create(company=self.company, user=self.user, name="Chleb stary", sku="SKU-1", unit="szt",
                                   price_gross=Decimal("2.00"), price_net=Decimal("1.90"), vat_rate=Decimal("5"))
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%);SKU\r\nChleb nowa nazwa;szt;5,25;5;SKU-1\r\n"
        f = self._csv_file(csv_content)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "false"}, format="multipart")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["updated"], 1)
        self.assertEqual(resp.data["created"], 0)
        p.refresh_from_db()
        self.assertEqual(p.name, "Chleb nowa nazwa")
        self.assertEqual(p.price_gross, Decimal("5.25"))

    def test_commit_updates_existing_product_by_name_no_sku(self):
        Product.objects.create(company=self.company, user=self.user, name="Chleb", sku="", unit="szt",
                               price_gross=Decimal("2.00"), price_net=Decimal("1.90"), vat_rate=Decimal("5"))
        csv_content = "Nazwa;Jednostka;Cena brutto;VAT (%)\r\nChleb;szt;5,00;5\r\n"
        f = self._csv_file(csv_content)
        resp = self.client.post(reverse("product-import-products"), {"file": f, "dry_run": "false"}, format="multipart")
        self.assertEqual(resp.data["updated"], 1)
        self.assertEqual(resp.data["created"], 0)
        # Price must have been updated
        p = Product.objects.get(company=self.company, name="Chleb")
        self.assertEqual(p.price_gross, Decimal("5.00"))


class ProductSafeDeleteTests(TestCase):
    """Tests for safe DELETE /api/products/{uuid}/."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="delete-test-user",
            email="delete@test.com",
            password="test12345",
        )
        self.company = _company_with_user(self.user)
        self.user.current_company = self.company
        self.user.save()

        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.product = Product.objects.create(
            company=self.company,
            user=self.user,
            name="Produkt do usunięcia",
            unit="szt",
            price_gross=Decimal("10.00"),
            price_net=Decimal("9.52"),
            vat_rate=Decimal("5"),
        )

    def _delete_url(self):
        return reverse("product-detail", kwargs={"uuid": self.product.uuid})

    def test_delete_product_without_history(self):
        resp = self.client.delete(self._delete_url())
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Product.objects.filter(pk=self.product.pk).exists())

    def test_delete_blocked_by_stock_movement(self):
        warehouse = Warehouse.objects.create(company=self.company, user=self.user, code="MG", name="Magazyn")
        StockMovement.objects.create(
            company=self.company,
            product=self.product,
            warehouse=warehouse,
            user=self.user,
            movement_type=StockMovement.MovementType.ADJUSTMENT,
            quantity=Decimal("10"),
            quantity_before=Decimal("0"),
            quantity_after=Decimal("10"),
        )
        resp = self.client.delete(self._delete_url())
        self.assertEqual(resp.status_code, 409)
        self.assertIn("blockers", resp.data)
        self.assertTrue(Product.objects.filter(pk=self.product.pk).exists())

    def test_delete_blocked_by_stock_on_hand(self):
        warehouse = Warehouse.objects.create(company=self.company, user=self.user, code="MG2", name="Magazyn 2")
        ProductStock.objects.create(
            company=self.company,
            product=self.product,
            warehouse=warehouse,
            quantity_available=Decimal("5"),
            quantity_reserved=Decimal("0"),
        )
        resp = self.client.delete(self._delete_url())
        self.assertEqual(resp.status_code, 409)
        self.assertTrue(Product.objects.filter(pk=self.product.pk).exists())

    def test_delete_requires_auth(self):
        resp = APIClient().delete(self._delete_url())
        self.assertEqual(resp.status_code, 401)

    def test_delete_blocked_by_order_item(self):
        from apps.orders.models import Order, OrderItem
        from apps.customers.models import Customer
        customer = Customer.objects.create(company=self.company, name="Test Klient")
        from datetime import date
        today = date.today()
        order = Order.objects.create(
            company=self.company,
            user=self.user,
            customer=customer,
            status=Order.STATUS_DRAFT,
            order_date=today,
            delivery_date=today,
        )
        OrderItem.objects.create(
            order=order,
            product=self.product,
            product_name=self.product.name,
            product_unit=self.product.unit,
            quantity=Decimal("2"),
            unit_price_gross=self.product.price_gross,
            vat_rate=self.product.vat_rate,
            line_total_gross=Decimal("20.00"),
        )
        resp = self.client.delete(self._delete_url())
        self.assertEqual(resp.status_code, 409)
        blockers = resp.data["blockers"]
        self.assertTrue(any("zamówieni" in b for b in blockers))


def _make_stock_xlsx(rows: list[dict]) -> io.BytesIO:
    """Build a minimal in-memory XLSX with stock import columns."""
    wb = Workbook()
    ws = wb.active
    headers = ["Nazwa produktu", "SKU", "Kod magazynu", "Ilość", "Notatka"]
    ws.append(headers)
    for row in rows:
        ws.append([row.get(h, "") for h in headers])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


class WarehouseStockImportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="import-stock-user",
            email="importstock@test.com",
            password="test12345",
        )
        self.company = _company_with_user(self.user)
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        self.client.force_authenticate(user=self.user)

        self.wh = Warehouse.objects.create(
            company=self.company, user=self.user, code="MG", name="Magazyn Główny"
        )
        self.wh2 = Warehouse.objects.create(
            company=self.company, user=self.user, code="MV1", name="Van 1"
        )
        self.product = Product.objects.create(
            company=self.company, user=self.user,
            name="Mąka pszenna", unit="kg", price_gross="2.50", vat_rate=5,
        )
        self.product_sku = Product.objects.create(
            company=self.company, user=self.user,
            name="Chleb pszenny", sku="SKU-002", unit="szt", price_gross="3.50", vat_rate=5,
        )

    def _upload(self, rows, dry_run="true"):
        buf = _make_stock_xlsx(rows)
        buf.name = "stan.xlsx"
        return self.client.post(
            reverse("warehouse-import-stock"),
            {"file": buf, "dry_run": dry_run},
            format="multipart",
        )

    def test_dry_run_returns_preview(self):
        r = self._upload([
            {"Nazwa produktu": "Mąka pszenna", "Kod magazynu": "MG", "Ilość": 150},
            {"Nazwa produktu": "Chleb pszenny", "Kod magazynu": "MV1", "Ilość": 20},
        ])
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["dry_run"])
        self.assertEqual(r.data["to_create"], 2)
        self.assertEqual(ProductStock.objects.count(), 0)

    def test_commit_creates_stock_movements(self):
        r = self._upload([
            {"Nazwa produktu": "Mąka pszenna", "Kod magazynu": "MG", "Ilość": 150, "Notatka": "Stan otwarcia"},
        ], dry_run="false")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["created"], 1)
        stock = ProductStock.objects.get(product=self.product, warehouse=self.wh)
        self.assertEqual(stock.quantity_available, Decimal("150"))
        movement = StockMovement.objects.get(product=self.product, warehouse=self.wh)
        self.assertEqual(movement.quantity, Decimal("150"))
        self.assertEqual(movement.reference_type, "import")

    def test_match_by_sku(self):
        r = self._upload([
            {"SKU": "SKU-002", "Kod magazynu": "MG", "Ilość": 50},
        ], dry_run="false")
        self.assertEqual(r.status_code, 201)
        stock = ProductStock.objects.get(product=self.product_sku, warehouse=self.wh)
        self.assertEqual(stock.quantity_available, Decimal("50"))

    def test_same_product_multiple_warehouses(self):
        r = self._upload([
            {"Nazwa produktu": "Mąka pszenna", "Kod magazynu": "MG", "Ilość": 100},
            {"Nazwa produktu": "Mąka pszenna", "Kod magazynu": "MV1", "Ilość": 30},
        ], dry_run="false")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["created"], 2)
        self.assertEqual(ProductStock.objects.filter(product=self.product).count(), 2)

    def test_unknown_product_returns_error(self):
        r = self._upload([
            {"Nazwa produktu": "Nieistniejący produkt", "Kod magazynu": "MG", "Ilość": 10},
        ])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["error_count"], 1)
        self.assertIn("Nie znaleziono produktu", r.data["errors"][0]["message"])

    def test_unknown_warehouse_code_returns_error(self):
        r = self._upload([
            {"Nazwa produktu": "Mąka pszenna", "Kod magazynu": "XXX", "Ilość": 10},
        ])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["error_count"], 1)
        self.assertIn("Nie znaleziono magazynu", r.data["errors"][0]["message"])

    def test_missing_quantity_returns_error(self):
        r = self._upload([
            {"Nazwa produktu": "Mąka pszenna", "Kod magazynu": "MG", "Ilość": ""},
        ])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["error_count"], 1)
        self.assertEqual(r.data["errors"][0]["field"], "Ilość")

    def test_zero_quantity_returns_error(self):
        r = self._upload([
            {"Nazwa produktu": "Mąka pszenna", "Kod magazynu": "MG", "Ilość": 0},
        ])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["error_count"], 1)

    def test_template_download(self):
        r = self.client.get(reverse("warehouse-import-template"))
        self.assertEqual(r.status_code, 200)
        self.assertIn("spreadsheetml", r["Content-Type"])
