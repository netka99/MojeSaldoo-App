from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.conf import settings as django_settings
from rest_framework import generics, mixins, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Company, CompanyMembership, CompanyModule, CompanyRole, CompanyWorkflowSettings, FCMDeviceToken, User, WebPushSubscription, get_workflow_settings
from .serializers import (
    AddMemberSerializer,
    CompanyModuleSerializer,
    CompanyRoleSerializer,
    CompanyRoleWriteSerializer,
    CompanySerializer,
    CompanyWorkflowSettingsSerializer,
    SwitchCompanySerializer,
    TeamMemberSerializer,
    UserRegistrationSerializer,
    UserSerializer,
    UserTokenObtainPairSerializer,
)


class UserRegistrationView(generics.CreateAPIView):
    serializer_class = UserRegistrationSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {"user": UserSerializer(user).data},
            status=status.HTTP_201_CREATED,
        )


class UserTokenObtainPairView(TokenObtainPairView):
    serializer_class = UserTokenObtainPairSerializer


class CurrentUserView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({"user": UserSerializer(request.user).data}, status=status.HTTP_200_OK)


def _ensure_company_modules(company: Company) -> None:
    for key, _label in CompanyModule.MODULE_CHOICES:
        CompanyModule.objects.get_or_create(
            company=company,
            module=key,
            defaults={"is_enabled": False},
        )


class CompanyDetailView(generics.RetrieveUpdateAPIView):
    """
    GET/PATCH /api/companies/<uuid>/
    Only companies where the user has an active membership; any member can read/update profile fields.
    """

    serializer_class = CompanySerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = "pk"

    def get_queryset(self):
        return (
            Company.objects.filter(
                memberships__user=self.request.user,
                memberships__is_active=True,
                deleted_at__isnull=True,
            )
            .distinct()
        )


class CompanyCreateView(mixins.CreateModelMixin, generics.GenericAPIView):
    """POST /api/companies/ — create org; creator becomes admin member."""

    serializer_class = CompanySerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        company = serializer.save()
        admin_role = CompanyRole.objects.create(
            company=company,
            name="Administrator",
            is_admin=True,
        )
        CompanyMembership.objects.create(
            user=self.request.user,
            company=company,
            role="admin",
            company_role=admin_role,
            is_active=True,
        )
        _ensure_company_modules(company)

    def post(self, request, *args, **kwargs):
        return self.create(request, *args, **kwargs)


class CompanyMeListView(generics.ListAPIView):
    """GET /api/companies/me/ — companies the current user belongs to."""

    serializer_class = CompanySerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return (
            Company.objects.filter(
                memberships__user=self.request.user,
                memberships__is_active=True,
                deleted_at__isnull=True,
            )
            .distinct()
            .order_by("name")
        )


class CompanyModulesListView(APIView):
    """GET /api/companies/{id}/modules/ — list module flags (seeds rows if needed)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, company_id):
        company = get_object_or_404(Company, pk=company_id)
        if not CompanyMembership.objects.filter(
            user=request.user,
            company=company,
            is_active=True,
        ).exists():
            return Response(status=status.HTTP_403_FORBIDDEN)
        _ensure_company_modules(company)
        rows = CompanyModule.objects.filter(company=company).order_by("module")
        return Response(CompanyModuleSerializer(rows, many=True).data)


class CompanyModuleEnableView(APIView):
    """PATCH /api/companies/{id}/modules/{module}/ — body: {\"is_enabled\": bool}."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, company_id, module_key):
        company = get_object_or_404(Company, pk=company_id)
        valid_modules = {k for k, _ in CompanyModule.MODULE_CHOICES}
        if module_key not in valid_modules:
            return Response(
                {"detail": "Unknown module key."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        membership = CompanyMembership.objects.select_related("company_role").filter(
            user=request.user, company=company, is_active=True
        ).first()
        if not membership or not membership.get_permissions().get("can_manage_settings"):
            return Response(
                {"detail": "Tylko administrator może zmieniać moduły."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if "is_enabled" not in request.data:
            return Response(
                {"detail": "Field \"is_enabled\" is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        _ensure_company_modules(company)
        row = get_object_or_404(CompanyModule, company=company, module=module_key)
        row.is_enabled = bool(request.data["is_enabled"])
        row.enabled_at = timezone.now() if row.is_enabled else None
        row.save(update_fields=["is_enabled", "enabled_at"])
        return Response(CompanyModuleSerializer(row).data)


class SwitchCompanyView(APIView):
    """POST { \"company\": \"<uuid>\" } — set active company if the user is a member."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        ser = SwitchCompanySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        company_id = ser.validated_data["company"]
        company = get_object_or_404(Company, pk=company_id)
        if not CompanyMembership.objects.filter(
            user=request.user,
            company=company,
            is_active=True,
        ).exists():
            return Response(
                {"detail": "You are not a member of this company."},
                status=status.HTTP_403_FORBIDDEN,
            )
        User.objects.filter(pk=request.user.pk).update(current_company=company)
        request.user.refresh_from_db()
        return Response({"user": UserSerializer(request.user).data}, status=status.HTTP_200_OK)


class CompanyWorkflowSettingsView(APIView):
    """
    GET  /api/companies/{id}/workflow-settings/ — retrieve settings.
    PATCH /api/companies/{id}/workflow-settings/ — update one or more fields.

    Only admins and managers may write; all members may read.
    """

    permission_classes = [permissions.IsAuthenticated]

    def _get_company_or_403(self, request, company_id, *, require_write=False):
        company = get_object_or_404(Company, pk=company_id)
        membership = CompanyMembership.objects.select_related("company_role").filter(
            user=request.user, company=company, is_active=True
        ).first()
        if not membership:
            return None, Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)
        if require_write and not membership.get_permissions().get("can_manage_settings"):
            return None, Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)
        return company, None

    def get(self, request, company_id):
        company, err = self._get_company_or_403(request, company_id)
        if err:
            return err
        settings = get_workflow_settings(company)
        return Response(CompanyWorkflowSettingsSerializer(settings).data)

    def patch(self, request, company_id):
        company, err = self._get_company_or_403(request, company_id, require_write=True)
        if err:
            return err
        settings = get_workflow_settings(company)
        ser = CompanyWorkflowSettingsSerializer(settings, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


def _require_admin_membership(request, company):
    """Return (membership, None) if request.user is an admin of company, else (None, Response 403)."""
    m = CompanyMembership.objects.select_related("company_role").filter(
        user=request.user, company=company, is_active=True
    ).first()
    if not m or not m.is_admin_member():
        return None, Response({"detail": "Tylko administrator może zarządzać zespołem."}, status=status.HTTP_403_FORBIDDEN)
    return m, None


def _require_membership(request, company):
    """Return (membership, None) for any active member, else (None, Response 403)."""
    m = CompanyMembership.objects.select_related("company_role").filter(
        user=request.user, company=company, is_active=True
    ).first()
    if not m:
        return None, Response({"detail": "Brak dostępu."}, status=status.HTTP_403_FORBIDDEN)
    return m, None


class CompanyRolesListView(APIView):
    """
    GET  /api/companies/{id}/roles/  — list all roles (any member)
    POST /api/companies/{id}/roles/  — create a new role (admin only)
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, company_id):
        company = get_object_or_404(Company, pk=company_id)
        _, err = _require_membership(request, company)
        if err:
            return err
        roles = CompanyRole.objects.filter(company=company).order_by("created_at")
        return Response(CompanyRoleSerializer(roles, many=True).data)

    def post(self, request, company_id):
        company = get_object_or_404(Company, pk=company_id)
        _, err = _require_admin_membership(request, company)
        if err:
            return err
        ser = CompanyRoleWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        name = ser.validated_data["name"]
        if CompanyRole.objects.filter(company=company, name=name).exists():
            return Response({"detail": "Rola o tej nazwie już istnieje."}, status=status.HTTP_400_BAD_REQUEST)
        role = ser.save(company=company, is_admin=False)
        return Response(CompanyRoleSerializer(role).data, status=status.HTTP_201_CREATED)


class CompanyRoleDetailView(APIView):
    """
    PATCH  /api/companies/{id}/roles/{role_id}/  — update role (admin only, not is_admin roles)
    DELETE /api/companies/{id}/roles/{role_id}/  — delete role (admin only, not if members assigned)
    """
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, company_id, role_id):
        company = get_object_or_404(Company, pk=company_id)
        _, err = _require_admin_membership(request, company)
        if err:
            return err
        role = get_object_or_404(CompanyRole, pk=role_id, company=company)
        if role.is_admin:
            return Response({"detail": "Roli Administrator nie można edytować."}, status=status.HTTP_400_BAD_REQUEST)
        ser = CompanyRoleWriteSerializer(role, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        # Check name uniqueness if renaming
        new_name = ser.validated_data.get("name")
        if new_name and CompanyRole.objects.filter(company=company, name=new_name).exclude(pk=role.pk).exists():
            return Response({"detail": "Rola o tej nazwie już istnieje."}, status=status.HTTP_400_BAD_REQUEST)
        role = ser.save()
        return Response(CompanyRoleSerializer(role).data)

    def delete(self, request, company_id, role_id):
        company = get_object_or_404(Company, pk=company_id)
        _, err = _require_admin_membership(request, company)
        if err:
            return err
        role = get_object_or_404(CompanyRole, pk=role_id, company=company)
        if role.is_admin:
            return Response({"detail": "Roli Administrator nie można usunąć."}, status=status.HTTP_400_BAD_REQUEST)
        if role.members.filter(is_active=True).exists():
            return Response(
                {"detail": "Nie można usunąć roli, do której przypisani są aktywni pracownicy."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        role.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CompanyMembersListView(APIView):
    """
    GET  /api/companies/{id}/members/  — list members (admin only)
    POST /api/companies/{id}/members/  — create user account + membership (admin only)
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, company_id):
        company = get_object_or_404(Company, pk=company_id)
        _, err = _require_admin_membership(request, company)
        if err:
            return err
        members = (
            CompanyMembership.objects.select_related("user", "company_role")
            .filter(company=company)
            .order_by("joined_at")
        )
        return Response(TeamMemberSerializer(members, many=True).data)

    def post(self, request, company_id):
        company = get_object_or_404(Company, pk=company_id)
        _, err = _require_admin_membership(request, company)
        if err:
            return err
        ser = AddMemberSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        role = get_object_or_404(CompanyRole, pk=d["company_role_id"], company=company)
        create_kwargs: dict = dict(
            username=d["username"],
            first_name=d["first_name"],
            last_name=d["last_name"],
            password=d["password"],
        )
        if d.get("email"):
            create_kwargs["email"] = d["email"]
        new_user = User.objects.create_user(**create_kwargs)
        membership = CompanyMembership.objects.create(
            user=new_user,
            company=company,
            role="viewer",
            company_role=role,
            is_active=True,
        )
        return Response(TeamMemberSerializer(membership).data, status=status.HTTP_201_CREATED)


class CompanyMemberDetailView(APIView):
    """
    PATCH  /api/companies/{id}/members/{m_id}/  — change role or deactivate (admin only)
    DELETE /api/companies/{id}/members/{m_id}/  — deactivate member (admin only)
    """
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, company_id, membership_id):
        company = get_object_or_404(Company, pk=company_id)
        requesting_m, err = _require_admin_membership(request, company)
        if err:
            return err
        membership = get_object_or_404(
            CompanyMembership.objects.select_related("user", "company_role"),
            pk=membership_id, company=company,
        )
        # Admin cannot change their own role
        if membership.user == request.user:
            return Response({"detail": "Nie możesz zmienić swojej własnej roli."}, status=status.HTTP_400_BAD_REQUEST)

        if "company_role_id" in request.data:
            role = get_object_or_404(CompanyRole, pk=request.data["company_role_id"], company=company)
            membership.company_role = role
            # Sync legacy role field
            membership.role = "admin" if role.is_admin else "viewer"
        if "is_active" in request.data:
            membership.is_active = bool(request.data["is_active"])
        membership.save()

        # Update editable user fields
        user_fields_changed = []
        user = membership.user
        for field in ("first_name", "last_name"):
            if field in request.data:
                setattr(user, field, request.data[field])
                user_fields_changed.append(field)
        if "email" in request.data:
            new_email = request.data["email"] or None
            if new_email and User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
                return Response({"detail": "Użytkownik z tym adresem e-mail już istnieje."}, status=status.HTTP_400_BAD_REQUEST)
            user.email = new_email
            user_fields_changed.append("email")
        if user_fields_changed:
            user.save(update_fields=user_fields_changed)
        if "password" in request.data:
            new_password = request.data["password"]
            if new_password and len(new_password) >= 8:
                user.set_password(new_password)
                user.save(update_fields=["password"])

        membership.refresh_from_db()
        return Response(TeamMemberSerializer(membership).data)

    def delete(self, request, company_id, membership_id):
        company = get_object_or_404(Company, pk=company_id)
        _, err = _require_admin_membership(request, company)
        if err:
            return err
        membership = get_object_or_404(CompanyMembership, pk=membership_id, company=company)
        if membership.user == request.user:
            return Response({"detail": "Nie możesz usunąć siebie z firmy."}, status=status.HTTP_400_BAD_REQUEST)
        membership.is_active = False
        membership.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetRequestView(APIView):
    """POST /api/auth/password-reset/ — send reset link to email."""
    permission_classes = []

    def post(self, request):
        email = request.data.get("email", "").strip().lower()
        if not email:
            return Response({"detail": "Podaj adres e-mail."}, status=status.HTTP_400_BAD_REQUEST)

        # Always return 200 to avoid user enumeration
        try:
            user = User.objects.get(email__iexact=email, is_active=True)
        except User.DoesNotExist:
            return Response({"detail": "Jeśli konto istnieje, link został wysłany."})

        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        frontend_url = getattr(django_settings, "FRONTEND_URL", "http://localhost:3000")
        reset_url = f"{frontend_url}/reset-password/{uid}/{token}/"

        send_mail(
            subject="Reset hasła — MojeSaldoo",
            message=(
                f"Cześć {user.username},\n\n"
                f"Kliknij poniższy link, aby zresetować hasło:\n{reset_url}\n\n"
                f"Link wygasa po 24 godzinach.\n\n"
                f"Jeśli nie prosiłeś o reset, zignoruj tę wiadomość."
            ),
            from_email=django_settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )

        return Response({"detail": "Jeśli konto istnieje, link został wysłany."})


class PasswordResetConfirmView(APIView):
    """POST /api/auth/password-reset/confirm/ — set new password using uid+token."""
    permission_classes = []

    def post(self, request):
        uid = request.data.get("uid", "")
        token = request.data.get("token", "")
        new_password = request.data.get("new_password", "")

        if not uid or not token or not new_password:
            return Response({"detail": "Brakuje wymaganych pól."}, status=status.HTTP_400_BAD_REQUEST)

        if len(new_password) < 8:
            return Response({"detail": "Hasło musi mieć co najmniej 8 znaków."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            pk = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=pk)
        except (User.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Nieprawidłowy link resetowania."}, status=status.HTTP_400_BAD_REQUEST)

        if not default_token_generator.check_token(user, token):
            return Response({"detail": "Link wygasł lub jest nieprawidłowy."}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save()
        return Response({"detail": "Hasło zostało zmienione. Możesz się teraz zalogować."})


class FCMTokenView(APIView):
    """
    POST /api/auth/fcm-token/   — register a device token for the authenticated user.
    DELETE /api/auth/fcm-token/ — unregister the token (e.g. on logout).

    Body: { "token": "<FCM registration token>", "device_name": "iPhone 14" }
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        token = request.data.get("token", "").strip()
        device_name = request.data.get("device_name", "").strip()[:100]
        if not token:
            return Response({"detail": "Pole 'token' jest wymagane."}, status=status.HTTP_400_BAD_REQUEST)
        # Upsert: if the token already exists (possibly for another user after re-install),
        # update the user and device_name.
        obj, created = FCMDeviceToken.objects.update_or_create(
            token=token,
            defaults={"user": request.user, "device_name": device_name},
        )
        return Response({"registered": True, "created": created}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def delete(self, request):
        token = request.data.get("token", "").strip()
        if not token:
            return Response({"detail": "Pole 'token' jest wymagane."}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = FCMDeviceToken.objects.filter(user=request.user, token=token).delete()
        return Response({"unregistered": deleted > 0})


class WebPushPublicKeyView(APIView):
    """GET /api/auth/push-public-key/ — returns the VAPID public key for the browser to subscribe."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        public_key = getattr(django_settings, 'VAPID_PUBLIC_KEY', '')
        if not public_key:
            return Response({"detail": "Web Push not configured."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"public_key": public_key})


class WebPushSubscriptionView(APIView):
    """
    POST /api/auth/push-subscription/   — save a browser push subscription.
    DELETE /api/auth/push-subscription/ — remove it (on logout / permission revoked).

    Body (POST): { "endpoint": "...", "p256dh": "...", "auth": "..." }
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        endpoint = request.data.get("endpoint", "").strip()
        p256dh = request.data.get("p256dh", "").strip()
        auth = request.data.get("auth", "").strip()
        if not endpoint or not p256dh or not auth:
            return Response(
                {"detail": "Wymagane pola: endpoint, p256dh, auth."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user_agent = request.META.get("HTTP_USER_AGENT", "")[:255]
        obj, created = WebPushSubscription.objects.update_or_create(
            endpoint=endpoint,
            defaults={"user": request.user, "p256dh": p256dh, "auth": auth, "user_agent": user_agent},
        )
        return Response(
            {"registered": True, "created": created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request):
        endpoint = request.data.get("endpoint", "").strip()
        if not endpoint:
            return Response({"detail": "Pole 'endpoint' jest wymagane."}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = WebPushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response({"unregistered": deleted > 0})
