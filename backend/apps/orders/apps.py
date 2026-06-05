from django.apps import AppConfig


class OrdersConfig(AppConfig):
    name = "apps.orders"

    def ready(self):
        import apps.orders.signals  # noqa: F401 — registers signal receivers
