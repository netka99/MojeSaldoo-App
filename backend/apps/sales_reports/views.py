import csv
import io
from decimal import Decimal

from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django.http import HttpResponse
from django_filters.rest_framework import DjangoFilterBackend

from .models import DailySalesReport, SalesReportTemplate
from .serializers import (
    DailySalesReportSerializer,
    DailySalesReportListSerializer,
    SalesReportTemplateSerializer,
)


class DailySalesReportViewSet(viewsets.ModelViewSet):
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "date"]
    ordering_fields = ["date", "created_at", "amount"]
    ordering = ["-date", "-created_at"]

    def get_queryset(self):
        company = self.request.user.current_company
        qs = DailySalesReport.objects.filter(company=company).prefetch_related("lines")
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return DailySalesReportListSerializer
        return DailySalesReportSerializer

    @action(detail=False, methods=["get"], url_path="yesterday")
    def yesterday(self, request):
        """Return the most recent saved report for copying."""
        from datetime import date, timedelta
        company = request.user.current_company
        report = (
            DailySalesReport.objects.filter(company=company, status=DailySalesReport.STATUS_SAVED)
            .prefetch_related("lines")
            .order_by("-date", "-created_at")
            .first()
        )
        if not report:
            return Response(None)
        return Response(DailySalesReportSerializer(report, context={"request": request}).data)

    @action(detail=False, methods=["get"], url_path="export-csv")
    def export_csv(self, request):
        """
        Export saved reports for a given month as CSV (JPK_V7 Rejestr Sprzedaży format).
        Query params: month=YYYY-MM
        """
        month_str = request.query_params.get("month", "")
        try:
            year, month = month_str.split("-")
            year, month = int(year), int(month)
        except (ValueError, AttributeError):
            return Response({"detail": "Podaj miesiąc w formacie YYYY-MM."}, status=400)

        company = request.user.current_company
        reports = (
            DailySalesReport.objects
            .filter(company=company, status=DailySalesReport.STATUS_SAVED,
                    date__year=year, date__month=month)
            .prefetch_related("lines")
            .order_by("date", "report_number")
        )

        # All VAT rates present across the dataset
        VAT_RATES = ["5.00", "8.00", "23.00"]

        def vat_breakdown(report):
            buckets: dict[str, Decimal] = {}
            for line in report.lines.all():
                rate_key = "{:.2f}".format(line.vat_rate)
                buckets[rate_key] = buckets.get(rate_key, Decimal("0")) + line.line_revenue
            result = {}
            for rate_str, gross in buckets.items():
                rate = Decimal(rate_str)
                net = (gross / (1 + rate / 100)).quantize(Decimal("0.01"))
                vat = (gross - net).quantize(Decimal("0.01"))
                result[rate_str] = {"net": net, "vat": vat, "gross": gross}
            return result

        output = io.StringIO()
        writer = csv.writer(output, delimiter=";")

        # Header
        header = ["Data", "Nr dokumentu", "Rodzaj"]
        for rate in VAT_RATES:
            label = rate.rstrip("0").rstrip(".")
            header += [f"Netto {label}%", f"VAT {label}%"]
        header += ["Brutto razem"]
        writer.writerow(header)

        for report in reports:
            bd = vat_breakdown(report)
            row = [
                report.date.strftime("%Y-%m-%d"),
                report.report_number,
                "WEW",
            ]
            for rate in VAT_RATES:
                data = bd.get(rate, {})
                row.append(str(data.get("net", "")).replace(".", ",") if data else "")
                row.append(str(data.get("vat", "")).replace(".", ",") if data else "")
            row.append(str(report.amount).replace(".", ","))
            writer.writerow(row)

        csv_content = output.getvalue()
        filename = f"RK_{year}_{month:02d}.csv"
        response = HttpResponse(
            "\ufeff" + csv_content,  # BOM for Excel UTF-8
            content_type="text/csv; charset=utf-8",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class SalesReportTemplateViewSet(viewsets.ModelViewSet):
    serializer_class = SalesReportTemplateSerializer
    pagination_class = None  # Templates are few — return plain array

    def get_queryset(self):
        return SalesReportTemplate.objects.filter(company=self.request.user.current_company)
