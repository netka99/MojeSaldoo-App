from apps.common.serializers import UUIDModelSerializer

from .models import FixedCost


class FixedCostSerializer(UUIDModelSerializer):
    class Meta:
        model = FixedCost
        fields = [
            "id",
            "category",
            "description",
            "amount_monthly",
            "active_from",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def create(self, validated_data):
        validated_data["company"] = self.context["request"].user.current_company
        return super().create(validated_data)
