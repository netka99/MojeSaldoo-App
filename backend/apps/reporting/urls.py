from django.urls import path

from . import views

urlpatterns = [
    path("sales-summary/", views.SalesSummaryView.as_view(), name="report-sales-summary"),
    path("invoices/", views.ReportingInvoiceListView.as_view(), name="report-invoices"),
    path("top-products/", views.TopProductsView.as_view(), name="report-top-products"),
    path(
        "top-customers/",
        views.TopCustomersView.as_view(),
        name="report-top-customers",
    ),
    path("inventory/", views.InventoryReportView.as_view(), name="report-inventory"),
    path("ksef-status/", views.KsefStatusReportView.as_view(), name="report-ksef-status"),
]
