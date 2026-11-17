from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.users.demo import create_demo_company_for_user

User = get_user_model()


class Command(BaseCommand):
    help = "Create a demo company with sample data for an existing user."

    def add_arguments(self, parser):
        parser.add_argument("--user-email", required=True, help="Email of the user to create demo company for.")

    def handle(self, *args, **options):
        email = options["user_email"]
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            raise CommandError(f"User with email '{email}' does not exist.")

        from apps.users.models import Company
        if Company.objects.filter(memberships__user=user, is_demo=True).exists():
            self.stdout.write(self.style.WARNING(f"User '{email}' already has a demo company. Skipping."))
            return

        create_demo_company_for_user(user)
        self.stdout.write(self.style.SUCCESS(f"Demo company created for '{email}'."))
