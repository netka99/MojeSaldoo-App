from django.db.models import QuerySet
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.users.tenant import filter_queryset_for_current_company

from .models import Invoice
from .serializers import InvoiceSerializer


class InvoiceViewSet(viewsets.ModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self) -> QuerySet:
        qs = Invoice.objects.all().order_by("-created_at")
        return filter_queryset_for_current_company(qs, self.request.user)

    def perform_create(self, serializer):
        serializer.save(company=self.request.user.current_company)