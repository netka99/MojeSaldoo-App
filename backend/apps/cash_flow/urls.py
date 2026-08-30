from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CashFlowDashboardView,
    CashFlowHistoryView,
    CashFlowHarmonogramView,
    CashFlowPeriodSummaryView,
    CompanyOpexCategoryViewSet,
    CompanyTaxConfigView,
    DailyB2CRevenueViewSet,
    ExpenseChartView,
    QuickExpenseViewSet,
)

router = DefaultRouter()
router.register(r"quick-expenses", QuickExpenseViewSet, basename="quick-expense")
router.register(r"b2c-revenue", DailyB2CRevenueViewSet, basename="b2c-revenue")
router.register(r"opex-categories", CompanyOpexCategoryViewSet, basename="opex-category")

urlpatterns = [
    path("", include(router.urls)),
    path("tax-config/", CompanyTaxConfigView.as_view(), name="cash-flow-tax-config"),
    path("dashboard/", CashFlowDashboardView.as_view(), name="cash-flow-dashboard"),
    path("expense-chart/", ExpenseChartView.as_view(), name="expense-chart"),
    path("history/", CashFlowHistoryView.as_view(), name="cash-flow-history"),
    path("period-summary/", CashFlowPeriodSummaryView.as_view(), name="cash-flow-period-summary"),
    path("harmonogram/", CashFlowHarmonogramView.as_view(), name="cash-flow-harmonogram"),
]
