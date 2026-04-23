from rest_framework import serializers
from .models import Invoice
from apps.orders.serializers import OrderSerializer

class InvoiceSerializer(serializers.ModelSerializer):
    order = OrderSerializer(read_only=True)

    class Meta:
        model = Invoice
        fields = '__all__'