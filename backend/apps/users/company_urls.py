from django.urls import path

from .certificate_views import KSeFCertificateStatusView, KSeFCertificateUploadView
from .views import (
    CompanyCreateView,
    CompanyDetailView,
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
        "<uuid:company_id>/certificate/status/",
        KSeFCertificateStatusView.as_view(),
        name="company-ksef-certificate-status",
    ),
    path(
        "<uuid:company_id>/certificate/",
        KSeFCertificateUploadView.as_view(),
        name="company-ksef-certificate",
    ),
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
    path("<uuid:pk>/", CompanyDetailView.as_view(), name="company-detail"),
]
