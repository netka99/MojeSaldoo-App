from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import InventoryCountViewSet

router = DefaultRouter()
router.register("", InventoryCountViewSet, basename="inventory-count")

urlpatterns = [path("", include(router.urls))]
