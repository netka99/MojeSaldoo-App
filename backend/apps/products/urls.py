from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ProductViewSet, WarehouseViewSet

router = DefaultRouter()
router.register("products", ProductViewSet, basename="product")
router.register("warehouses", WarehouseViewSet, basename="warehouse")

urlpatterns = [
    path("", include(router.urls)),
]
