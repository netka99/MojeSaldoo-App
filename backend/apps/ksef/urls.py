from django.urls import path

from .views import (
    KSeFSessionView,
    KorMatchView,
    ReceivedInvoiceDownloadView,
    ReceivedInvoicesView,
    ReceivedInvoiceParseView,
    ReceivedInvoicesSyncView,
    KSeFProductMappingView,
    InvoiceOpexTagView,
    PaperScanView,
)

urlpatterns = [
    path("session/", KSeFSessionView.as_view(), name="ksef-session"),
    path("inbox/", ReceivedInvoicesView.as_view(), name="ksef-inbox"),
    path("inbox/sync/", ReceivedInvoicesSyncView.as_view(), name="ksef-inbox-sync"),
    path("inbox/<str:ksef_reference_number>/xml/", ReceivedInvoiceDownloadView.as_view(), name="ksef-inbox-xml"),
    path("inbox/<str:ksef_reference_number>/parse/", ReceivedInvoiceParseView.as_view(), name="ksef-inbox-parse"),
    path("inbox/<str:ksef_reference_number>/opex/", InvoiceOpexTagView.as_view(), name="ksef-inbox-opex"),
    path("inbox/<str:ksef_reference_number>/kor-match/", KorMatchView.as_view(), name="ksef-inbox-kor-match"),
    path("product-mappings/", KSeFProductMappingView.as_view(), name="ksef-product-mappings"),
    path("scan-paper/", PaperScanView.as_view(), name="ksef-scan-paper"),
]
