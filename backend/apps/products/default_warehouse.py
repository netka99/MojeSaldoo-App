"""One implicit main warehouse when the company does not manage locations."""

from __future__ import annotations


def ensure_default_warehouse(company, user=None):
    """Return the company's main warehouse, creating Magazyn główny if missing.

    ``Warehouse.code`` is globally unique, so the code is derived from the company uuid.
    """
    from .models import Warehouse

    existing = (
        Warehouse.objects.filter(
            company=company,
            warehouse_type=Warehouse.WarehouseType.MAIN,
            is_active=True,
        )
        .order_by("created_at")
        .first()
    )
    if existing:
        return existing

    if user is None:
        membership = (
            company.memberships.filter(is_active=True).select_related("user").first()
        )
        user = membership.user if membership else None
    if user is None:
        return None

    suffix = str(company.uuid).replace("-", "")[:8]
    return Warehouse.objects.create(
        company=company,
        user=user,
        code=f"MG{suffix}"[:10],
        name="Magazyn główny",
        warehouse_type=Warehouse.WarehouseType.MAIN,
        is_active=True,
    )


def company_needs_stock_ledger(company) -> bool:
    from apps.users.models import CompanyModule

    return CompanyModule.objects.filter(
        company=company,
        is_enabled=True,
        module__in=("production", "purchasing", "delivery"),
    ).exists()


def warehouses_module_enabled(company) -> bool:
    from apps.users.models import CompanyModule

    return CompanyModule.objects.filter(
        company=company, module="warehouses", is_enabled=True
    ).exists()


def ensure_silent_default_warehouse(company, user=None):
    """Create MG only when stock is needed and the company does not manage warehouses."""
    from .models import Warehouse

    if warehouses_module_enabled(company):
        return (
            Warehouse.objects.filter(
                company=company,
                warehouse_type=Warehouse.WarehouseType.MAIN,
                is_active=True,
            )
            .order_by("created_at")
            .first()
        )
    if not company_needs_stock_ledger(company):
        return None
    return ensure_default_warehouse(company, user)
