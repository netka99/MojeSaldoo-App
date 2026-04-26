"""Delivery document API under ``/api/delivery/``."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DeliveryDocumentViewSet

router = DefaultRouter()
router.register("", DeliveryDocumentViewSet, basename="delivery-document")

urlpatterns = [
    path("", include(router.urls)),
]
