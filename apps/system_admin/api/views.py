"""Views for the platform System Admin authentication boundary."""

from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenViewBase

from apps.system_admin.api.serializers import (
    SystemAdminMeSerializer,
    SystemAdminTokenObtainSerializer,
    SystemAdminTokenRefreshSerializer,
)
from apps.system_admin.authentication import SystemAdminJWTAuthentication
from apps.system_admin.permissions import IsSystemAdmin


class SystemAdminTokenObtainView(TokenViewBase):
    """
    POST /api/admin/authentication/token/  {email, password}

    System Admins only. A company user (with or without tenant permissions)
    receives the same generic 401 as bad credentials. ``TokenViewBase`` keeps
    that failure a 401 (it supplies the WWW-Authenticate header DRF needs).
    """

    serializer_class = SystemAdminTokenObtainSerializer
    throttle_scope = "auth_login"


class SystemAdminTokenRefreshView(TokenViewBase):
    """POST /api/admin/authentication/token/refresh/  {refresh}"""

    serializer_class = SystemAdminTokenRefreshSerializer
    throttle_scope = "auth_refresh"


class SystemAdminMeView(APIView):
    """GET /api/admin/authentication/me/ — the authenticated System Admin."""

    authentication_classes = [SystemAdminJWTAuthentication]
    permission_classes = [IsSystemAdmin]

    def get(self, request):
        return Response(SystemAdminMeSerializer(request.user).data)
