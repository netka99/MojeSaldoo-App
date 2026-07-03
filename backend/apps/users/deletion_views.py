from uuid import uuid4

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Company,
    CompanyMembership,
    FCMDeviceToken,
    KSeFCertificate,
    User,
    WebPushSubscription,
)


def _anonymize_user(user: User) -> None:
    """Anonymize a User record in-place. Caller must call user.save()."""
    uid = uuid4().hex
    user.username = f"deleted_{uid[:12]}"
    user.email = f"deleted_{uid}@deleted.invalid"
    user.first_name = ""
    user.last_name = ""
    user.phone_number = ""
    user.is_active = False


class CompanyDeleteView(APIView):
    """
    DELETE /api/companies/<uuid:company_id>/delete/
    Body: { "confirm_name": "<company name>" }

    Admin-only. Immediately soft-deletes the company and anonymizes all members
    who have no other active memberships. Tax/accounting documents are retained.
    """

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, company_id):
        company = get_object_or_404(Company, pk=company_id, deleted_at__isnull=True)

        membership = (
            CompanyMembership.objects.select_related("company_role")
            .filter(user=request.user, company=company, is_active=True)
            .first()
        )
        if not membership or not membership.is_admin_member():
            return Response(
                {"detail": "Tylko administrator może usunąć firmę."},
                status=status.HTTP_403_FORBIDDEN,
            )

        confirm_name = (request.data or {}).get("confirm_name", "")
        if confirm_name != company.name:
            return Response(
                {"detail": "Nazwa firmy nie pasuje."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            # Collect all user IDs in this company before deleting memberships
            member_user_ids = list(
                CompanyMembership.objects.filter(company=company).values_list("user_id", flat=True)
            )

            # 1. Soft-delete the company — anonymize PII fields
            company.deleted_at = timezone.now()
            company.is_active = False
            company.name = f"Firma usunięta [{company.nip or str(company.id)[:8]}]"
            company.email = ""
            company.phone = ""
            company.address = ""
            company.city = ""
            company.postal_code = ""
            company.save()

            # 2. Hard-delete sensitive credentials
            KSeFCertificate.objects.filter(company=company).delete()
            # KSeFSession is in the ksef app — import lazily to avoid circular deps
            from apps.ksef.models import KSeFSession  # noqa: PLC0415
            KSeFSession.objects.filter(company=company).delete()

            # 3. Hard-delete push tokens for all members
            WebPushSubscription.objects.filter(user_id__in=member_user_ids).delete()
            FCMDeviceToken.objects.filter(user_id__in=member_user_ids).delete()

            # 4. Hard-delete all memberships
            CompanyMembership.objects.filter(company=company).delete()

            # 5. Anonymize users who now have no remaining memberships
            remaining = set(
                CompanyMembership.objects.filter(user_id__in=member_user_ids).values_list("user_id", flat=True)
            )
            to_anonymize = [uid for uid in member_user_ids if uid not in remaining]
            for user in User.objects.filter(pk__in=to_anonymize):
                _anonymize_user(user)
                user.current_company = None
                user.save()

            # 6. If the current user was not anonymized, still clear current_company
            if request.user.pk not in to_anonymize:
                User.objects.filter(pk=request.user.pk).update(current_company=None)

        return Response({"detail": "Firma została usunięta."}, status=status.HTTP_200_OK)


class CompanyLeaveView(APIView):
    """
    DELETE /api/companies/<uuid:company_id>/leave/

    Any active member can leave. Blocked if user is the sole admin.
    Anonymizes user if they have no remaining memberships after leaving.
    """

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, company_id):
        company = get_object_or_404(Company, pk=company_id, deleted_at__isnull=True)

        membership = (
            CompanyMembership.objects.select_related("company_role")
            .filter(user=request.user, company=company, is_active=True)
            .first()
        )
        if not membership:
            return Response(
                {"detail": "Nie jesteś członkiem tej firmy."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Block if user is the sole admin
        if membership.is_admin_member():
            admin_count = 0
            for m in CompanyMembership.objects.select_related("company_role").filter(
                company=company, is_active=True
            ):
                if m.is_admin_member():
                    admin_count += 1
            if admin_count <= 1:
                return Response(
                    {
                        "detail": (
                            "Jesteś jedynym administratorem. "
                            "Przed odejściem nadaj uprawnienia administratora innemu członkowi."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        with transaction.atomic():
            membership.delete()

            # Anonymize if no other memberships remain
            has_other = CompanyMembership.objects.filter(user=request.user).exists()
            if not has_other:
                _anonymize_user(request.user)
                request.user.current_company = None
                request.user.save()
            elif request.user.current_company_id == company.pk:
                User.objects.filter(pk=request.user.pk).update(current_company=None)

        return Response({"detail": "Opuściłeś firmę."}, status=status.HTTP_200_OK)
