from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .google_auth_views import GoogleAuthView
from .onboarding_views import OnboardingCompleteView
from .views import CurrentUserView, FCMTokenView, PasswordResetConfirmView, PasswordResetRequestView, UserRegistrationView, UserTokenObtainPairView, WebPushPublicKeyView, WebPushSubscriptionView

urlpatterns = [
    path("login/", UserTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("register/", UserRegistrationView.as_view(), name="user_register"),
    path("google/", GoogleAuthView.as_view(), name="google_auth"),
    path("me/", CurrentUserView.as_view(), name="current_user"),
    path("onboarding/complete/", OnboardingCompleteView.as_view(), name="onboarding_complete"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password_reset"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password_reset_confirm"),
    path("fcm-token/", FCMTokenView.as_view(), name="fcm_token"),
    path("push-public-key/", WebPushPublicKeyView.as_view(), name="push_public_key"),
    path("push-subscription/", WebPushSubscriptionView.as_view(), name="push_subscription"),
]
