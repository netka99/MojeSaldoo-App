import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

ASGI_APPLICATION = 'config.asgi.application'

application = get_asgi_application()
