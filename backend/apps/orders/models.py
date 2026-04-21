from django.db import models
from django.core.validators import MinValueValidator
from apps.products.models import Product
from apps.customers.models import Customer

class Order(models.Model):
    """
    Comprehensive Order model with detailed tracking and status management
    """
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('confirmed', 'Confirmed'),
        ('in_preparation', 'In Preparation'),
        ('in_delivery', 'In Delivery'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled')
    ]

    customer = models.ForeignKey(
        Customer, 
        on_delete=models.PROTECT,
        help_text="Customer who placed the order"
    )
    order_date = models.DateField(
        help_text="Date when the order was placed"
    )
    delivery_date = models.DateField(
        help_text="Planned delivery date"
    )
    status = models.CharField(
        max_length=20, 
        choices=STATUS_CHOICES, 
        default='draft',
        help_text="Current status of the order"
    )
    total = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        validators=[MinValueValidator(0)],
        help_text="Total order value"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Order {self.id} - {self.customer.name}"

    def calculate_total(self):
        """
        Recalculate and update order total
        """
        total = sum(item.total for item in self.items.all())
        self.total = total
        self.save()
        return total

    def update_status(self, new_status):
        """
        Update order status with validation
        
        :param new_status: New status for the order
        :return: Updated status
        """
        if new_status not in dict(self.STATUS_CHOICES):
            raise ValueError(f"Invalid status: {new_status}")
        
        self.status = new_status
        self.save()
        return self.status

    def can_be_modified(self):
        """
        Check if order can be modified
        
        :return: Boolean indicating if order is modifiable
        """
        return self.status in ['draft', 'confirmed']

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Order'
        verbose_name_plural = 'Orders'

class OrderItem(models.Model):
    """
    Order line items with detailed tracking
    """
    order = models.ForeignKey(
        Order, 
        related_name='items', 
        on_delete=models.CASCADE,
        help_text="Parent order"
    )
    product = models.ForeignKey(
        Product, 
        on_delete=models.PROTECT,
        help_text="Product in the order"
    )
    quantity = models.DecimalField(
        max_digits=10, 
        decimal_places=2,
        validators=[MinValueValidator(0.01)],
        help_text="Quantity of the product"
    )
    unit_price = models.DecimalField(
        max_digits=10, 
        decimal_places=2,
        validators=[MinValueValidator(0)],
        help_text="Price per unit"
    )
    total = models.DecimalField(
        max_digits=10, 
        decimal_places=2,
        validators=[MinValueValidator(0)],
        help_text="Total price for this line item"
    )

    def __str__(self):
        return f"{self.quantity} x {self.product.name}"

    def save(self, *args, **kwargs):
        """
        Override save to calculate total
        """
        self.total = self.quantity * self.unit_price
        super().save(*args, **kwargs)

        # Update parent order total
        self.order.calculate_total()

    class Meta:
        unique_together = ['order', 'product']
        verbose_name = 'Order Item'
        verbose_name_plural = 'Order Items'