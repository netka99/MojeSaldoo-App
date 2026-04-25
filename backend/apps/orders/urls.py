"""
Order API routes: ``/api/orders/`` (list/create), ``/api/orders/{id}/`` (detail),
and custom actions: ``confirm``, ``cancel``, ``items``.

Included from ``config.urls`` via ``path("api/orders/", include("apps.orders.urls"))``.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import OrderViewSet

router = DefaultRouter()
router.register("", OrderViewSet, basename="order")

urlpatterns = [
    path("", include(router.urls)),
]
