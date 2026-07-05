from rest_framework import serializers

from apps.common.serializers import UUIDModelSerializer, UUIDRelatedField
from django.contrib.auth.password_validation import validate_password
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Company, CompanyMembership, CompanyModule, CompanyRole, CompanyWorkflowSettings, PERMISSION_FLAGS, User


class UserSerializer(UUIDModelSerializer):
    current_company = serializers.UUIDField(source="current_company.uuid", allow_null=True, read_only=True)
    current_company_role = serializers.SerializerMethodField()
    is_company_admin = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    onboarding_completed = serializers.SerializerMethodField()
    company_type = serializers.SerializerMethodField()
    taxation_form = serializers.SerializerMethodField()
    ryczalt_category = serializers.SerializerMethodField()
    modules = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "phone_number",
            "is_active",
            "current_company",
            "current_company_role",
            "is_company_admin",
            "permissions",
            "onboarding_completed",
            "company_type",
            "taxation_form",
            "ryczalt_category",
            "modules",
        ]
        extra_kwargs = {"password": {"write_only": True}}

    def _get_membership(self, obj):
        cid = obj.current_company_id
        if not cid:
            return None
        return (
            CompanyMembership.objects.select_related("company_role")
            .filter(user=obj, company_id=cid, is_active=True)
            .first()
        )

    def get_current_company_role(self, obj):
        m = self._get_membership(obj)
        if not m:
            return None
        if m.company_role_id:
            return m.company_role.name
        return m.role

    def get_is_company_admin(self, obj) -> bool:
        m = self._get_membership(obj)
        if not m:
            return False
        return m.is_admin_member()

    def get_permissions(self, obj) -> dict | None:
        m = self._get_membership(obj)
        if not m:
            return None
        return m.get_permissions()

    def get_onboarding_completed(self, obj) -> bool:
        if not obj.current_company_id:
            return False
        return bool(obj.current_company.onboarding_completed)

    def get_company_type(self, obj) -> str | None:
        if not obj.current_company_id:
            return None
        return obj.current_company.company_type

    def get_taxation_form(self, obj) -> str | None:
        if not obj.current_company_id:
            return None
        return obj.current_company.taxation_form

    def get_ryczalt_category(self, obj) -> str | None:
        if not obj.current_company_id:
            return None
        return obj.current_company.ryczalt_category

    def get_modules(self, obj) -> dict:
        if not obj.current_company_id:
            return {}
        rows = CompanyModule.objects.filter(company_id=obj.current_company_id)
        return {row.module: row.is_enabled for row in rows}


class CompanySerializer(UUIDModelSerializer):
    """Aligns with onboarding `CompanyWrite` (snake_case) and the `Company` model."""

    class Meta:
        model = Company
        fields = [
            "id",
            "name",
            "nip",
            "address",
            "city",
            "postal_code",
            "email",
            "phone",
            "is_active",
            "taxation_form",
            "ryczalt_category",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["is_active", "created_at", "updated_at"]

    def validate_nip(self, value):
        if value in (None, ""):
            return None
        return str(value).strip()


class CompanyMembershipSerializer(UUIDModelSerializer):
    user = UserSerializer(read_only=True)
    company = UUIDRelatedField(read_only=True)

    class Meta:
        model = CompanyMembership
        fields = ["id", "user", "company", "role", "is_active", "joined_at"]
        read_only_fields = ["user", "company", "role", "is_active", "joined_at"]


class CompanyModuleSerializer(UUIDModelSerializer):
    class Meta:
        model = CompanyModule
        fields = ["id", "company", "module", "is_enabled", "enabled_at"]
        read_only_fields = ["company", "module", "enabled_at"]

class UserRegistrationSerializer(UUIDModelSerializer):
    password = serializers.CharField(write_only=True, required=True, validators=[validate_password])
    password2 = serializers.CharField(write_only=True, required=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'first_name', 'last_name', 'password', 'password2']
        extra_kwargs = {
            'first_name': {'required': True},
            'last_name': {'required': True},
        }

    def validate(self, attrs):
        if attrs['password'] != attrs['password2']:
            raise serializers.ValidationError({"password": "Password fields didn't match."})
        return attrs

    def create(self, validated_data):
        validated_data.pop('password2')
        user = User.objects.create_user(**validated_data)
        return user


class UserTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    JWT login serializer that returns user data with tokens.
    """

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["username"] = user.username
        token["email"] = user.email
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class SwitchCompanySerializer(serializers.Serializer):
    company = serializers.UUIDField()


class CompanyWorkflowSettingsSerializer(UUIDModelSerializer):
    class Meta:
        model = CompanyWorkflowSettings
        fields = ["orders_required", "wz_required_before_invoice"]


class CompanyRoleSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = CompanyRole
        fields = [
            "id", "name", "is_admin", "permissions", "member_count", "created_at",
        ] + PERMISSION_FLAGS
        read_only_fields = ["id", "is_admin", "created_at"]

    def get_permissions(self, obj) -> dict:
        return obj.get_permissions()

    def get_member_count(self, obj) -> int:
        return obj.members.filter(is_active=True).count()

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Nazwa roli nie może być pusta.")
        return value


class CompanyRoleWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyRole
        fields = ["name"] + PERMISSION_FLAGS

    def validate_name(self, value):
        return value.strip()


class TeamMemberUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "is_active"]
        read_only_fields = fields


class TeamMemberSerializer(serializers.ModelSerializer):
    user = TeamMemberUserSerializer(read_only=True)
    company_role = CompanyRoleSerializer(read_only=True)
    company_role_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    # legacy role field kept for display
    role = serializers.CharField(read_only=True)

    class Meta:
        model = CompanyMembership
        fields = ["id", "user", "company_role", "company_role_id", "role", "is_active", "joined_at"]
        read_only_fields = ["id", "user", "role", "is_active", "joined_at"]


class AddMemberSerializer(serializers.Serializer):
    """Create a new user account and add them as a member of the company."""
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True, default=None)
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    password = serializers.CharField(write_only=True, min_length=8)
    company_role_id = serializers.UUIDField()

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("Użytkownik o tej nazwie już istnieje.")
        return value

    def validate_email(self, value):
        if not value:
            return None
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Użytkownik z tym adresem e-mail już istnieje.")
        return value