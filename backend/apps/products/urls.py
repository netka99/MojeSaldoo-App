from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CustomerProductPriceViewSet, ProductViewSet, StockMovementViewSet, WarehouseViewSet

router = DefaultRouter()
router.register("products", ProductViewSet, basename="product")
router.register("warehouses", WarehouseViewSet, basename="warehouse")
router.register("stock-movements", StockMovementViewSet, basename="stock-movement")
router.register("customer-product-prices", CustomerProductPriceViewSet, basename="customer-product-price")

urlpatterns = [
    path("", include(router.urls)),
]
