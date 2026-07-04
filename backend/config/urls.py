from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse


def healthz(request):
    """Liveness probe for the container HEALTHCHECK — no auth, no DB access."""
    return JsonResponse({'status': 'ok'})


urlpatterns = [
    path('healthz/', healthz),
    path('admin/', admin.site.urls),
    path('api/auth/', include('apps.users.urls')),
    path('api/companies/', include('apps.users.company_urls')),
    # Business API (routers in apps.*/urls.py)
    path('api/', include('apps.products.urls')),
    path('api/', include('apps.customers.urls')),
    path('api/', include('apps.suppliers.urls')),
    path('api/orders/', include('apps.orders.urls')),
    path('api/delivery/', include('apps.delivery.urls')),
    path('api/van-routes/', include('apps.van_routes.urls')),
    path('api/invoices/', include('apps.invoices.urls')),
    path('api/ksef/', include('apps.ksef.urls')),
    path('api/reports/', include('apps.reporting.urls')),
    path('api/cost-allocation/', include('apps.cost_allocation.urls')),
    path('api/production/', include('apps.production.urls')),
    path('api/inventory/', include('apps.inventory.urls')),
]

# Serve media files during development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)