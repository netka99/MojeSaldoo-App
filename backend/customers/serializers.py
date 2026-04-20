from rest_framework import serializers
from .models import Customer

class CustomerSerializer(serializers.ModelSerializer):
    """
    Serializer for Customer model with comprehensive validation
    """
    class Meta:
        model = Customer
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_nip(self, value):
        """
        Validate NIP (Polish tax identification number)
        """
        if value and not self.validate_nip_format(value):
            raise serializers.ValidationError("Invalid NIP format")
        return value

    def validate_phone(self, value):
        """
        Basic phone number validation
        """
        if value and not self.validate_phone_format(value):
            raise serializers.ValidationError("Invalid phone number format")
        return value

    def validate_distance(self, value):
        """
        Ensure distance is non-negative
        """
        if value < 0:
            raise serializers.ValidationError("Distance cannot be negative")
        return value

    @staticmethod
    def validate_nip_format(nip):
        """
        Validate Polish NIP number format
        """
        if not nip or len(nip) != 10:
            return False
        
        # Basic NIP validation weights
        weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
        
        try:
            # Calculate checksum
            checksum = sum(int(nip[i]) * weights[i] for i in range(9)) % 11
            return int(nip[9]) == checksum
        except (ValueError, IndexError):
            return False

    @staticmethod
    def validate_phone_format(phone):
        """
        Basic phone number validation
        """
        # Remove spaces and dashes
        phone = ''.join(filter(str.isdigit, phone))
        
        # Check for valid phone number length
        return 9 <= len(phone) <= 15