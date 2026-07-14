from rest_framework import filters, viewsets
from rest_framework.permissions import IsAuthenticated

from apps.users.permissions import HasCompanyPermission, IsCompanyMember

from .models import FixedCost
from .serializers import FixedCostSerializer


class FixedCostViewSet(viewsets.ModelViewSet):
    """
    CRUD for a company's recurring fixed costs (salaries, ZUS, rent, etc.).

    These are manually entered monthly amounts that do not come through KSeF.
    The P&L endpoint uses them to compute net operating profit.
    """

    lookup_field = "uuid"
    required_permission = "can_manage_accounting"
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]
    pagination_class = None
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ["category", "amount_monthly", "active_from", "created_at"]
    ordering = ["category", "description"]

    def get_queryset(self):
        return FixedCost.objects.filter(
            company=self.request.user.current_company,
        )

    def get_serializer_class(self):
        return FixedCostSerializer
