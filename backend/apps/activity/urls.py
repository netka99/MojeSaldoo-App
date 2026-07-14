from django.urls import path
from .views import ActivityLogView

urlpatterns = [
    path("activity/", ActivityLogView.as_view(), name="activity-log"),
]
