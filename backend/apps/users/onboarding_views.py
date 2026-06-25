"""
POST /api/auth/onboarding/complete/

Receives the activity tiles + delivery method chosen during onboarding,
activates the corresponding CompanyModule rows, infers company_type, and
marks onboarding_completed = True on the current company.
"""
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Company, CompanyModule

# ---------------------------------------------------------------------------
# Tile → module mapping
# ---------------------------------------------------------------------------

TILE_MODULE_MAP: dict[str, list[str]] = {
    "purchasing": ["purchasing", "ksef_inbox"],
    "production": ["production", "warehouses", "products"],
    "warehouses": ["warehouses", "products"],
    "cost_allocation": ["cost_allocation", "ksef_inbox"],
}

DELIVERY_MODULE_MAP: dict[str, list[str]] = {
    "van_routes": ["delivery", "van_routes"],
    "delivery":   ["delivery"],
    "docs_only":  ["delivery"],
}

# Modules that are always enabled regardless of tile selection.
CORE_MODULES = ["invoicing", "ksef", "customers", "orders", "reporting", "products"]


def _infer_company_type(modules: set[str]) -> str:
    if "production" in modules:
        return Company.COMPANY_TYPE_PRODUCTION
    if "van_routes" in modules and "purchasing" in modules:
        return Company.COMPANY_TYPE_VAN
    if "warehouses" in modules or "purchasing" in modules:
        return Company.COMPANY_TYPE_WAREHOUSE
    if "cost_allocation" in modules or not (modules - set(CORE_MODULES)):
        return Company.COMPANY_TYPE_INVOICING
    return Company.COMPANY_TYPE_MIXED


class OnboardingCompleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        company = request.user.current_company
        if not company:
            return Response(
                {"detail": "Brak aktywnej firmy. Utwórz firmę przed ukończeniem onboardingu."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        activity_tiles: list[str] = request.data.get("activity_tiles", [])
        delivery_method: str | None = request.data.get("delivery_method")

        valid_tiles = set(TILE_MODULE_MAP.keys())
        invalid = [t for t in activity_tiles if t not in valid_tiles]
        if invalid:
            return Response(
                {"detail": f"Nieznane kafelki: {', '.join(invalid)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        valid_delivery = set(DELIVERY_MODULE_MAP.keys()) | {None}
        if delivery_method not in valid_delivery:
            return Response(
                {"detail": f"Nieznana metoda dostawy: {delivery_method}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Build set of modules to enable.
        to_enable: set[str] = set(CORE_MODULES)
        for tile in activity_tiles:
            to_enable.update(TILE_MODULE_MAP.get(tile, []))
        if delivery_method:
            to_enable.update(DELIVERY_MODULE_MAP.get(delivery_method, []))

        # Enable selected modules, disable the rest.
        now = timezone.now()
        valid_module_keys = {k for k, _ in CompanyModule.MODULE_CHOICES}
        for key, _ in CompanyModule.MODULE_CHOICES:
            row, _ = CompanyModule.objects.get_or_create(
                company=company, module=key, defaults={"is_enabled": False}
            )
            should_enable = key in to_enable
            if row.is_enabled != should_enable:
                row.is_enabled = should_enable
                row.enabled_at = now if should_enable else None
                row.save(update_fields=["is_enabled", "enabled_at"])

        # Update company metadata.
        company.company_type = _infer_company_type(to_enable)
        company.onboarding_completed = True
        company.save(update_fields=["company_type", "onboarding_completed"])

        modules_response = {
            row.module: row.is_enabled
            for row in CompanyModule.objects.filter(company=company)
            if row.module in valid_module_keys
        }

        return Response(
            {
                "company_type": company.company_type,
                "onboarding_completed": True,
                "modules": modules_response,
            },
            status=status.HTTP_200_OK,
        )
