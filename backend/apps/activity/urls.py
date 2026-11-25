from django.urls import path
from .views import ActivityLogView, AuditLogView, AuditLogExportView

urlpatterns = [
    path("activity/", ActivityLogView.as_view(), name="activity-log"),
    path("activity/audit/", AuditLogView.as_view(), name="audit-log"),
    path("activity/audit/export/", AuditLogExportView.as_view(), name="audit-log-export"),
]
