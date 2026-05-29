"""ViewSet for VanRoute."""

from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.products.models import Warehouse
from apps.users.tenant import filter_queryset_for_current_company

from .models import VanRoute
from .serializers import (
    VanRouteCreateSerializer,
    VanRouteDetailSerializer,
    VanRouteListSerializer,
    VanRoutePatchSerializer,
    VanRouteStartLoadingSerializer,
)
from .services import close_route, confirm_loading, create_van_route, start_loading


class VanRouteViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = VanRoute.objects.select_related(
            "van_warehouse", "main_warehouse", "mm_document"
        ).prefetch_related("orders")
        return filter_queryset_for_current_company(qs, self.request.user)

    def get_serializer_class(self):
        if self.action == "list":
            return VanRouteListSerializer
        if self.action in ("retrieve", "start_loading", "confirm_loading", "close"):
            return VanRouteDetailSerializer
        if self.action == "create":
            return VanRouteCreateSerializer
        if self.action == "partial_update":
            return VanRoutePatchSerializer
        return VanRouteDetailSerializer

    # ── CRUD ──────────────────────────────────────────────────────────────────

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        serializer = VanRouteListSerializer(qs, many=True)
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        ser = VanRouteCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        company_id = request.user.current_company_id

        van_wh = get_object_or_404(
            Warehouse.objects.filter(company_id=company_id),
            pk=data["van_warehouse_id"],
        )
        main_wh = get_object_or_404(
            Warehouse.objects.filter(company_id=company_id),
            pk=data["main_warehouse_id"],
        )

        route = create_van_route(
            company_id=company_id,
            user=request.user,
            date=data["date"],
            driver_name=data.get("driver_name", ""),
            van_name=data.get("van_name", ""),
            van_warehouse=van_wh,
            main_warehouse=main_wh,
            order_ids=data.get("order_ids", []),
        )

        out = VanRouteDetailSerializer(route)
        return Response(out.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        route = self.get_object()
        ser = VanRoutePatchSerializer(route, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(VanRouteDetailSerializer(route).data)

    def destroy(self, request, *args, **kwargs):
        route = self.get_object()
        if not route.is_editable:
            return Response(
                {"detail": "Only planned routes can be deleted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        route.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Actions ───────────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="start-loading")
    def start_loading_action(self, request, pk=None):
        """Create MM document and transition route to 'loading'."""
        route = self.get_object()
        ser = VanRouteStartLoadingSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        items = [
            {"product_id": i["product_id"], "quantity": i["quantity"]}
            for i in ser.validated_data["items"]
        ]
        route = start_loading(route, user=request.user, items=items)
        return Response(VanRouteDetailSerializer(route).data)

    @action(detail=True, methods=["post"], url_path="confirm-loading")
    def confirm_loading_action(self, request, pk=None):
        """Driver confirms van is loaded; route goes in_progress."""
        route = self.get_object()
        route = confirm_loading(route)
        return Response(VanRouteDetailSerializer(route).data)

    @action(detail=True, methods=["post"], url_path="close")
    def close_action(self, request, pk=None):
        """Mark route closed after reconciliation."""
        route = self.get_object()
        route = close_route(route)
        return Response(VanRouteDetailSerializer(route).data)
