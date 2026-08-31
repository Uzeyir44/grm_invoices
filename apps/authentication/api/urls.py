from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView, TokenVerifyView

from apps.authentication.api.views import CompanyTokenObtainPairView, MeView

urlpatterns = [
    path("token/", CompanyTokenObtainPairView.as_view(), name="auth-token-obtain"),
    path("token/refresh/", TokenRefreshView.as_view(), name="auth-token-refresh"),
    path("token/verify/", TokenVerifyView.as_view(), name="auth-token-verify"),
    path("me/", MeView.as_view(), name="auth-me"),
]