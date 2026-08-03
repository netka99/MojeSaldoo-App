from django.utils import timezone

from apps.common.serializers import UUIDModelSerializer
from .models import CompanyOpexCategory, CompanyTaxConfig, DailyB2CRevenue, QuickExpense


class CompanyOpexCategorySerializer(UUIDModelSerializer):
    class Meta:
        model = CompanyOpexCategory
        fields = ["id", "name", "slug", "is_active", "sort_order"]
        read_only_fields = ["id"]


class CompanyTaxConfigSerializer(UUIDModelSerializer):
    class Meta:
        model = CompanyTaxConfig
        fields = [
            "id",
            "tax_form",
            "tax_rate",
            "vat_payer",
            "vat_method",
            "vat_due_day",
            "zus_due_day",
            "cash_balance",
            "bank_balance",
            "balance_updated_at",
            "updated_at",
        ]
        read_only_fields = ["id", "balance_updated_at", "updated_at"]


class QuickExpenseSerializer(UUIDModelSerializer):
    class Meta:
        model = QuickExpense
        fields = [
            "id",
            "date",
            "amount",
            "category",
            "cost_type",
            "has_vat",
            "vendor",
            "document_number",
            "document_type",
            "product_name",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def create(self, validated_data):
        validated_data["company"] = self.context["request"].user.current_company
        return super().create(validated_data)


class DailyB2CRevenueSerializer(UUIDModelSerializer):
    class Meta:
        model = DailyB2CRevenue
        fields = [
            "id",
            "date",
            "amount",
            "vat_included",
            "vat_rate",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def create(self, validated_data):
        validated_data["company"] = self.context["request"].user.current_company
        return super().create(validated_data)
