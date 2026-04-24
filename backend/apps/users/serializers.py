from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Company, CompanyMembership, CompanyModule, User


class UserSerializer(serializers.ModelSerializer):
    current_company = serializers.UUIDField(source="current_company_id", allow_null=True, read_only=True)
    current_company_role = serializers.SerializerMethodField()

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
        ]
        extra_kwargs = {"password": {"write_only": True}}

    def get_current_company_role(self, obj):
        cid = obj.current_company_id
        if not cid:
            return None
        m = CompanyMembership.objects.filter(
            user=obj, company_id=cid, is_active=True
        ).first()
        return m.role if m else None


class CompanySerializer(serializers.ModelSerializer):
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
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_active", "created_at", "updated_at"]


class CompanyMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    company = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = CompanyMembership
        fields = ["id", "user", "company", "role", "is_active", "joined_at"]
        read_only_fields = ["id", "user", "company", "role", "is_active", "joined_at"]


class CompanyModuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyModule
        fields = ["id", "company", "module", "is_enabled", "enabled_at"]
        read_only_fields = ["id", "company", "module", "enabled_at"]

class UserRegistrationSerializer(serializers.ModelSerializer):
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