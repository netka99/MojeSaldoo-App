from rest_framework import filters, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.activity.log import log_activity
from apps.activity.models import ActivityLog
from apps.users.permissions import HasCompanyPermission, IsCompanyMember, ModuleRequired

from .models import Supplier
from .serializers import SupplierListSerializer, SupplierSerializer


class SupplierViewSet(viewsets.ModelViewSet):
    lookup_field = "uuid"
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

    def perform_create(self, serializer):
        instance = serializer.save()
        log_activity(
            user=self.request.user,
            action="supplier.create",
            status=ActivityLog.STATUS_SUCCESS,
            object_type="supplier",
            object_id=instance.name,
        )

    def perform_update(self, serializer):
        instance = serializer.save()
        log_activity(
            user=self.request.user,
            action="supplier.update",
            status=ActivityLog.STATUS_SUCCESS,
            object_type="supplier",
            object_id=instance.name,
        )

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        name = instance.name
        instance.delete()
        log_activity(
            user=request.user,
            action="supplier.delete",
            status=ActivityLog.STATUS_SUCCESS,
            object_type="supplier",
            object_id=name,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
