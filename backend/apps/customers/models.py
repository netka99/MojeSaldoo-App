from django.db import models
from django.core.validators import MinValueValidator

class Customer(models.Model):
    """
    Comprehensive Customer model with detailed tracking and validation
    """
    name = models.CharField(
        max_length=255, 
        help_text="Customer or shop name"
    )
    address = models.TextField(
        help_text="Full address of the customer"
    )
    nip = models.CharField(
        max_length=10, 
        unique=True, 
        blank=True, 
        null=True, 
        help_text="Tax identification number (NIP)"
    )
    phone = models.CharField(
        max_length=20, 
        blank=True, 
        null=True, 
        help_text="Contact phone number"
    )
    distance = models.IntegerField(
        validators=[MinValueValidator(0)],
        help_text="Distance in kilometers"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.nip or 'No NIP'})"

    def get_contact_info(self):
        """
        Return a dictionary of contact information
        """
        return {
            'name': self.name,
            'address': self.address,
            'phone': self.phone,
            'nip': self.nip
        }

    def update_distance(self, new_distance):
        """
        Update customer's distance with validation
        
        :param new_distance: New distance value
        :return: Updated distance
        """
        if new_distance < 0:
            raise ValueError("Distance cannot be negative")
        
        self.distance = new_distance
        self.save()
        return self.distance

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Customer'
        verbose_name_plural = 'Customers'
        unique_together = ['name', 'nip']  # Prevent duplicate customers