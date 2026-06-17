from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ProductionOrderViewSet, RecipeViewSet

router = DefaultRouter()
router.register("recipes", RecipeViewSet, basename="recipe")
router.register("orders", ProductionOrderViewSet, basename="production-order")

urlpatterns = [
    path("", include(router.urls)),
]
