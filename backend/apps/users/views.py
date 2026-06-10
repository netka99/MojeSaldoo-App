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

from .models import Company, CompanyMembership, CompanyModule, CompanyWorkflowSettings, User, get_workflow_settings
from .serializers import (
    CompanyModuleSerializer,
    CompanySerializer,
    CompanyWorkflowSettingsSerializer,
    SwitchCompanySerializer,
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
            )
            .distinct()
        )


class CompanyCreateView(mixins.CreateModelMixin, generics.GenericAPIView):
    """POST /api/companies/ — create org; creator becomes admin member."""

    serializer_class = CompanySerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        company = serializer.save()
        CompanyMembership.objects.create(
            user=self.request.user,
            company=company,
            role="admin",
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
        if not CompanyMembership.objects.filter(
            user=request.user,
            company=company,
            is_active=True,
            role__in=["admin", "manager"],
        ).exists():
            return Response(
                {"detail": "Only admins and managers can change modules."},
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
        role_filter = {"role__in": ["admin", "manager"]} if require_write else {}
        if not CompanyMembership.objects.filter(
            user=request.user,
            company=company,
            is_active=True,
            **role_filter,
        ).exists():
            return None, Response(
                {"detail": "Permission denied."},
                status=status.HTTP_403_FORBIDDEN,
            )
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
