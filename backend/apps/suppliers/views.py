from rest_framework import filters, viewsets
from rest_framework.permissions import IsAuthenticated

from apps.users.permissions import HasCompanyPermission, IsCompanyMember, ModuleRequired

from .models import Supplier
from .serializers import SupplierListSerializer, SupplierSerializer


class SupplierViewSet(viewsets.ModelViewSet):
    module_required = 'purchasing'
    required_permission = 'can_manage_purchasing'
    permission_classes = [IsAuthenticated, IsCompanyMember, ModuleRequired, HasCompanyPermission]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'nip', 'city']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def get_queryset(self):
        return Supplier.objects.filter(
            company=self.request.user.current_company,
            is_active=True,
        )

    def get_serializer_class(self):
        if self.action == 'list':
            return SupplierListSerializer
        return SupplierSerializer
