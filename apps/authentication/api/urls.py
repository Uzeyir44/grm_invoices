from django.urls import path

from rest_framework_simplejwt.views import TokenVerifyView

from apps.authentication.api.views import (
    CompanyTokenObtainPairView,
    CompanyTokenRefreshView,
    MeView,
)

urlpatterns = [
    path("token/", CompanyTokenObtainPairView.as_view(), name="auth-token-obtain"),
    path("token/refresh/", CompanyTokenRefreshView.as_view(), name="auth-token-refresh"),
    path("token/verify/", TokenVerifyView.as_view(), name="auth-token-verify"),
    path("me/", MeView.as_view(), name="auth-me"),
]