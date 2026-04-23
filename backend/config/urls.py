from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('apps.users.urls')),
    path('api/companies/', include('apps.users.company_urls')),
    path('api/', include('apps.products.urls')),
    path('api/', include('apps.customers.urls')),
    path('api/orders/', include('apps.orders.urls')),
    path('api/invoices/', include('apps.invoices.urls')),
]

# Serve media files during development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)