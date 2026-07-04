from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.orders.models import Order, OrderItem
from apps.products.models import Product, ProductStock, Warehouse
from apps.users.models import Company, CompanyMembership

from .models import Recipe, RecipeItem


def _company_with_user(user, name_suffix="org"):
    co = Company.objects.create(name=f"{user.username} {name_suffix}")
    CompanyMembership.objects.create(user=user, company=co, role="admin", is_active=True)
    return co


def _product(company, user, name, unit="szt", avg_cost=None):
    return Product.objects.create(
        company=company,
        user=user,
        name=name,
        unit=unit,
        price_net=Decimal("10.00"),
        price_gross=Decimal("10.00"),
        vat_rate=Decimal("23.00"),
        avg_cost=avg_cost,
    )


def _warehouse(company, user, code="MG"):
    return Warehouse.objects.create(
        company=company,
        user=user,
        code=code,
        name="Magazyn Główny",
        warehouse_type="main",
    )


def _stock(company, product, warehouse, qty):
    ps, _ = ProductStock.objects.get_or_create(
        company=company,
        product=product,
        warehouse=warehouse,
        defaults={"quantity_available": qty, "quantity_total": qty},
    )
    if not _:
        ps.quantity_available = qty
        ps.quantity_total = qty
        ps.save()
    return ps


def _order(company, user, customer, status_val, delivery_date, items):
    """Create an order with given items list of (product, qty)."""
    order = Order.objects.create(
        company=company,
        user=user,
        customer=customer,
        order_number=f"ZAM/{Order.objects.count():04d}",
        order_date=delivery_date,
        delivery_date=delivery_date,
        status=status_val,
    )
    for product, qty in items:
        OrderItem.objects.create(
            order=order,
            product=product,
            product_name=product.name,
            product_unit=product.unit,
            quantity=Decimal(str(qty)),
            unit_price_net=Decimal("10.00"),
            unit_price_gross=Decimal("10.00"),
            vat_rate=Decimal("23.00"),
            line_total_net=Decimal("10.00") * qty,
            line_total_gross=Decimal("10.00") * qty,
        )
    return order


class RecipeItemSerializerEnrichmentTest(TestCase):
    """RecipeItem returned by the API must include ingredient_avg_cost and ingredient_stock_total."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username="baker", password="pass")
        self.company = _company_with_user(self.user)
        self.user.current_company = self.company
        self.user.save()

        self.wh = _warehouse(self.company, self.user)
        self.flour = _product(self.company, self.user, "Mąka", unit="kg", avg_cost=Decimal("2.50"))
        self.bread = _product(self.company, self.user, "Chleb", unit="szt")
        _stock(self.company, self.flour, self.wh, Decimal("100"))

        self.recipe = Recipe.objects.create(
            company=self.company,
            product=self.bread,
            yield_quantity=Decimal("10"),
        )
        RecipeItem.objects.create(
            recipe=self.recipe,
            ingredient=self.flour,
            quantity=Decimal("1.5"),
            unit="kg",
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_recipe_item_includes_avg_cost_and_stock(self):
        resp = self.client.get("/api/production/recipes/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        recipes = resp.json()
        self.assertEqual(len(recipes), 1)
        items = recipes[0]["items"]
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item["ingredient_avg_cost"], "2.5000")
        self.assertEqual(float(item["ingredient_stock_total"]), 100.0)


class ProductionPlanningEndpointTest(TestCase):
    """GET /api/production/orders/planning/ returns aggregated demand for products with recipes."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username="plan_user", password="pass")
        self.company = _company_with_user(self.user)
        self.user.current_company = self.company
        self.user.save()

        from apps.customers.models import Customer
        self.customer = Customer.objects.create(
            company=self.company,
            user=self.user,
            name="Sklep A",
        )

        self.wh = _warehouse(self.company, self.user)
        self.flour = _product(self.company, self.user, "Mąka", unit="kg", avg_cost=Decimal("3.00"))
        self.bread = _product(self.company, self.user, "Chleb", unit="szt", avg_cost=None)

        # Recipe: 1 kg flour → 5 loaves
        self.recipe = Recipe.objects.create(
            company=self.company,
            product=self.bread,
            yield_quantity=Decimal("5"),
        )
        RecipeItem.objects.create(
            recipe=self.recipe,
            ingredient=self.flour,
            quantity=Decimal("1"),
            unit="kg",
        )

        # Stock: 10 loaves already in stock
        _stock(self.company, self.bread, self.wh, Decimal("10"))
        # Flour stock: 20 kg
        _stock(self.company, self.flour, self.wh, Decimal("20"))

        self.delivery_date = date.today() + timedelta(days=2)

        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_planning_returns_demand_for_product_with_recipe(self):
        # Order 30 loaves → shortfall = 30 - 10 = 20
        _order(
            self.company, self.user, self.customer,
            Order.STATUS_CONFIRMED, self.delivery_date,
            [(self.bread, 30)],
        )
        resp = self.client.get("/api/production/orders/planning/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.json()
        self.assertEqual(len(data), 1)
        item = data[0]
        self.assertEqual(item["product_id"], str(self.bread.uuid))
        self.assertEqual(Decimal(str(item["total_ordered"])), Decimal("30"))
        self.assertEqual(Decimal(str(item["stock_available"])), Decimal("10"))
        self.assertEqual(Decimal(str(item["shortfall"])), Decimal("20"))
        self.assertEqual(len(item["orders"]), 1)
        self.assertEqual(len(item["ingredients"]), 1)
        # Flour needed = 20 / 5 × 1 = 4 kg; stock = 20 kg → has_enough_stock=True
        ing = item["ingredients"][0]
        self.assertEqual(ing["ingredient_name"], "Mąka")
        self.assertEqual(Decimal(str(ing["quantity_needed"])), Decimal("4"))
        self.assertTrue(ing["has_enough_stock"])

    def test_planning_respects_date_filter(self):
        far_date = date.today() + timedelta(days=30)
        _order(
            self.company, self.user, self.customer,
            Order.STATUS_CONFIRMED, far_date,
            [(self.bread, 50)],
        )
        # Filter to next 7 days — order should not appear
        resp = self.client.get(
            "/api/production/orders/planning/",
            {"date_from": str(date.today()), "date_to": str(date.today() + timedelta(days=7))},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.json(), [])

    def test_planning_excludes_cancelled_orders(self):
        _order(
            self.company, self.user, self.customer,
            Order.STATUS_CANCELLED, self.delivery_date,
            [(self.bread, 50)],
        )
        resp = self.client.get("/api/production/orders/planning/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.json(), [])

    def test_planning_excludes_products_without_recipe(self):
        other = _product(self.company, self.user, "Bułka", unit="szt")
        _order(
            self.company, self.user, self.customer,
            Order.STATUS_CONFIRMED, self.delivery_date,
            [(other, 20)],
        )
        resp = self.client.get("/api/production/orders/planning/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Only bread (which has a recipe) appears
        product_ids = [i["product_id"] for i in resp.json()]
        self.assertNotIn(str(other.uuid), product_ids)

    def test_planning_no_shortfall_when_stock_covers_demand(self):
        # Stock is 10, order is also 10 → shortfall = 0
        _order(
            self.company, self.user, self.customer,
            Order.STATUS_CONFIRMED, self.delivery_date,
            [(self.bread, 10)],
        )
        resp = self.client.get("/api/production/orders/planning/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(Decimal(str(data[0]["shortfall"])), Decimal("0"))

    def test_planning_estimated_cost(self):
        # flour avg_cost=3.00, recipe: 1 kg flour → 5 loaves → cost/loaf = 3.00/5 = 0.60
        _order(
            self.company, self.user, self.customer,
            Order.STATUS_CONFIRMED, self.delivery_date,
            [(self.bread, 30)],
        )
        resp = self.client.get("/api/production/orders/planning/")
        data = resp.json()
        self.assertEqual(len(data), 1)
        unit_cost = Decimal(str(data[0]["estimated_unit_cost"]))
        self.assertAlmostEqual(float(unit_cost), 0.60, places=4)
        # shortfall=20, total_cost = 0.60 × 20 = 12.00
        total_cost = Decimal(str(data[0]["estimated_total_cost"]))
        self.assertAlmostEqual(float(total_cost), 12.00, places=2)
