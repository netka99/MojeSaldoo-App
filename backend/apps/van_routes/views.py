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
from .services import _validate_orders_for_route, close_route, confirm_loading, create_van_route, start_loading


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

    @action(detail=True, methods=["post"], url_path="add-orders")
    def add_orders_action(self, request, pk=None):
        """Add orders to a planned route. Only allowed while status is 'planned'."""
        route = self.get_object()
        if route.status != VanRoute.STATUS_PLANNED:
            return Response(
                {"detail": "Orders can only be added to a planned route."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        order_ids = request.data.get("order_ids", [])
        if not order_ids:
            return Response({"detail": "order_ids is required."}, status=status.HTTP_400_BAD_REQUEST)

        from apps.orders.models import Order

        company_id = request.user.current_company_id
        # Exclude already-assigned orders
        existing_ids = set(route.orders.values_list("id", flat=True))
        new_ids = [oid for oid in order_ids if str(oid) not in {str(e) for e in existing_ids}]
        if not new_ids:
            return Response(VanRouteDetailSerializer(route).data)

        try:
            orders = _validate_orders_for_route(company_id, new_ids)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        route.orders.add(*orders)

        # Backfill van_route FK on any WZ already created for these orders
        # so the route document trail is complete regardless of where the WZ was created.
        from apps.delivery.models import DeliveryDocument
        DeliveryDocument.objects.filter(
            order__in=orders,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            van_route__isnull=True,
            company_id=company_id,
        ).update(van_route=route)

        route.refresh_from_db()
        return Response(VanRouteDetailSerializer(route).data)

    @action(detail=True, methods=["post"], url_path="remove-orders")
    def remove_orders_action(self, request, pk=None):
        """Remove orders from a planned route. Only allowed while status is 'planned'."""
        route = self.get_object()
        if route.status != VanRoute.STATUS_PLANNED:
            return Response(
                {"detail": "Orders can only be removed from a planned route."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        order_ids = request.data.get("order_ids", [])
        if not order_ids:
            return Response({"detail": "order_ids is required."}, status=status.HTTP_400_BAD_REQUEST)

        from apps.orders.models import Order

        orders_to_remove = Order.objects.filter(
            company_id=request.user.current_company_id,
            id__in=order_ids,
            van_routes=route,
        )
        route.orders.remove(*orders_to_remove)
        return Response(VanRouteDetailSerializer(route).data)

    @action(detail=True, methods=["post"], url_path="close")
    def close_action(self, request, pk=None):
        """Mark route closed after reconciliation."""
        route = self.get_object()
        route = close_route(route)
        return Response(VanRouteDetailSerializer(route).data)
