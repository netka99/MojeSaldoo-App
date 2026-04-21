from rest_framework import viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend
from .models import Customer
from .serializers import CustomerSerializer

class CustomerViewSet(viewsets.ModelViewSet):
    """
    Comprehensive ViewSet for Customer model with advanced filtering and search
    """
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
    
    # Advanced filtering and search capabilities
    filter_backends = [
        DjangoFilterBackend, 
        filters.SearchFilter, 
        filters.OrderingFilter
    ]
    
    # Fields that can be used for filtering
    filterset_fields = [
        'name', 
        'nip', 
        'distance'
    ]
    
    # Fields that can be searched
    search_fields = [
        'name', 
        'nip', 
        'phone'
    ]
    
    # Fields that can be used for ordering
    ordering_fields = [
        'name', 
        'distance', 
        'created_at'
    ]

    def get_queryset(self):
        """
        Optionally customize queryset based on request
        """
        return Customer.objects.all().order_by('-created_at')

    def perform_create(self, serializer):
        """
        Custom create method to add any additional logic
        """
        serializer.save()

    def perform_update(self, serializer):
        """
        Custom update method to add any additional logic
        """
        serializer.save()