from rest_framework import permissions

from .models import CompanyMembership, CompanyModule


def company_has_module(company, module_key: str) -> bool:
    """Sprawdza czy firma ma włączony dany moduł."""
    return CompanyModule.objects.filter(
        company=company,
        module=module_key,
        is_enabled=True,
    ).exists()


def _get_active_membership(user):
    """Return the user's active membership for their current company, or None."""
    if not user.is_authenticated or not user.current_company_id:
        return None
    return (
        CompanyMembership.objects.select_related("company_role")
        .filter(user=user, company=user.current_company, is_active=True)
        .first()
    )


class IsCompanyMember(permissions.BasePermission):
    def has_permission(self, request, view):
        return _get_active_membership(request.user) is not None


class IsCompanyAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        m = _get_active_membership(request.user)
        return m is not None and m.is_admin_member()


class HasCompanyPermission(permissions.BasePermission):
    """
    Checks a fine-grained permission flag on the user's current company membership.

    Usage in ViewSet:
        required_permission = 'can_manage_customers'   # write actions
        read_permission = 'can_manage_customers'        # optional, defaults to required_permission
        permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    Admins (is_admin_member()) always pass.
    Safe methods (GET, HEAD, OPTIONS) are allowed to any active member unless
    read_permission is also set and the user lacks it.
    """
    message = "Nie masz uprawnień do tej operacji."

    def has_permission(self, request, view):
        m = _get_active_membership(request.user)
        if m is None:
            return False
        if m.is_admin_member():
            return True

        # Choose which flag to check.
        # read_permission explicitly set to None means "open reads to any company member".
        # read_permission not set at all → fall back to required_permission.
        if request.method in permissions.SAFE_METHODS:
            if hasattr(view, 'read_permission'):
                flag = view.read_permission  # None = open, string = check that flag
            else:
                flag = getattr(view, 'required_permission', None)
        else:
            flag = getattr(view, 'required_permission', None)

        if flag is None:
            return True  # no flag specified — allow

        perms = m.get_permissions()
        return perms.get(flag, False)


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
