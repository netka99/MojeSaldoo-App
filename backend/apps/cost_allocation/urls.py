from django.urls import path

from .views import (
    CostAllocationExportView,
    CostProjectDetailView,
    CostProjectListView,
    InvoiceAnnotationView,
)

urlpatterns = [
    path("projects/", CostProjectListView.as_view(), name="cost-projects"),
    path("projects/<uuid:pk>/", CostProjectDetailView.as_view(), name="cost-project-detail"),
    path(
        "invoices/<str:ksef_number>/annotation/",
        InvoiceAnnotationView.as_view(),
        name="invoice-annotation",
    ),
    path("export/", CostAllocationExportView.as_view(), name="cost-allocation-export"),
]
