from django.core.management.base import BaseCommand
from apps.cash_flow.models import OPEX_CATEGORY_CHOICES, CompanyOpexCategory
from apps.users.models import Company


class Command(BaseCommand):
    help = "Seed default OPEX categories for all companies that don't have them yet."

    def handle(self, *args, **options):
        companies = Company.objects.all()
        created_total = 0
        for company in companies:
            for i, (slug, name) in enumerate(OPEX_CATEGORY_CHOICES):
                _, created = CompanyOpexCategory.objects.get_or_create(
                    company=company,
                    slug=slug,
                    defaults={"name": name, "sort_order": i},
                )
                if created:
                    created_total += 1
        self.stdout.write(
            self.style.SUCCESS(
                f"Created {created_total} categories for {companies.count()} companies."
            )
        )
