from django.db import models
from django.core.validators import MinValueValidator

class Product(models.Model):
    """
    Comprehensive Product model with detailed tracking and validation
    """
    name = models.CharField(
        max_length=255, 
        help_text="Name of the product"
    )
    description = models.TextField(
        blank=True, 
        null=True, 
        help_text="Optional product description"
    )
    unit = models.CharField(
        max_length=50, 
        help_text="Unit of measurement (e.g., 'szt', 'kg', 'l')"
    )
    price = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        validators=[MinValueValidator(0)],
        help_text="Product price"
    )
    stock_quantity = models.IntegerField(
        default=0, 
        validators=[MinValueValidator(0)],
        help_text="Current stock quantity"
    )
    category = models.CharField(
        max_length=100, 
        blank=True, 
        null=True, 
        help_text="Optional product category"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.unit})"

    def update_stock(self, quantity_change):
        """
        Update stock quantity with validation
        
        :param quantity_change: Positive or negative quantity change
        :return: New stock quantity
        """
        new_quantity = self.stock_quantity + quantity_change
        if new_quantity < 0:
            raise ValueError("Stock cannot be negative")
        
        self.stock_quantity = new_quantity
        self.save()
        return self.stock_quantity

    def is_in_stock(self):
        """
        Check if product is currently in stock
        
        :return: Boolean indicating stock availability
        """
        return self.stock_quantity > 0

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Product'
        verbose_name_plural = 'Products'
        unique_together = ['name', 'unit']  # Prevent duplicate products