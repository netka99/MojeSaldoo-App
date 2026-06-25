from datetime import date as _date

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.users.permissions import HasCompanyPermission, IsCompanyMember
from apps.users.tenant import filter_queryset_for_current_company

from .models import ProductionOrder, Recipe
from .serializers import (
    ProductionOrderCreateSerializer,
    ProductionOrderSerializer,
    RecipeSerializer,
    RecipeWriteSerializer,
)
from .services import complete_production_order, get_production_planning


def _parse_date(raw: str | None) -> _date | None:
    if not raw:
        return None
    try:
        return _date.fromisoformat(raw)
    except ValueError:
        return None


class RecipeViewSet(viewsets.ModelViewSet):
    required_permission = 'can_manage_production'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]
    pagination_class = None

    def get_queryset(self):
        qs = (
            Recipe.objects.all()
            .select_related("product")
            .prefetch_related("items", "items__ingredient", "items__ingredient__stocks")
            .order_by("product__name")
        )
        return filter_queryset_for_current_company(qs, self.request.user)

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return RecipeWriteSerializer
        return RecipeSerializer

    def perform_create(self, serializer):
        serializer.save(company=self.request.user.current_company)

    def perform_update(self, serializer):
        serializer.save()


class ProductionOrderViewSet(viewsets.ModelViewSet):
    required_permission = 'can_manage_production'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def get_queryset(self):
        qs = (
            ProductionOrder.objects.all()
            .select_related("recipe", "recipe__product", "rw_document", "pw_document")
            .prefetch_related("inputs", "inputs__ingredient")
            .order_by("-date", "-created_at")
        )
        return filter_queryset_for_current_company(qs, self.request.user)

    def get_serializer_class(self):
        if self.action == "create":
            return ProductionOrderCreateSerializer
        return ProductionOrderSerializer

    def perform_create(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            created_by=self.request.user,
        )

    def perform_destroy(self, instance):
        if instance.status == ProductionOrder.STATUS_COMPLETED:
            raise ValidationError({"detail": "Nie można usunąć zakończonego zlecenia."})
        super().perform_destroy(instance)

    @action(detail=False, methods=["get"], url_path="planning")
    def planning(self, request):
        """
        GET /api/production/orders/planning/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

        Aggregates open-order demand by finished product, cross-referenced with
        active recipes. Shows stock shortfall, estimated production cost, and
        per-ingredient requirements.
        """
        company = request.user.current_company
        items = get_production_planning(
            company=company,
            date_from=_parse_date(request.query_params.get("date_from")),
            date_to=_parse_date(request.query_params.get("date_to")),
        )
        return Response(items)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        """
        POST /api/production/orders/{id}/complete/
        Finalize the production order: consume FIFO stock, create RW+PW, update avg_cost.
        """
        order = self.get_object()
        try:
            completed = complete_production_order(order, request.user)
        except ValidationError:
            raise
        except Exception as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        return Response(
            ProductionOrderSerializer(completed, context=self.get_serializer_context()).data
        )
