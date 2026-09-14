from django.urls import path

from apps.system_admin.api.views import (
    AdminCompanyActivateView,
    AdminCompanyDeactivateView,
    AdminCompanyDetailView,
    AdminCompanyListView,
    AdminCompanyProvisionView,
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
    # Company management (Phase 4).
    path(
        "companies/",
        AdminCompanyListView.as_view(),
        name="admin-company-list",
    ),
    path(
        "companies/provision/",
        AdminCompanyProvisionView.as_view(),
        name="admin-company-provision",
    ),
    path(
        "companies/<int:pk>/",
        AdminCompanyDetailView.as_view(),
        name="admin-company-detail",
    ),
    path(
        "companies/<int:pk>/activate/",
        AdminCompanyActivateView.as_view(),
        name="admin-company-activate",
    ),
    path(
        "companies/<int:pk>/deactivate/",
        AdminCompanyDeactivateView.as_view(),
        name="admin-company-deactivate",
    ),
]
