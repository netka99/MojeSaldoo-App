from django.urls import path

from .views import (
    CompanyCreateView,
    CompanyMeListView,
    CompanyModuleEnableView,
    CompanyModulesListView,
    SwitchCompanyView,
)

urlpatterns = [
    path("", CompanyCreateView.as_view(), name="company-create"),
    path("me/", CompanyMeListView.as_view(), name="company-me-list"),
    path("switch/", SwitchCompanyView.as_view(), name="company-switch"),
    path(
        "<uuid:company_id>/modules/<str:module_key>/",
        CompanyModuleEnableView.as_view(),
        name="company-module-enable",
    ),
    path(
        "<uuid:company_id>/modules/",
        CompanyModulesListView.as_view(),
        name="company-modules-list",
    ),
]
