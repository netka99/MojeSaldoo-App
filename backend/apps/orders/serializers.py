from rest_framework import serializers
from .models import Order, OrderItem
from products.models import Product
from customers.models import Customer

class OrderItemSerializer(serializers.ModelSerializer):
    """
    Serializer for OrderItem with product validation
    """
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = OrderItem
        fields = '__all__'
        read_only_fields = ['id', 'total']

    def validate_quantity(self, value):
        """Ensure quantity is positive"""
        if value <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero")
        return value

    def validate(self, data):
        """
        Validate order item data
        - Check product availability
        - Calculate total
        """
        product = data.get('product')
        quantity = data.get('quantity')
        unit_price = data.get('unit_price')

        if product and quantity:
            # Check product availability
            if quantity > product.stock_quantity:
                raise serializers.ValidationError(f"Not enough stock for {product.name}")

            # Calculate total
            data['total'] = quantity * unit_price

        return data

class OrderSerializer(serializers.ModelSerializer):
    """
    Comprehensive Order serializer with nested items
    """
    items = OrderItemSerializer(many=True, required=False)
    customer_name = serializers.CharField(source='customer.name', read_only=True)

    class Meta:
        model = Order
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'total', 'status']

    def validate(self, data):
        """
        Additional order-level validation
        """
        # You can add more complex validation here
        return data

    def create(self, validated_data):
        """
        Custom create method to handle nested order items
        """
        items_data = self.context.get('request').data.get('items', [])
        order = Order.objects.create(**validated_data)

        # Create order items
        for item_data in items_data:
            product = Product.objects.get(id=item_data['product'])
            OrderItem.objects.create(
                order=order, 
                product=product, 
                quantity=item_data['quantity'],
                unit_price=item_data['unit_price']
            )

        return order

    def update(self, instance, validated_data):
        """
        Custom update method to handle nested order items
        """
        # Update order fields
        instance.customer = validated_data.get('customer', instance.customer)
        instance.delivery_date = validated_data.get('delivery_date', instance.delivery_date)
        instance.save()

        # Update or create order items
        items_data = self.context.get('request').data.get('items', [])
        
        # Remove existing items
        instance.items.all().delete()

        # Create new items
        for item_data in items_data:
            product = Product.objects.get(id=item_data['product'])
            OrderItem.objects.create(
                order=instance, 
                product=product, 
                quantity=item_data['quantity'],
                unit_price=item_data['unit_price']
            )

        return instance