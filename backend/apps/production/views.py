from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.users.permissions import IsCompanyMember
from apps.users.tenant import filter_queryset_for_current_company

from .models import ProductionOrder, Recipe
from .serializers import (
    ProductionOrderCreateSerializer,
    ProductionOrderSerializer,
    RecipeSerializer,
    RecipeWriteSerializer,
)
from .services import complete_production_order


class RecipeViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsCompanyMember]
    pagination_class = None

    def get_queryset(self):
        qs = (
            Recipe.objects.all()
            .select_related("product")
            .prefetch_related("items", "items__ingredient")
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
    permission_classes = [IsAuthenticated, IsCompanyMember]

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
