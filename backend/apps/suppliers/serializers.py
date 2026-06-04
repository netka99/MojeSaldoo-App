from rest_framework import serializers

from .models import Supplier


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = [
            'id', 'name', 'nip', 'email', 'phone',
            'street', 'city', 'postal_code', 'country',
            'payment_terms', 'notes', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def create(self, validated_data):
        validated_data['company'] = self.context['request'].user.current_company
        return super().create(validated_data)


class SupplierListSerializer(serializers.ModelSerializer):
    """Slim serializer do dropdownów i list."""
    class Meta:
        model = Supplier
        fields = ['id', 'name', 'nip', 'city', 'is_active']
