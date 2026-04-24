from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, mixins, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Company, CompanyMembership, CompanyModule, User
from .serializers import (
    CompanyModuleSerializer,
    CompanySerializer,
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
