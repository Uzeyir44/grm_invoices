"""
Authentication serializers for the platform System Admin boundary.

The admin login resolves the reserved platform company internally (the client
never supplies a ``company_id``), authenticates against the existing
``CompanyEmailBackend``, and requires the account to hold a system-scoped role.
Issued tokens carry the explicit ``scope=system_admin`` claim.
"""

from django.contrib.auth import authenticate
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.authentication.rbac import is_system_admin, system_permission_codes_for
from apps.system_admin.constants import SYSTEM_ADMIN_SCOPE, SYSTEM_ADMIN_SCOPE_CLAIM
from apps.system_admin.services import PlatformConfigurationError, get_platform_company

GENERIC_AUTH_ERROR = "No active account found with the given credentials"


def platform_account_is_usable(user, platform_company=None):
    """A usable System Admin: active, not deleted, and holding a system role."""
    if user is None:
        return False
    if not user.is_active or user.deleted_at is not None:
        return False
    if platform_company is not None and user.company_id != platform_company.id:
        return False
    # MFA fields exist for a future implementation, but no verifier or secret
    # encryption service exists yet. Fail closed rather than issuing a token
    # for an account marked as MFA-enabled without completing MFA.
    if user.mfa_enabled:
        return False
    return is_system_admin(user)


class SystemAdminTokenObtainSerializer(serializers.Serializer):
    """Issue a platform admin JWT pair; System Admins only."""

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        try:
            company = get_platform_company()
        except PlatformConfigurationError:
            # Never reveal platform provisioning state to an unauthenticated
            # caller: fail exactly like bad credentials.
            raise AuthenticationFailed(GENERIC_AUTH_ERROR, "no_active_account")

        user = authenticate(
            request=self.context.get("request"),
            company_id=company.id,
            email=attrs["email"],
            password=attrs["password"],
        )
        if not platform_account_is_usable(user, company):
            raise AuthenticationFailed(GENERIC_AUTH_ERROR, "no_active_account")

        refresh = RefreshToken.for_user(user)
        refresh[SYSTEM_ADMIN_SCOPE_CLAIM] = SYSTEM_ADMIN_SCOPE
        refresh["company_id"] = user.company_id
        return {"refresh": str(refresh), "access": str(refresh.access_token)}


class SystemAdminTokenRefreshSerializer(serializers.Serializer):
    """
    Refresh a platform admin access token.

    Rejects company refresh tokens (no platform scope claim), re-validates the
    account against the platform account rule (not the company-status rule),
    and preserves the platform scope claim.
    """

    refresh = serializers.CharField()
    access = serializers.CharField(read_only=True)
    token_class = RefreshToken

    default_error_messages = {
        "no_active_account": (
            "No active System Admin account found for the given token."
        )
    }

    def validate(self, attrs):
        refresh = self.token_class(attrs["refresh"])

        if refresh.get(SYSTEM_ADMIN_SCOPE_CLAIM) != SYSTEM_ADMIN_SCOPE:
            raise AuthenticationFailed(GENERIC_AUTH_ERROR, "no_active_account")

        user_id = refresh.get(api_settings.USER_ID_CLAIM)
        user = User.objects.filter(pk=user_id).first() if user_id is not None else None
        try:
            platform_company = get_platform_company()
        except PlatformConfigurationError:
            raise AuthenticationFailed(GENERIC_AUTH_ERROR, "no_active_account")
        if not platform_account_is_usable(user, platform_company):
            raise AuthenticationFailed(GENERIC_AUTH_ERROR, "no_active_account")

        access = refresh.access_token
        # The boundary claim must always survive a refresh; re-assert it rather
        # than trusting claim propagation.
        access[SYSTEM_ADMIN_SCOPE_CLAIM] = SYSTEM_ADMIN_SCOPE

        data = {"access": str(access)}
        if api_settings.ROTATE_REFRESH_TOKENS:
            if api_settings.BLACKLIST_AFTER_ROTATION:
                try:
                    refresh.blacklist()
                except AttributeError:
                    pass
            refresh.set_jti()
            refresh.set_exp()
            refresh.set_iat()
            refresh.outstand()
            data["refresh"] = str(refresh)
        return data


class SystemAdminMeSerializer(serializers.ModelSerializer):
    """
    Identity + system authorization for the AdminAuthContext.

    Only non-sensitive identity and authorization data; no password hash, no MFA
    secret, no tenant business data.
    """

    company_id = serializers.IntegerField(read_only=True)
    company_name = serializers.CharField(source="company.display_name", read_only=True)
    scope = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "is_active",
            "company_id",
            "company_name",
            "scope",
            "permissions",
        ]

    def get_scope(self, obj):
        return SYSTEM_ADMIN_SCOPE

    def get_permissions(self, obj):
        return sorted(system_permission_codes_for(obj))
