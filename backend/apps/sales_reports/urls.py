from rest_framework.routers import DefaultRouter
from .views import DailySalesReportViewSet, SalesReportTemplateViewSet

router = DefaultRouter()
router.register(r"reports", DailySalesReportViewSet, basename="sales-report")
router.register(r"templates", SalesReportTemplateViewSet, basename="sales-template")

urlpatterns = router.urls
