"""KSeF certificate upload, status, and delete (multipart PEM + encrypted private key)."""

import os
from zoneinfo import ZoneInfo

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone as django_timezone
from rest_framework import permissions, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

import logging

from .ksef_crypto import encrypt_private_key_pem, parse_certificate_and_key
from .models import Company, CompanyMembership, KSeFCertificate, User
from apps.activity.log import log_error, log_success

logger = logging.getLogger(__name__)

_PL = ZoneInfo("Europe/Warsaw")


def _company_for_user(company_id, user) -> Company:
    return get_object_or_404(Company, uuid=company_id)


def _is_member(company: Company, user) -> bool:
    return CompanyMembership.objects.filter(
        user=user, company=company, is_active=True
    ).exists()


def _can_manage_certificate(company: Company, user) -> bool:
    return CompanyMembership.objects.filter(
        user=user,
        company=company,
        is_active=True,
        role__in=["admin", "manager"],
    ).exists()


def _now_local_date():
    return django_timezone.now().astimezone(_PL).date()


def _cert_validity_state(row: KSeFCertificate) -> tuple[bool, bool, bool]:
    """
    Returns (valid, expired, in_future) using calendar dates in Europe/Warsaw.
    """
    if not row.is_active or row.valid_from is None or row.valid_until is None:
        return False, False, False
    today = _now_local_date()
    if today > row.valid_until:
        return False, True, False
    if today < row.valid_from:
        return False, False, True
    return True, False, False


def _stored_filename(uploaded_file) -> str:
    """Keep only the basename the user picked. Never a path."""
    raw = getattr(uploaded_file, "name", "") or ""
    name = os.path.basename(raw.replace("\\", "/"))
    name = "".join(ch for ch in name if ch.isprintable() and ch not in "\r\n\t")
    name = name.strip().strip(".")
    return name[:255]


def _status_payload(row: KSeFCertificate | None) -> dict:
    if row is None:
        return {
            "uploaded": False,
            "valid": False,
            "expired": False,
            "not_yet_valid": False,
            "is_active": False,
            "subject_name": None,
            "certificate_filename": None,
            "key_filename": None,
            "valid_from": None,
            "valid_until": None,
            "uploaded_at": None,
        }
    valid, expired, in_future = _cert_validity_state(row)
    return {
        "uploaded": True,
        "valid": valid and row.is_active,
        "expired": expired,
        "not_yet_valid": in_future,
        "is_active": row.is_active,
        "subject_name": row.subject_name or None,
        "certificate_filename": row.certificate_filename or None,
        "key_filename": row.key_filename or None,
        "valid_from": row.valid_from.isoformat() if row.valid_from else None,
        "valid_until": row.valid_until.isoformat() if row.valid_until else None,
        "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else None,
    }


def _public_metadata_row(row: KSeFCertificate) -> dict:
    return {
        "id": str(row.id),
        "subject_name": row.subject_name,
        "certificate_filename": row.certificate_filename or None,
        "key_filename": row.key_filename or None,
        "valid_from": row.valid_from.isoformat() if row.valid_from else None,
        "valid_until": row.valid_until.isoformat() if row.valid_until else None,
        "is_active": row.is_active,
        "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else None,
    }


def _resolve_environment(company: Company, request_env: str | None) -> str:
    """Return the environment to use: explicit param or company's current setting."""
    if request_env in (KSeFCertificate.ENVIRONMENT_TEST, KSeFCertificate.ENVIRONMENT_DEMO, KSeFCertificate.ENVIRONMENT_PRODUCTION):
        return request_env
    return company.ksef_environment


class KSeFCertificateStatusView(APIView):
    """GET /api/companies/{id}/certificate/status/?environment=demo — any member."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, company_id):
        company = _company_for_user(company_id, request.user)
        if not _is_member(company, request.user):
            return Response(
                {"detail": "You are not a member of this company."},
                status=status.HTTP_403_FORBIDDEN,
            )
        env = _resolve_environment(company, request.query_params.get("environment"))
        row = KSeFCertificate.objects.filter(company=company, environment=env).first()
        return Response(_status_payload(row))


class KSeFCertificateUploadView(APIView):
    """POST/DELETE /api/companies/{id}/certificate/ — admin or manager."""

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, company_id):
        company = _company_for_user(company_id, request.user)
        if not _is_member(company, request.user):
            return Response(
                {"detail": "You are not a member of this company."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not _can_manage_certificate(company, request.user):
            return Response(
                {"detail": "Only company admins and managers can upload a certificate."},
                status=status.HTTP_403_FORBIDDEN,
            )
        cert_file = request.FILES.get("certificate_file")
        key_file = request.FILES.get("key_file")
        if not cert_file or not key_file:
            log_error(
                user=request.user, action="company.certificate", error_code="CERTIFICATE_INVALID",
                error_detail="Brak pliku certyfikatu lub klucza.", request=request,
            )
            return Response(
                {"detail": "Fields certificate_file and key_file are required (multipart)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        env = _resolve_environment(company, request.data.get("environment"))
        try:
            cert_bytes = cert_file.read()
            key_bytes = key_file.read()
            parsed = parse_certificate_and_key(cert_bytes, key_bytes)
        except ValueError as e:
            log_error(
                user=request.user, action="company.certificate", error_code="CERTIFICATE_INVALID",
                error_detail=str(e), request=request,
            )
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        enc_key = encrypt_private_key_pem(parsed.private_key_pem)
        uploader = request.user if isinstance(request.user, User) else None
        with transaction.atomic():
            row, created = KSeFCertificate.objects.update_or_create(
                company=company,
                environment=env,
                defaults={
                    "uploaded_by": uploader,
                    "certificate_pem": parsed.certificate_pem,
                    "encrypted_key": enc_key,
                    "subject_name": parsed.subject_name,
                    "certificate_filename": _stored_filename(cert_file),
                    "key_filename": _stored_filename(key_file),
                    "valid_from": parsed.valid_from,
                    "valid_until": parsed.valid_until,
                    "is_active": True,
                },
            )

        status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        log_success(
            user=request.user, action="company.certificate",
            object_type="company", object_id=str(company.uuid),
        )
        return Response(_public_metadata_row(row), status=status_code)

    def delete(self, request, company_id):
        company = _company_for_user(company_id, request.user)
        if not _is_member(company, request.user):
            return Response(
                {"detail": "You are not a member of this company."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not _can_manage_certificate(company, request.user):
            return Response(
                {"detail": "Only company admins and managers can remove a certificate."},
                status=status.HTTP_403_FORBIDDEN,
            )
        env = _resolve_environment(company, request.data.get("environment") or request.query_params.get("environment"))
        deleted, _ = KSeFCertificate.objects.filter(company=company, environment=env).delete()
        if deleted:
            return Response({"ok": True, "deleted": True}, status=status.HTTP_200_OK)
        return Response(
            {"detail": "No certificate is stored for this company."},
            status=status.HTTP_404_NOT_FOUND,
        )
