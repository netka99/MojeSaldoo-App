from rest_framework import serializers

from apps.common.serializers import UUIDModelSerializer

from .models import Supplier


class SupplierSerializer(UUIDModelSerializer):
    class Meta:
        model = Supplier
        fields = [
            'id', 'name', 'nip', 'email', 'phone',
            'street', 'city', 'postal_code', 'country',
            'payment_terms', 'notes', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = []

    def create(self, validated_data):
        validated_data['company'] = self.context['request'].user.current_company
        return super().create(validated_data)


class SupplierListSerializer(UUIDModelSerializer):
    """Slim serializer do dropdownów i list."""
    class Meta:
        model = Supplier
        fields = ['id', 'name', 'nip', 'city', 'is_active']
