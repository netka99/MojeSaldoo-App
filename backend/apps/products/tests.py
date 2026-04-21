import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.products.models import Product


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
