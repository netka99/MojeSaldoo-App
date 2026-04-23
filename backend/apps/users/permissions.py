from rest_framework import permissions


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
