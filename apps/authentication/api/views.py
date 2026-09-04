from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.authentication.api.serializers import (
    CompanyTokenObtainPairSerializer,
    MeSerializer,
)


class CompanyTokenObtainPairView(TokenObtainPairView):
    # Per-IP scope protecting credential brute-force/guessing attempts. Runs
    # before the login serializer (and thus before password hashing).
    throttle_scope = "auth_login"
    serializer_class = CompanyTokenObtainPairSerializer


class CompanyTokenRefreshView(TokenRefreshView):
    # Per-IP scope controlling refresh-token abuse without affecting any
    # token/JWT semantics.
    throttle_scope = "auth_refresh"


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = MeSerializer(request.user)
        return Response(serializer.data)