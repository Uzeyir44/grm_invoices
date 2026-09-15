"""
System Admin authentication/authorization boundary tests (Phase 1).

Proves the disambiguation the phase is built to guarantee:

    anonymous            -> 401
    normal company user  -> 403 / denied
    provisioned admin    -> 200

and that the two token families (company vs system_admin) stay separate.
"""

from django.urls import reverse
from django.utils import timezone

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework.throttling import SimpleRateThrottle
from unittest import mock

from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.companies.models import Company
from apps.system_admin.constants import SYSTEM_ADMIN_SCOPE
from apps.system_admin.tests.support import (
    PASSWORD,
    make_platform_company,
    make_system_admin,
)

TENANT_PERMISSION_CODES = [
    "clients.read",
    "clients.create",
    "clients.update",
    "clients.delete",
    "document_templates.read",
    "generated_documents.read",
    "audit_logs.read",
]


class SystemAdminBoundaryTests(APITestCase):
    def setUp(self):
        # Login/refresh throttles key on the shared client IP; reset the cache
        # (same convention as the existing authentication tests) so each test
        # is independent of the others' request counts.
        from django.core.cache import cache

        cache.clear()

        self.platform = make_platform_company()
        self.admin = make_system_admin(
            company=self.platform, email="root@grm.example"
        )
        self.tenant = make_company()
        self.tenant_user = make_user(self.tenant, email="alice@example.com")

        self.admin_me_url = reverse("admin-auth-me")
        self.admin_token_url = reverse("admin-auth-token-obtain")
        self.admin_refresh_url = reverse("admin-auth-token-refresh")

    # ---------------------------------------------------------------- helpers

    def obtain_admin_tokens(self, email="root@grm.example", password=PASSWORD):
        return self.client.post(
            self.admin_token_url,
            {"email": email, "password": password},
            format="json",
        )

    def company_tokens(self, company, email, password=PASSWORD):
        return self.client.post(
            reverse("auth-token-obtain"),
            {"company_id": company.id, "email": email, "password": password},
            format="json",
        )

    def authenticate(self, access):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

    def grant_tenant_permissions(self, user):
        role = Role.objects.create(
            name="Tenant Admin", company=None, scope="tenant"
        )
        for code in TENANT_PERMISSION_CODES:
            role.permissions.add(Permission.objects.get(code=code))
        UserRole.objects.create(user=user, role=role)
        return role

    # ------------------------------------------------------- authentication

    def test_anonymous_admin_me_returns_401(self):
        response = self.client.get(self.admin_me_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_company_user_cannot_obtain_admin_token(self):
        response = self.obtain_admin_tokens(email="alice@example.com")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertNotIn("access", response.json())

    def test_company_user_with_tenant_permissions_cannot_obtain_admin_token(self):
        self.grant_tenant_permissions(self.tenant_user)
        response = self.obtain_admin_tokens(email="alice@example.com")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_unknown_email_cannot_obtain_admin_token(self):
        response = self.obtain_admin_tokens(email="ghost@grm.example")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_wrong_password_cannot_obtain_admin_token(self):
        response = self.obtain_admin_tokens(password="wrong-password")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_system_admin_can_obtain_admin_token_with_scope_claim(self):
        response = self.obtain_admin_tokens()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn("access", data)
        self.assertIn("refresh", data)
        access = AccessToken(data["access"])
        self.assertEqual(access["scope"], SYSTEM_ADMIN_SCOPE)
        self.assertEqual(access["company_id"], self.platform.id)

    def test_admin_login_has_a_separate_throttle_scope(self):
        with mock.patch.object(
            SimpleRateThrottle,
            "THROTTLE_RATES",
            {"admin_login": "1/min"},
        ):
            self.assertEqual(self.obtain_admin_tokens().status_code, status.HTTP_200_OK)
            self.assertEqual(
                self.obtain_admin_tokens().status_code,
                status.HTTP_429_TOO_MANY_REQUESTS,
            )

    def test_admin_token_missing_scope_claim_is_rejected(self):
        # A hand-built token for the admin user that lacks the platform claim
        # must not pass the boundary.
        from rest_framework_simplejwt.tokens import RefreshToken

        token = RefreshToken.for_user(self.admin)
        self.authenticate(str(token.access_token))
        response = self.client.get(self.admin_me_url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # --------------------------------------------------------------- /me

    def test_system_admin_admin_me_returns_200(self):
        tokens = self.obtain_admin_tokens().json()
        self.authenticate(tokens["access"])
        response = self.client.get(self.admin_me_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["email"], "root@grm.example")
        self.assertEqual(data["company_id"], self.platform.id)
        self.assertEqual(data["scope"], SYSTEM_ADMIN_SCOPE)
        self.assertIn("system.companies.manage", data["permissions"])
        # No sensitive/tenant fields leak.
        for forbidden in ("password", "mfa_enabled", "mfa_secret_encrypted"):
            self.assertNotIn(forbidden, data)

    # --------------------------------------------------- token separation

    def test_company_token_cannot_access_admin_me(self):
        tokens = self.company_tokens(self.tenant, "alice@example.com").json()
        self.authenticate(tokens["access"])
        response = self.client.get(self.admin_me_url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_token_does_not_bypass_tenant_isolation(self):
        tokens = self.obtain_admin_tokens().json()
        self.authenticate(tokens["access"])
        # The company clients API still requires a tenant permission; the
        # platform identity has none, so it is refused (no cross-tenant read).
        response = self.client.get(reverse("client-list-create"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_token_does_not_become_a_company_membership(self):
        tokens = self.obtain_admin_tokens().json()
        self.authenticate(tokens["access"])
        # /me (company) resolves the admin's own (platform) company, not a
        # tenant, and never elevates tenant access.
        response = self.client.get(reverse("auth-me"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["company_id"], self.platform.id)

    # ------------------------------------------------------- token refresh

    def test_admin_refresh_preserves_scope(self):
        tokens = self.obtain_admin_tokens().json()
        response = self.client.post(
            self.admin_refresh_url, {"refresh": tokens["refresh"]}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        access = AccessToken(response.json()["access"])
        self.assertEqual(access["scope"], SYSTEM_ADMIN_SCOPE)

    def test_company_refresh_cannot_be_used_for_admin_refresh(self):
        tokens = self.company_tokens(self.tenant, "alice@example.com").json()
        response = self.client.post(
            self.admin_refresh_url, {"refresh": tokens["refresh"]}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_admin_refresh_rejected_when_role_removed(self):
        tokens = self.obtain_admin_tokens().json()
        UserRole.objects.filter(user=self.admin).delete()
        response = self.client.post(
            self.admin_refresh_url, {"refresh": tokens["refresh"]}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    # --------------------------------------------------- account validity

    def test_deactivated_system_admin_cannot_obtain_token(self):
        self.admin.is_active = False
        self.admin.save(update_fields=["is_active"])
        self.assertEqual(
            self.obtain_admin_tokens().status_code, status.HTTP_401_UNAUTHORIZED
        )

    def test_mfa_marked_system_admin_fails_closed_until_mfa_exists(self):
        self.admin.mfa_enabled = True
        self.admin.save(update_fields=["mfa_enabled"])
        self.assertEqual(
            self.obtain_admin_tokens().status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_soft_deleted_system_admin_cannot_obtain_token(self):
        self.admin.deleted_at = timezone.now()
        self.admin.save(update_fields=["deleted_at"])
        self.assertEqual(
            self.obtain_admin_tokens().status_code, status.HTTP_401_UNAUTHORIZED
        )

    def test_admin_token_rejected_after_account_deactivation(self):
        tokens = self.obtain_admin_tokens().json()
        self.admin.is_active = False
        self.admin.save(update_fields=["is_active"])
        self.authenticate(tokens["access"])
        self.assertEqual(
            self.client.get(self.admin_me_url).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    # ---------------------------------------------------- tenant status

    def test_admin_authentication_not_gated_by_target_tenant_status(self):
        make_company(status_=Company.Status.SUSPENDED)
        make_company(status_=Company.Status.CANCELLED)
        response = self.obtain_admin_tokens()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.authenticate(response.json()["access"])
        self.assertEqual(
            self.client.get(self.admin_me_url).status_code, status.HTTP_200_OK
        )

    def test_suspended_tenant_user_still_cannot_become_admin(self):
        suspended = make_company(status_=Company.Status.SUSPENDED)
        user = make_user(suspended, email="suspended@example.com")
        response = self.obtain_admin_tokens(email=user.email, password=PASSWORD)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
