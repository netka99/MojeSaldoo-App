"""Seed anonymised November 2024 confectionery VAT documents.

Usage:
    python manage.py seed_cukiernia_vat_2024_11
    python manage.py seed_cukiernia_vat_2024_11 --company-id 3
    python manage.py seed_cukiernia_vat_2024_11 --reset
"""

from django.core.management.base import BaseCommand

from apps.cash_flow.cukiernia_vat import (
    COMPANY_NAME,
    get_or_create_seed_company,
    intended_purchases,
    intended_sales,
    seed_cukiernia_vat,
)


class Command(BaseCommand):
    help = (
        "Seed the November 2024 confectionery VAT fixture (JPK_V7M gold totals) "
        "for engine comparison tests."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, help="Target company PK")
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete previously seeded VAT11 documents before inserting",
        )

    def handle(self, *args, **options):
        from apps.users.models import Company

        if options.get("company_id"):
            company = Company.objects.get(pk=options["company_id"])
            created = False
        else:
            company, created = get_or_create_seed_company()

        result = seed_cukiernia_vat(company, reset=True)

        g = result["gold"]
        self.stdout.write(f"  Company: {company.name} (id={company.pk})")
        if created:
            self.stdout.write(f"  Created company {COMPANY_NAME}")
        self.stdout.write(
            f"  Intended VAT należny {result['intended_vat_nalezny']} "
            f"(gold {g['vat_nalezny']})"
        )
        self.stdout.write(
            f"  Intended VAT naliczony {result['intended_vat_naliczony']} "
            f"(gold {g['vat_naliczony']})"
        )
        self.stdout.write(
            f"  Intended VAT to pay "
            f"{result['intended_vat_nalezny'] - result['intended_vat_naliczony']} "
            f"(gold {g['vat_to_pay']})"
        )
        sales_net, _ = intended_sales()
        purch_net, _ = intended_purchases()
        self.stdout.write(f"  Sales net {sales_net} / purchases net deductible {purch_net}")
        self.stdout.write(self.style.SUCCESS("  Seed complete."))
