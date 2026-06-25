"""
POST /api/auth/google/

Body: { "credential": "<Google ID token from GIS one-tap / OAuth button>" }

Flow:
  1. Verify the id_token with Google's public keys.
  2. Extract email, given_name, family_name, sub (Google UID).
  3. Find or create a Django user by email.
  4. Return the same JWT payload as the normal login endpoint.
"""
import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .serializers import UserSerializer

logger = logging.getLogger(__name__)
User = get_user_model()


def _make_jwt_response(user) -> dict:
    """Build the same response shape as UserTokenObtainPairSerializer."""
    refresh = RefreshToken.for_user(user)
    refresh["username"] = user.username
    refresh["email"] = user.email
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "user": UserSerializer(user).data,
    }


class GoogleAuthView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        credential = request.data.get("credential", "").strip()
        if not credential:
            return Response(
                {"detail": "Pole 'credential' jest wymagane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        client_id = getattr(settings, "GOOGLE_CLIENT_ID", None)
        if not client_id:
            return Response(
                {"detail": "Google OAuth nie jest skonfigurowane na serwerze (brak GOOGLE_CLIENT_ID)."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Verify the token with Google.
        try:
            id_info = google_id_token.verify_oauth2_token(
                credential,
                google_requests.Request(),
                client_id,
            )
        except ValueError as exc:
            logger.warning("Google id_token verification failed: %s", exc)
            return Response(
                {"detail": "Nieprawidłowy token Google. Spróbuj ponownie."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email: str = id_info.get("email", "").lower().strip()
        if not email:
            return Response(
                {"detail": "Token Google nie zawiera adresu e-mail."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not id_info.get("email_verified", False):
            return Response(
                {"detail": "Adres e-mail w koncie Google nie jest zweryfikowany."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        given_name: str = id_info.get("given_name", "")
        family_name: str = id_info.get("family_name", "")
        google_sub: str = id_info.get("sub", "")

        # Find existing user by email or create a new one.
        user, created = User.objects.get_or_create(
            email__iexact=email,
            defaults={
                "username": _unique_username(email, google_sub),
                "email": email,
                "first_name": given_name,
                "last_name": family_name,
                "is_active": True,
            },
        )

        if created:
            # Google-authenticated users have no usable password.
            user.set_unusable_password()
            user.save(update_fields=["password"])
        else:
            # Keep name in sync on subsequent logins.
            updated = False
            if given_name and not user.first_name:
                user.first_name = given_name
                updated = True
            if family_name and not user.last_name:
                user.last_name = family_name
                updated = True
            if updated:
                user.save(update_fields=["first_name", "last_name"])

        if not user.is_active:
            return Response(
                {"detail": "To konto jest nieaktywne. Skontaktuj się z administratorem."},
                status=status.HTTP_403_FORBIDDEN,
            )

        return Response(_make_jwt_response(user), status=status.HTTP_200_OK)


def _unique_username(email: str, google_sub: str) -> str:
    """Derive a unique username from the email prefix, falling back to sub."""
    base = email.split("@")[0][:30]
    base = "".join(c for c in base if c.isalnum() or c in "._-") or "user"

    if not User.objects.filter(username=base).exists():
        return base

    for length in range(4, 12):
        candidate = f"{base}_{google_sub[:length]}"
        if not User.objects.filter(username=candidate).exists():
            return candidate

    import uuid
    return f"{base}_{uuid.uuid4().hex[:8]}"
