from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import CurrentUserView, PasswordResetConfirmView, PasswordResetRequestView, UserRegistrationView, UserTokenObtainPairView

urlpatterns = [
    path("login/", UserTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("register/", UserRegistrationView.as_view(), name="user_register"),
    path("me/", CurrentUserView.as_view(), name="current_user"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password_reset"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password_reset_confirm"),
]
