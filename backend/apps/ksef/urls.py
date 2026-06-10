from django.urls import path

from .views import KSeFSessionView, ReceivedInvoiceDownloadView, ReceivedInvoicesView, ReceivedInvoiceParseView, ReceivedInvoicesSyncView, KSeFProductMappingView

urlpatterns = [
    path("session/", KSeFSessionView.as_view(), name="ksef-session"),
    path("inbox/", ReceivedInvoicesView.as_view(), name="ksef-inbox"),
    path("inbox/sync/", ReceivedInvoicesSyncView.as_view(), name="ksef-inbox-sync"),
    path("inbox/<str:ksef_reference_number>/xml/", ReceivedInvoiceDownloadView.as_view(), name="ksef-inbox-xml"),
    path("inbox/<str:ksef_reference_number>/parse/", ReceivedInvoiceParseView.as_view(), name="ksef-inbox-parse"),
    path("product-mappings/", KSeFProductMappingView.as_view(), name="ksef-product-mappings"),
]
