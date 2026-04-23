"""Resolve the active Company for an authenticated user (session + membership)."""

from apps.users.models import Company, CompanyMembership


def filter_queryset_for_current_company(queryset, user):
    """Scope a queryset to ``user.current_company`` (empty if unset or anonymous)."""
    if not user.is_authenticated:
        return queryset.none()
    cc_id = getattr(user, "current_company_id", None)
    if cc_id is None:
        return queryset.none()
    return queryset.filter(company_id=cc_id)


def get_request_company(user):
    """
    Prefer ``user.current_company`` when set and active; otherwise first active
    membership; otherwise bootstrap a personal org + admin membership.
    """
    if not user.is_authenticated:
        raise ValueError("get_request_company requires an authenticated user.")

    cc_id = getattr(user, "current_company_id", None)
    if cc_id:
        co = Company.objects.filter(pk=cc_id, is_active=True).first()
        if co is not None:
            return co

    m = (
        CompanyMembership.objects.filter(user=user, is_active=True)
        .select_related("company")
        .first()
    )
    if m is not None:
        return m.company

    co = Company.objects.create(name=f"{user.username}'s organization", is_active=True)
    CompanyMembership.objects.create(
        user=user,
        company=co,
        role="admin",
        is_active=True,
    )
    return co
