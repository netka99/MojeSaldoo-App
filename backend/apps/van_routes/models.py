"""Van route model — groups orders into a single delivery run for one van/driver."""

import uuid

from django.conf import settings
from django.db import models


class VanRoute(models.Model):
    STATUS_PLANNED = "planned"          # route created, not loaded yet
    STATUS_LOADING = "loading"          # MM issued, driver loading van
    STATUS_IN_PROGRESS = "in_progress"  # van on the road
    STATUS_SETTLING = "settling"        # all stops done, reconciliation pending
    STATUS_CLOSED = "closed"            # reconciliation done

    STATUS_CHOICES = [
        (STATUS_PLANNED, "Zaplanowana"),
        (STATUS_LOADING, "Załadunek"),
        (STATUS_IN_PROGRESS, "W trasie"),
        (STATUS_SETTLING, "Rozliczanie"),
        (STATUS_CLOSED, "Zamknięta"),
    ]

    # Active statuses — used by the exclude_routed filter on orders
    ACTIVE_STATUSES = [STATUS_PLANNED, STATUS_LOADING, STATUS_IN_PROGRESS, STATUS_SETTLING]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="van_routes",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="van_routes",
    )

    date = models.DateField(help_text="Delivery date for this route.")
    driver_name = models.CharField(max_length=255, blank=True, default="")
    van_name = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Human-readable van identifier (e.g. BIA 12345).",
    )

    van_warehouse = models.ForeignKey(
        "products.Warehouse",
        on_delete=models.PROTECT,
        related_name="van_routes_as_van",
        help_text="Mobile warehouse representing the van.",
    )
    main_warehouse = models.ForeignKey(
        "products.Warehouse",
        on_delete=models.PROTECT,
        related_name="van_routes_as_main",
        help_text="Main warehouse — source for the MM loading document.",
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_PLANNED,
    )

    orders = models.ManyToManyField(
        "orders.Order",
        blank=True,
        related_name="van_routes",
        help_text="Orders included as stops in this route.",
    )

    # Set when start-loading action creates the MM document
    mm_document = models.OneToOneField(
        "delivery.DeliveryDocument",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="loading_route",
        help_text="MM document created when the van is loaded.",
    )

    # Populated after reconciliation — summary of returned/kept/written_off items
    reconciliation_summary = models.JSONField(null=True, blank=True, default=None)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        verbose_name = "Van route"
        verbose_name_plural = "Van routes"

    def __str__(self):
        return f"Route {self.date} – {self.van_name or self.van_warehouse.code} ({self.get_status_display()})"

    @property
    def is_editable(self):
        """Route can still have orders/details changed."""
        return self.status == self.STATUS_PLANNED
