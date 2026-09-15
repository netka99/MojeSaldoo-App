from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import SupplierOrderViewSet

router = DefaultRouter()
router.register("", SupplierOrderViewSet, basename="supplier-order")

urlpatterns = [path("", include(router.urls))]
