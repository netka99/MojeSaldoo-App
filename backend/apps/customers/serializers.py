from decimal import Decimal

from rest_framework import serializers

from .models import Customer


class CustomerSerializer(serializers.ModelSerializer):
    """Full Customer API shape; monetary amounts use DecimalField (no floats)."""

    credit_limit = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)

    class Meta:
        model = Customer
        fields = [
            "id",
            "user",
            "company",
            "name",
            "company_name",
            "nip",
            "email",
            "phone",
            "street",
            "city",
            "postal_code",
            "country",
            "distance_km",
            "delivery_days",
            "payment_terms",
            "credit_limit",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "company", "created_at", "updated_at"]

    def validate_nip(self, value):
        if value and not self.validate_nip_format(value):
            raise serializers.ValidationError("Invalid NIP format")
        return value

    def validate_phone(self, value):
        if value and not self.validate_phone_format(value):
            raise serializers.ValidationError("Invalid phone number format")
        return value

    def validate_distance_km(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Distance cannot be negative")
        return value

    def validate_credit_limit(self, value: Decimal) -> Decimal:
        if value < 0:
            raise serializers.ValidationError("Credit limit cannot be negative.")
        return value

    @staticmethod
    def validate_nip_format(nip):
        if not nip or len(nip) != 10:
            return False

        weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]

        try:
            checksum = sum(int(nip[i]) * weights[i] for i in range(9)) % 11
            return int(nip[9]) == checksum
        except (ValueError, IndexError):
            return False

    @staticmethod
    def validate_phone_format(phone):
        digits = "".join(filter(str.isdigit, phone))
        return 9 <= len(digits) <= 15
