from rest_framework import viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend
from .models import Product
from .serializers import ProductSerializer

class ProductViewSet(viewsets.ModelViewSet):
    """
    Comprehensive ViewSet for Product model with advanced filtering and search
    """
    queryset = Product.objects.all()
    serializer_class = ProductSerializer
    
    # Advanced filtering and search capabilities
    filter_backends = [
        DjangoFilterBackend, 
        filters.SearchFilter, 
        filters.OrderingFilter
    ]
    
    # Fields that can be used for filtering
    filterset_fields = [
        'name', 
        'unit', 
        'price', 
        'stock_quantity', 
        'category'
    ]
    
    # Fields that can be searched
    search_fields = [
        'name', 
        'description', 
        'category'
    ]
    
    # Fields that can be used for ordering
    ordering_fields = [
        'name', 
        'price', 
        'stock_quantity', 
        'created_at'
    ]

    def get_queryset(self):
        """
        Optionally customize queryset based on request
        For now, return all products, but can be modified later
        """
        return Product.objects.all().order_by('-created_at')

    def perform_create(self, serializer):
        """
        Custom create method to add any additional logic
        """
        # Example: You could add user-specific logic here
        serializer.save()

    def perform_update(self, serializer):
        """
        Custom update method to add any additional logic
        """
        serializer.save()