from rest_framework.routers import DefaultRouter

from .views import FixedCostViewSet

router = DefaultRouter()
router.register(r"fixed-costs", FixedCostViewSet, basename="fixed-cost")

urlpatterns = router.urls
