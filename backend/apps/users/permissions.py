from rest_framework import permissions

from .models import CompanyModule


def company_has_module(company, module_key: str) -> bool:
    """Sprawdza czy firma ma włączony dany moduł."""
    return CompanyModule.objects.filter(
        company=company,
        module=module_key,
        is_enabled=True,
    ).exists()


class IsCompanyMember(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False
        return (
            user.current_company is not None
            and user.memberships.filter(
                company=user.current_company, is_active=True
            ).exists()
        )


class IsCompanyAdmin(IsCompanyMember):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.user.memberships.filter(
            company=request.user.current_company,
            role__in=["admin"],
            is_active=True,
        ).exists()


class ModuleRequired(permissions.BasePermission):
    """
    Blokuje dostęp do ViewSet jeśli firma nie ma włączonego modułu.

    Użycie w ViewSet:
        module_required = 'van_routes'
        permission_classes = [IsAuthenticated, ModuleRequired]

    Zwraca HTTP 403 jeśli moduł wyłączony.
    Przepuszcza jeśli ViewSet nie ma atrybutu module_required.
    """
    message = "Ten moduł nie jest aktywny dla Twojej firmy."

    def has_permission(self, request, view):
        module_key = getattr(view, 'module_required', None)
        if not module_key:
            return True
        company = getattr(request.user, 'current_company', None)
        if not company:
            return False
        return company_has_module(company, module_key)
