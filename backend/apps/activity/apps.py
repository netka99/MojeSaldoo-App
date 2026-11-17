from django.apps import AppConfig


class ActivityConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.activity'

    def ready(self):
        import apps.activity.audit  # noqa: F401 — registers Django signals
