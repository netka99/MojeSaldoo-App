from rest_framework.routers import DefaultRouter

from .views import PurchaseDocumentViewSet

router = DefaultRouter()
router.register(r"purchase-documents", PurchaseDocumentViewSet, basename="purchase-documents")

urlpatterns = router.urls
