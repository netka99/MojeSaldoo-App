import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

WSGI_APPLICATION = 'config.wsgi.application'

application = get_wsgi_application()
