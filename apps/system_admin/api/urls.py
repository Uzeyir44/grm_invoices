from django.urls import path

from apps.system_admin.api.views import (
    SystemAdminMeView,
    SystemAdminTokenObtainView,
    SystemAdminTokenRefreshView,
)

urlpatterns = [
    path(
        "authentication/token/",
        SystemAdminTokenObtainView.as_view(),
        name="admin-auth-token-obtain",
    ),
    path(
        "authentication/token/refresh/",
        SystemAdminTokenRefreshView.as_view(),
        name="admin-auth-token-refresh",
    ),
    path(
        "authentication/me/",
        SystemAdminMeView.as_view(),
        name="admin-auth-me",
    ),
]
