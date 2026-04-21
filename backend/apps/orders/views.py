from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import Order
from .serializers import OrderSerializer

class OrderViewSet(viewsets.ModelViewSet):
    """
    Comprehensive ViewSet for Order model with advanced filtering and custom actions
    """
    queryset = Order.objects.all()
    serializer_class = OrderSerializer
    
    # Advanced filtering and search capabilities
    filter_backends = [
        DjangoFilterBackend, 
        filters.SearchFilter, 
        filters.OrderingFilter
    ]
    
    # Fields that can be used for filtering
    filterset_fields = [
        'customer', 
        'status', 
        'order_date', 
        'delivery_date'
    ]
    
    # Fields that can be searched
    search_fields = [
        'id', 
        'customer__name'
    ]
    
    # Fields that can be used for ordering
    ordering_fields = [
        'order_date', 
        'delivery_date', 
        'total', 
        'created_at'
    ]

    def get_queryset(self):
        """
        Customize queryset based on request parameters
        """
        return Order.objects.all().order_by('-created_at')

    @action(detail=True, methods=['POST'], url_path='confirm')
    def confirm_order(self, request, pk=None):
        """
        Custom action to confirm an order
        """
        order = self.get_object()
        
        try:
            # Validate and update order status
            if order.status != 'draft':
                return Response({
                    'error': 'Only draft orders can be confirmed'
                }, status=status.HTTP_400_BAD_REQUEST)

            # Update order status
            order.status = 'confirmed'
            order.save()

            # Optional: Additional logic like stock reduction
            for item in order.items.all():
                product = item.product
                product.update_stock(-item.quantity)

            serializer = self.get_serializer(order)
            return Response(serializer.data)

        except Exception as e:
            return Response({
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['POST'], url_path='cancel')
    def cancel_order(self, request, pk=None):
        """
        Custom action to cancel an order
        """
        order = self.get_object()
        
        try:
            # Validate and update order status
            if order.status in ['completed', 'cancelled']:
                return Response({
                    'error': f'Cannot cancel order with status {order.status}'
                }, status=status.HTTP_400_BAD_REQUEST)

            # Update order status
            order.status = 'cancelled'
            order.save()

            serializer = self.get_serializer(order)
            return Response(serializer.data)

        except Exception as e:
            return Response({
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)