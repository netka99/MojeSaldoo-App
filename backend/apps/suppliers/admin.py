from django.contrib import admin

from .models import Supplier


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ['name', 'nip', 'city', 'company', 'is_active']
    list_filter = ['is_active', 'company']
    search_fields = ['name', 'nip', 'city']
