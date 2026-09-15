from django.apps import AppConfig


class PurchaseOrdersConfig(AppConfig):
    name = "apps.purchase_orders"

    def ready(self):
        import apps.purchase_orders.signals  # noqa: F401
