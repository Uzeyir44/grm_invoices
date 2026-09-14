"""
Phase 6 — System Admin RBAC role & permission management tests.

Covers the authorization matrix, permission catalog, global role listing,
tenant-role creation/update, role-permission assignment/removal, strict
tenant/system scope enforcement, protected System Admin role, platform-company
protection, company immutability, platform audit, and the database triggers.
"""

import json
import uuid

from django.db import IntegrityError, ProgrammingError, transaction
from django.urls import reverse

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.audit_logs.models import AuditLog
from apps.authentication.models import (
    Permission,
    Role,
    RolePermission,
    Scope,
    UserRole,
)
from apps.authentication.rbac import is_system_admin
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.system_admin.constants import (
    SYSTEM_ADMIN_SCOPE,
    SYSTEM_ADMIN_SCOPE_CLAIM,
)
from apps.system_admin.tests.support import (
    make_platform_company,
    make_system_admin,
)


class RoleManagementTestBase(APITestCase):
    def setUp(self):
        self.platform = make_platform_company()
        self.admin = make_system_admin(
            company=self.platform, email="root@grm.example"
        )

        self.company_a = make_company()
        self.company_b = make_company()

        self.role_a = Role.objects.create(
            company=self.company_a, name="Manager A", scope=Scope.TENANT
        )
        self.role_a2 = Role.objects.create(
            company=self.company_a, name="Viewer A", scope=Scope.TENANT
        )
        self.role_b = Role.objects.create(
            company=self.company_b, name="Manager B", scope=Scope.TENANT
        )
        self.global_template = Role.objects.create(
            company=None, name="Global Template", scope=Scope.TENANT
        )
        self.system_role = Role.objects.get(name="System Admin", scope=Scope.SYSTEM)

        self.tenant_permission = Permission.objects.get(
            code="clients.read", scope=Scope.TENANT
        )
        self.tenant_permission2 = Permission.objects.get(
            code="clients.update", scope=Scope.TENANT
        )
        self.system_permission = Permission.objects.get(
            code="system.users.manage", scope=Scope.SYSTEM
        )

        self.tenant_user = make_user(self.company_a, email="alice@a.example")

    # ------------------------------------------------------------- helpers

    def admin_token(self, scope=SYSTEM_ADMIN_SCOPE):
        token = AccessToken()
        if scope is not None:
            token[SYSTEM_ADMIN_SCOPE_CLAIM] = scope
        return token

    def authenticate_admin(self, user=None, scope=SYSTEM_ADMIN_SCOPE):
        self.client.force_authenticate(
            user=user or self.admin, token=self.admin_token(scope)
        )

    def grant_all_tenant_permissions(self, user):
        role = Role.objects.create(
            name=f"Tenant Admin {uuid.uuid4().hex[:8]}",
            company=None,
            scope=Scope.TENANT,
        )
        for permission in Permission.objects.filter(scope=Scope.TENANT):
            role.permissions.add(permission)
        UserRole.objects.create(user=user, role=role)
        return role

    def grant_system_permissions(self, user, *codes):
        role = Role.objects.create(
            name=f"System Role {uuid.uuid4().hex[:8]}",
            company=None,
            scope=Scope.SYSTEM,
        )
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code, scope=Scope.SYSTEM))
        UserRole.objects.create(user=user, role=role)
        return role

    def call(self, method, url, body=None):
        fn = getattr(self.client, method.lower())
        if body is not None:
            return fn(url, body, format="json")
        return fn(url)

    def permission_list_url(self):
        return reverse("admin-permission-list")

    def role_list_url(self):
        return reverse("admin-role-list-create")

    def role_detail_url(self, role):
        return reverse("admin-role-detail", kwargs={"pk": role.id})

    def role_permissions_url(self, role):
        return reverse(
            "admin-role-permission-list-create", kwargs={"pk": role.id}
        )

    def role_permission_url(self, role, permission):
        return reverse(
            "admin-role-permission-detail",
            kwargs={"pk": role.id, "permission_id": permission.id},
        )

    def endpoints(self):
        return [
            ("GET", self.permission_list_url(), None),
            ("GET", self.role_list_url(), None),
            ("POST", self.role_list_url(), {"company_id": self.company_a.id, "name": "New Role"}),
            ("GET", self.role_detail_url(self.role_a), None),
            ("PATCH", self.role_detail_url(self.role_a), {"name": "Renamed"}),
            ("GET", self.role_permissions_url(self.role_a), None),
            ("POST", self.role_permissions_url(self.role_a), {"permission_id": self.tenant_permission.id}),
            ("DELETE", self.role_permission_url(self.role_a, self.tenant_permission), None),
        ]


class RoleManagementAuthorizationTests(RoleManagementTestBase):
    def test_anonymous_is_denied_everywhere(self):
        for method, url, body in self.endpoints():
            with self.subTest(method=method, url=url):
                self.assertEqual(
                    self.call(method, url, body).status_code,
                    status.HTTP_401_UNAUTHORIZED,
                )

    def test_tenant_user_is_denied_everywhere(self):
        self.client.force_authenticate(user=self.tenant_user)
        for method, url, body in self.endpoints():
            with self.subTest(method=method, url=url):
                self.assertEqual(
                    self.call(method, url, body).status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_tenant_user_with_all_tenant_permissions_is_denied(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        self.client.force_authenticate(user=self.tenant_user)
        for method, url, body in self.endpoints():
            with self.subTest(method=method, url=url):
                self.assertEqual(
                    self.call(method, url, body).status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_forged_scope_claim_on_tenant_user_is_denied(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        self.client.force_authenticate(
            user=self.tenant_user, token=self.admin_token()
        )
        for method, url, body in self.endpoints():
            with self.subTest(method=method, url=url):
                self.assertEqual(
                    self.call(method, url, body).status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_system_admin_without_required_permission_is_denied(self):
        restricted = make_user(self.platform, email="audit@grm.example")
        self.grant_system_permissions(restricted, "system.audit.read")
        self.assertTrue(is_system_admin(restricted))
        self.authenticate_admin(user=restricted)
        for method, url, body in self.endpoints():
            with self.subTest(method=method, url=url):
                self.assertEqual(
                    self.call(method, url, body).status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_authorized_system_admin_is_allowed(self):
        self.authenticate_admin()
        self.assertEqual(
            self.client.get(self.permission_list_url()).status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.get(self.role_list_url()).status_code, status.HTTP_200_OK
        )


class PermissionCatalogTests(RoleManagementTestBase):
    def test_lists_permissions_with_scopes(self):
        self.authenticate_admin()
        response = self.client.get(self.permission_list_url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = response.json()
        self.assertTrue(rows)
        scopes = {row["scope"] for row in rows}
        self.assertIn(Scope.TENANT, scopes)
        self.assertIn(Scope.SYSTEM, scopes)
        self.assertTrue(all({"id", "code", "description", "scope"} <= set(r) for r in rows))

    def test_filters_by_scope(self):
        self.authenticate_admin()
        tenant_rows = self.client.get(
            self.permission_list_url(), {"scope": "tenant"}
        ).json()
        self.assertTrue(tenant_rows)
        self.assertTrue(all(r["scope"] == "tenant" for r in tenant_rows))

        system_rows = self.client.get(
            self.permission_list_url(), {"scope": "system"}
        ).json()
        self.assertTrue(system_rows)
        self.assertTrue(all(r["scope"] == "system" for r in system_rows))

    def test_invalid_scope_filter_is_rejected(self):
        self.authenticate_admin()
        response = self.client.get(
            self.permission_list_url(), {"scope": "bogus"}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_no_credentials_returned(self):
        self.authenticate_admin()
        rows = self.client.get(self.permission_list_url()).json()
        for row in rows:
            for forbidden in ("password", "mfa_secret_encrypted"):
                self.assertNotIn(forbidden, row)


class RoleListTests(RoleManagementTestBase):
    def test_lists_all_scopes(self):
        self.authenticate_admin()
        rows = {row["id"]: row for row in self.client.get(self.role_list_url()).json()}

        self.assertEqual(rows[self.role_a.id]["scope"], "tenant")
        self.assertEqual(rows[self.role_a.id]["company_id"], self.company_a.id)
        self.assertEqual(rows[self.role_a.id]["company_name"], self.company_a.display_name)

        self.assertIsNone(rows[self.global_template.id]["company_id"])
        self.assertEqual(rows[self.global_template.id]["scope"], "tenant")

        self.assertEqual(rows[self.system_role.id]["scope"], "system")
        self.assertIsNone(rows[self.system_role.id]["company_id"])

    def test_permission_count_is_reported(self):
        self.role_a.permissions.add(self.tenant_permission, self.tenant_permission2)
        self.authenticate_admin()
        rows = {row["id"]: row for row in self.client.get(self.role_list_url()).json()}
        self.assertEqual(rows[self.role_a.id]["permission_count"], 2)

    def test_filters_by_scope_and_company(self):
        self.authenticate_admin()
        tenant_rows = self.client.get(
            self.role_list_url(), {"scope": "tenant"}
        ).json()
        self.assertTrue(all(r["scope"] == "tenant" for r in tenant_rows))

        company_rows = self.client.get(
            self.role_list_url(), {"company_id": self.company_a.id}
        ).json()
        self.assertEqual(
            {r["id"] for r in company_rows}, {self.role_a.id, self.role_a2.id}
        )

    def test_invalid_company_filter_is_rejected(self):
        self.authenticate_admin()
        response = self.client.get(self.role_list_url(), {"company_id": "abc"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class RoleDetailTests(RoleManagementTestBase):
    def test_tenant_role_detail(self):
        self.role_a.permissions.add(self.tenant_permission)
        self.authenticate_admin()
        data = self.client.get(self.role_detail_url(self.role_a)).json()

        self.assertEqual(data["scope"], "tenant")
        self.assertEqual(data["company_id"], self.company_a.id)
        self.assertEqual([p["id"] for p in data["permissions"]], [self.tenant_permission.id])
        available = {p["id"] for p in data["available_permissions"]}
        self.assertIn(self.tenant_permission2.id, available)
        self.assertNotIn(self.tenant_permission.id, available)

    def test_system_role_detail_has_no_available_permissions(self):
        self.authenticate_admin()
        data = self.client.get(self.role_detail_url(self.system_role)).json()
        self.assertEqual(data["scope"], "system")
        self.assertEqual(data["available_permissions"], [])

    def test_unknown_role_is_404(self):
        self.authenticate_admin()
        self.assertEqual(
            self.client.get(
                reverse("admin-role-detail", kwargs={"pk": 10**9})
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )


class RoleCreateTests(RoleManagementTestBase):
    def test_creates_tenant_role_for_company(self):
        self.authenticate_admin()
        response = self.client.post(
            self.role_list_url(),
            {"company_id": self.company_a.id, "name": "Accountant"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertEqual(data["scope"], "tenant")
        self.assertEqual(data["company_id"], self.company_a.id)

        role = Role.objects.get(pk=data["id"])
        self.assertEqual(role.scope, Scope.TENANT)
        self.assertEqual(role.company_id, self.company_a.id)
        self.assertEqual(role.permissions.count(), 0)

        log = AuditLog.objects.get(action="role.create", entity_id=role.id)
        self.assertEqual(log.company_id, self.platform.id)
        self.assertEqual(log.user_id, self.admin.id)
        self.assertEqual(log.new_values["target_company_id"], self.company_a.id)

    def test_scope_in_payload_is_ignored_and_role_is_tenant(self):
        self.authenticate_admin()
        response = self.client.post(
            self.role_list_url(),
            {
                "company_id": self.company_a.id,
                "name": "Sneaky",
                "scope": "system",
                "is_platform": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        role = Role.objects.get(pk=response.json()["id"])
        self.assertEqual(role.scope, Scope.TENANT)

    def test_platform_company_is_rejected(self):
        self.authenticate_admin()
        response = self.client.post(
            self.role_list_url(),
            {"company_id": self.platform.id, "name": "Platform Role"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            Role.objects.filter(company=self.platform, name="Platform Role").exists()
        )

    def test_duplicate_company_name_is_rejected(self):
        self.authenticate_admin()
        response = self.client.post(
            self.role_list_url(),
            {"company_id": self.company_a.id, "name": "Manager A"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_name_is_rejected(self):
        self.authenticate_admin()
        response = self.client.post(
            self.role_list_url(), {"company_id": self.company_a.id}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unknown_company_is_rejected(self):
        self.authenticate_admin()
        response = self.client.post(
            self.role_list_url(),
            {"company_id": 10**9, "name": "Ghost"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class RoleUpdateTests(RoleManagementTestBase):
    def test_updates_tenant_role_name_and_audits(self):
        self.authenticate_admin()
        response = self.client.patch(
            self.role_detail_url(self.role_a), {"name": "Senior Manager"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.role_a.refresh_from_db()
        self.assertEqual(self.role_a.name, "Senior Manager")

        log = AuditLog.objects.get(action="role.update", entity_id=self.role_a.id)
        self.assertEqual(log.company_id, self.platform.id)
        self.assertEqual(log.new_values["target_company_id"], self.company_a.id)

    def test_duplicate_name_in_company_is_rejected(self):
        self.authenticate_admin()
        response = self.client.patch(
            self.role_detail_url(self.role_a), {"name": "Viewer A"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_scope_and_company_cannot_be_changed(self):
        self.authenticate_admin()
        response = self.client.patch(
            self.role_detail_url(self.role_a),
            {"name": "Renamed", "scope": "system", "company_id": self.company_b.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.role_a.refresh_from_db()
        self.assertEqual(self.role_a.scope, Scope.TENANT)
        self.assertEqual(self.role_a.company_id, self.company_a.id)

    def test_system_role_cannot_be_updated(self):
        self.authenticate_admin()
        response = self.client.patch(
            self.role_detail_url(self.system_role),
            {"name": "Hacked"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.system_role.refresh_from_db()
        self.assertEqual(self.system_role.name, "System Admin")

    def test_global_tenant_template_name_can_be_updated(self):
        self.authenticate_admin()
        response = self.client.patch(
            self.role_detail_url(self.global_template),
            {"name": "Renamed Template"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.global_template.refresh_from_db()
        self.assertEqual(self.global_template.name, "Renamed Template")


class RolePermissionAssignmentTests(RoleManagementTestBase):
    def test_assign_tenant_permission_and_audit(self):
        self.authenticate_admin()
        response = self.client.post(
            self.role_permissions_url(self.role_a),
            {"permission_id": self.tenant_permission.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            RolePermission.objects.filter(
                role=self.role_a, permission=self.tenant_permission
            ).exists()
        )

        log = AuditLog.objects.get(
            action="role.permission_assign", entity_id=self.role_a.id
        )
        self.assertEqual(log.company_id, self.platform.id)
        self.assertEqual(log.new_values["target_company_id"], self.company_a.id)
        self.assertEqual(log.new_values["permission_id"], self.tenant_permission.id)

    def test_reject_system_permission_for_tenant_role(self):
        self.authenticate_admin()
        response = self.client.post(
            self.role_permissions_url(self.role_a),
            {"permission_id": self.system_permission.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            RolePermission.objects.filter(
                role=self.role_a, permission=self.system_permission
            ).exists()
        )

    def test_reject_mutation_of_system_role(self):
        self.authenticate_admin()
        response = self.client.post(
            self.role_permissions_url(self.system_role),
            {"permission_id": self.tenant_permission.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            RolePermission.objects.filter(
                role=self.system_role, permission=self.tenant_permission
            ).exists()
        )

    def test_list_role_permissions_allowed_for_system_role(self):
        self.authenticate_admin()
        response = self.client.get(self.role_permissions_url(self.system_role))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        codes = {row["code"] for row in response.json()}
        self.assertIn("system.users.manage", codes)

    def test_duplicate_assignment_is_idempotent(self):
        self.authenticate_admin()
        first = self.client.post(
            self.role_permissions_url(self.role_a),
            {"permission_id": self.tenant_permission.id},
            format="json",
        )
        second = self.client.post(
            self.role_permissions_url(self.role_a),
            {"permission_id": self.tenant_permission.id},
            format="json",
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            RolePermission.objects.filter(
                role=self.role_a, permission=self.tenant_permission
            ).count(),
            1,
        )
        self.assertEqual(
            AuditLog.objects.filter(
                action="role.permission_assign", entity_id=self.role_a.id
            ).count(),
            1,
        )

    def test_global_template_can_receive_tenant_permission(self):
        self.authenticate_admin()
        response = self.client.post(
            self.role_permissions_url(self.global_template),
            {"permission_id": self.tenant_permission.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_remove_permission_and_audit(self):
        self.role_a.permissions.add(self.tenant_permission)
        self.authenticate_admin()
        response = self.client.delete(
            self.role_permission_url(self.role_a, self.tenant_permission)
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(
            RolePermission.objects.filter(
                role=self.role_a, permission=self.tenant_permission
            ).exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(
                action="role.permission_remove", entity_id=self.role_a.id
            ).exists()
        )

    def test_remove_unassigned_permission_is_404(self):
        self.authenticate_admin()
        response = self.client.delete(
            self.role_permission_url(self.role_a, self.tenant_permission2)
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_remove_system_permission_from_tenant_role_is_rejected(self):
        self.authenticate_admin()
        response = self.client.delete(
            self.role_permission_url(self.role_a, self.system_permission)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_audit_contains_no_credentials(self):
        self.authenticate_admin()
        self.client.post(
            self.role_permissions_url(self.role_a),
            {"permission_id": self.tenant_permission.id},
            format="json",
        )
        log = AuditLog.objects.get(
            action="role.permission_assign", entity_id=self.role_a.id
        )
        self.assertNotIn("password", log.new_values)
        self.assertNotIn("password_hash", log.new_values)


class RbacScopeIntegrityTests(RoleManagementTestBase):
    def test_database_trigger_rejects_cross_scope_role_permission(self):
        with self.assertRaises((IntegrityError, ProgrammingError)):
            with transaction.atomic():
                RolePermission.objects.create(
                    role=self.role_a, permission=self.system_permission
                )

    def test_role_company_is_immutable_through_api(self):
        self.authenticate_admin()
        self.client.patch(
            self.role_detail_url(self.role_b),
            {"name": "Manager B", "company_id": self.company_a.id},
            format="json",
        )
        self.role_b.refresh_from_db()
        self.assertEqual(self.role_b.company_id, self.company_b.id)
