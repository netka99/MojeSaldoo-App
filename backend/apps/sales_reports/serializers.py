from decimal import Decimal

from rest_framework import serializers

from apps.products.models import Product
from .models import DailySalesReport, DailySalesReportItem, SalesReportTemplate


class SalesReportItemSerializer(serializers.ModelSerializer):
    # Accept UUID string for product (matches frontend Product.id which is uuid)
    product = serializers.SlugRelatedField(
        slug_field="uuid",
        queryset=Product.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = DailySalesReportItem
        fields = [
            "id",
            "product",
            "product_name",
            "unit",
            "qty",
            "vat_rate",
            "unit_price",
            "unit_cost",
            "line_revenue",
            "line_cost",
            "sort_order",
        ]
        read_only_fields = ["id", "line_revenue", "line_cost"]

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        # Return product uuid string instead of pk
        if instance.product_id:
            ret["product"] = str(instance.product.uuid)
        return ret


class DailySalesReportSerializer(serializers.ModelSerializer):
    lines = SalesReportItemSerializer(many=True, required=False)
    vat_breakdown = serializers.SerializerMethodField()

    class Meta:
        model = DailySalesReport
        fields = [
            "id",
            "uuid",
            "report_number",
            "date",
            "status",
            "notes",
            "amount",
            "cost_total",
            "vat_breakdown",
            "lines",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uuid", "report_number", "amount", "cost_total", "created_at", "updated_at"]

    def get_vat_breakdown(self, obj):
        """
        Returns VAT breakdown grouped by rate:
        [{"vat_rate": "8.00", "net": "100.00", "vat": "8.00", "gross": "108.00"}, ...]
        """
        buckets: dict[str, Decimal] = {}
        for line in obj.lines.all():
            rate_key = str(line.vat_rate)
            buckets[rate_key] = buckets.get(rate_key, Decimal("0")) + line.line_revenue
        result = []
        for rate_str, gross in sorted(buckets.items()):
            rate = Decimal(rate_str)
            net = (gross / (1 + rate / 100)).quantize(Decimal("0.01"))
            vat = (gross - net).quantize(Decimal("0.01"))
            result.append({
                "vat_rate": rate_str,
                "net": str(net),
                "vat": str(vat),
                "gross": str(gross),
            })
        return result

    def create(self, validated_data):
        lines_data = validated_data.pop("lines", [])
        validated_data["company"] = self.context["request"].user.current_company
        report = DailySalesReport.objects.create(**validated_data)
        for i, line_data in enumerate(lines_data):
            line_data["sort_order"] = i
            DailySalesReportItem.objects.create(report=report, **line_data)
        report.recalculate_totals()
        return report

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("lines", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if lines_data is not None:
            instance.lines.all().delete()
            for i, line_data in enumerate(lines_data):
                line_data["sort_order"] = i
                DailySalesReportItem.objects.create(report=instance, **line_data)
            instance.recalculate_totals()

        return instance


class DailySalesReportListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list view — no lines."""
    line_count = serializers.SerializerMethodField()

    class Meta:
        model = DailySalesReport
        fields = [
            "id",
            "uuid",
            "report_number",
            "date",
            "status",
            "notes",
            "amount",
            "cost_total",
            "line_count",
            "created_at",
        ]

    def get_line_count(self, obj):
        return obj.lines.count()


class SalesReportTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalesReportTemplate
        fields = ["id", "uuid", "name", "is_default", "lines", "created_at", "updated_at"]
        read_only_fields = ["id", "uuid", "created_at", "updated_at"]

    def create(self, validated_data):
        validated_data["company"] = self.context["request"].user.current_company
        # Enforce single default per company
        if validated_data.get("is_default"):
            SalesReportTemplate.objects.filter(
                company=validated_data["company"], is_default=True
            ).update(is_default=False)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if validated_data.get("is_default"):
            SalesReportTemplate.objects.filter(
                company=instance.company, is_default=True
            ).exclude(pk=instance.pk).update(is_default=False)
        return super().update(instance, validated_data)
