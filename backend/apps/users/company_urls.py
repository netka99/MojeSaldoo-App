from django.urls import path

from .certificate_views import KSeFCertificateStatusView, KSeFCertificateUploadView
from .deletion_views import CompanyDeleteView, CompanyLeaveView
from .views import (
    CompanyCreateView,
    CompanyDetailView,
    CompanyMeListView,
    CompanyMemberDetailView,
    CompanyMembersListView,
    CompanyModuleEnableView,
    CompanyModulesListView,
    CompanyRoleDetailView,
    CompanyRolesListView,
    CompanyWorkflowSettingsView,
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
    path(
        "<uuid:company_id>/workflow-settings/",
        CompanyWorkflowSettingsView.as_view(),
        name="company-workflow-settings",
    ),
    # Team management
    path(
        "<uuid:company_id>/roles/<uuid:role_id>/",
        CompanyRoleDetailView.as_view(),
        name="company-role-detail",
    ),
    path(
        "<uuid:company_id>/roles/",
        CompanyRolesListView.as_view(),
        name="company-roles-list",
    ),
    path(
        "<uuid:company_id>/members/<uuid:membership_id>/",
        CompanyMemberDetailView.as_view(),
        name="company-member-detail",
    ),
    path(
        "<uuid:company_id>/members/",
        CompanyMembersListView.as_view(),
        name="company-members-list",
    ),
    path("<uuid:company_id>/delete/", CompanyDeleteView.as_view(), name="company-delete"),
    path("<uuid:company_id>/leave/", CompanyLeaveView.as_view(), name="company-leave"),
    path("<uuid:pk>/", CompanyDetailView.as_view(), name="company-detail"),
]
