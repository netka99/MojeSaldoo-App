from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import CurrentUserView, UserRegistrationView, UserTokenObtainPairView

urlpatterns = [
    path("login/", UserTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("register/", UserRegistrationView.as_view(), name="user_register"),
    path("me/", CurrentUserView.as_view(), name="current_user"),
]
