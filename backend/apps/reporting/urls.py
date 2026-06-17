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
    path("dashboard/", views.DashboardSummaryView.as_view(), name="report-dashboard"),
    path("profit-loss/", views.ProfitLossView.as_view(), name="report-profit-loss"),
    path("profit-loss/month-detail/", views.ProfitLossMonthDetailView.as_view(), name="report-profit-loss-month-detail"),
    path("product-margin/", views.ProductMarginView.as_view(), name="report-product-margin"),
    path("product-margin/product-detail/", views.ProductMarginDetailView.as_view(), name="report-product-margin-detail"),
    path("payment-aging/", views.PaymentAgingView.as_view(), name="report-payment-aging"),
    path("supplier-costs/", views.SupplierCostsView.as_view(), name="report-supplier-costs"),
    path("supplier-costs/detail/", views.SupplierCostsDetailView.as_view(), name="report-supplier-costs-detail"),
    path("expiry-alerts/", views.ExpiryAlertsView.as_view(), name="report-expiry-alerts"),
    path("customer-margin/", views.CustomerMarginView.as_view(), name="report-customer-margin"),
]
