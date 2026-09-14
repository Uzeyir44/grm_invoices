"""
Phase 2 — reusable System Admin authorization boundary tests.

Proves that ``system_permission_required`` enforces the full platform boundary
(active privileged account + ``scope=system_admin`` token claim + system RBAC
identity) *and* a specific system permission, and that neither a tenant
principal nor a tenant permission can satisfy it.
"""

import uuid

from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, APITestCase, force_authenticate
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import AccessToken

from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.rbac import (
    is_system_admin,
    system_permission_codes_for,
    user_has_permission,
)
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.system_admin.authentication import SystemAdminJWTAuthentication
from apps.system_admin.constants import SYSTEM_ADMIN_SCOPE, SYSTEM_ADMIN_SCOPE_CLAIM
from apps.system_admin.permissions import (
    system_permission_required,
    system_user_has_permission,
)
from apps.system_admin.tests.support import make_platform_company, make_system_admin


class SystemPermissionEchoView(APIView):
    """Test-only endpoint protected by the Phase 2 admin boundary."""

    authentication_classes = [SystemAdminJWTAuthentication]
    permission_classes = [system_permission_required("system.companies.manage")]

    def get(self, request):
        return Response({"ok": True})


def access_token_with_scope(scope=SYSTEM_ADMIN_SCOPE):
    token = AccessToken()
    if scope is not None:
        token[SYSTEM_ADMIN_SCOPE_CLAIM] = scope
    return token


class SystemPermissionRequiredTests(APITestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.view = SystemPermissionEchoView.as_view()
        self.platform = make_platform_company()
        self.admin = make_system_admin(
            company=self.platform, email="root@grm.example"
        )
        self.tenant = make_company()
        self.tenant_user = make_user(self.tenant, email="alice@example.com")

    def call(self, user=None, token=None):
        request = self.factory.get("/api/admin/verify/")
        if user is not None:
            force_authenticate(request, user=user, token=token)
        return self.view(request)

    def grant_all_tenant_permissions(self, user):
        role = Role.objects.create(
            name=f"Tenant Admin {uuid.uuid4().hex[:8]}", company=None, scope="tenant"
        )
        for permission in Permission.objects.filter(scope="tenant"):
            role.permissions.add(permission)
        UserRole.objects.create(user=user, role=role)
        return role

    def grant_system_permissions(self, user, *codes):
        role = Role.objects.create(
            name=f"System Role {uuid.uuid4().hex[:8]}", company=None, scope="system"
        )
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code, scope="system"))
        UserRole.objects.create(user=user, role=role)
        return role

    # ------------------------------------------------------------ boundary

    def test_anonymous_is_rejected_with_401(self):
        response = self.call()
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_company_user_without_scope_claim_is_denied(self):
        token = AccessToken.for_user(self.tenant_user)
        response = self.call(user=self.tenant_user, token=token)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_company_user_with_every_tenant_permission_is_denied(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        # Even a forged platform claim on a tenant identity must not pass: the
        # boundary also requires a real system-scoped RBAC identity.
        response = self.call(
            user=self.tenant_user, token=access_token_with_scope()
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_tenant_role_named_like_admin_is_not_a_system_admin(self):
        role = Role.objects.create(
            name="System Admin (Tenant)", company=None, scope="tenant"
        )
        role.permissions.add(Permission.objects.get(code="clients.read"))
        UserRole.objects.create(user=self.tenant_user, role=role)
        self.assertFalse(is_system_admin(self.tenant_user))
        response = self.call(
            user=self.tenant_user, token=access_token_with_scope()
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_system_admin_without_required_permission_is_denied(self):
        other_admin = make_user(self.platform, email="other@grm.example")
        self.grant_system_permissions(other_admin, "system.audit.read")
        self.assertTrue(is_system_admin(other_admin))
        response = self.call(user=other_admin, token=access_token_with_scope())
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_system_admin_with_required_permission_is_allowed(self):
        response = self.call(user=self.admin, token=access_token_with_scope())
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_missing_scope_claim_denied_even_for_system_admin(self):
        response = self.call(user=self.admin, token=access_token_with_scope(None))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_wrong_scope_claim_denied(self):
        response = self.call(
            user=self.admin, token=access_token_with_scope("tenant")
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # ------------------------------------------------------- helper/scope

    def test_system_user_has_permission_requires_identity_and_scope(self):
        self.assertTrue(
            system_user_has_permission(self.admin, "system.companies.manage")
        )
        self.assertFalse(system_user_has_permission(self.admin, "clients.read"))
        self.assertFalse(
            system_user_has_permission(
                self.tenant_user, "system.companies.manage"
            )
        )
        self.assertFalse(
            system_user_has_permission(None, "system.companies.manage")
        )

    def test_tenant_permission_never_satisfies_system_check(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        self.assertFalse(
            system_user_has_permission(self.tenant_user, "clients.read")
        )
        self.assertFalse(
            system_user_has_permission(
                self.tenant_user, "system.companies.manage"
            )
        )
        # And system permissions never resolve as tenant permissions.
        self.assertEqual(user_has_permission(self.admin, "clients.read"), False)

    def test_system_permission_codes_reflect_system_role_only(self):
        codes = system_permission_codes_for(self.admin)
        self.assertIn("system.companies.manage", codes)
        self.assertNotIn("clients.read", codes)


class SystemPermissionFactoryTests(APITestCase):
    def test_factory_returns_boundary_enforcing_permission_subclass(self):
        from apps.system_admin.permissions import (
            IsSystemAdmin,
            SystemPermissionRequired,
        )

        cls = system_permission_required("system.companies.manage")
        self.assertTrue(issubclass(cls, SystemPermissionRequired))
        self.assertTrue(issubclass(cls, IsSystemAdmin))
        self.assertEqual(cls.required_permission, "system.companies.manage")
        self.assertIn("system.companies.manage", cls.message)
