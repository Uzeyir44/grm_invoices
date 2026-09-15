"""
Phase 5 — System Admin global user management tests.

Covers the authorization boundary, global list/detail, restricted metadata
update, activate/deactivate, tenant-role assignment/removal (with strict
scope/company validation), System Admin account protection, platform audit
attribution, and tenant integrity.
"""

import uuid

from django.urls import reverse

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.audit_logs.models import AuditLog
from apps.authentication.models import (
    Permission,
    Role,
    Scope,
    User,
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


class UserManagementTestBase(APITestCase):
    def setUp(self):
        self.platform = make_platform_company()
        self.admin = make_system_admin(
            company=self.platform, email="root@grm.example"
        )

        self.company_a = make_company()
        self.company_b = make_company()
        self.user_a = make_user(
            self.company_a, email="alice@a.example", first_name="Alice", last_name="A"
        )
        self.user_a2 = make_user(self.company_a, email="anna@a.example")
        self.user_b = make_user(self.company_b, email="bob@b.example")

        self.role_a = Role.objects.create(
            company=self.company_a, name="Manager A", scope=Scope.TENANT
        )
        self.role_a2 = Role.objects.create(
            company=self.company_a, name="Viewer A", scope=Scope.TENANT
        )
        self.role_b = Role.objects.create(
            company=self.company_b, name="Manager B", scope=Scope.TENANT
        )
        self.system_role = Role.objects.get(name="System Admin", scope=Scope.SYSTEM)

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

    def list_url(self):
        return reverse("admin-user-list")

    def company_choices_url(self):
        return reverse("admin-user-company-choices")

    def detail_url(self, user):
        return reverse("admin-user-detail", kwargs={"pk": user.id})

    def activate_url(self, user):
        return reverse("admin-user-activate", kwargs={"pk": user.id})

    def deactivate_url(self, user):
        return reverse("admin-user-deactivate", kwargs={"pk": user.id})

    def roles_url(self, user):
        return reverse("admin-user-role-list-create", kwargs={"pk": user.id})

    def role_url(self, user, role):
        return reverse(
            "admin-user-role-detail",
            kwargs={"pk": user.id, "role_id": role.id},
        )


class UserManagementAuthorizationTests(UserManagementTestBase):
    def test_anonymous_is_rejected_with_401(self):
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_tenant_user_is_denied(self):
        self.client.force_authenticate(user=self.user_a)
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_tenant_user_with_all_tenant_permissions_is_denied(self):
        self.grant_all_tenant_permissions(self.user_a)
        self.client.force_authenticate(user=self.user_a)
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_forged_scope_claim_on_tenant_user_is_denied(self):
        self.grant_all_tenant_permissions(self.user_a)
        self.client.force_authenticate(user=self.user_a, token=self.admin_token())
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_wrong_scope_claim_is_denied(self):
        self.authenticate_admin(scope="tenant")
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_system_admin_without_required_permission_is_denied(self):
        restricted = make_user(self.platform, email="audit@grm.example")
        self.grant_system_permissions(restricted, "system.audit.read")
        self.assertTrue(is_system_admin(restricted))

        self.authenticate_admin(user=restricted)
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_authorized_system_admin_is_allowed(self):
        self.authenticate_admin()
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_200_OK,
        )

    def test_anonymous_cannot_create_user(self):
        response = self.client.post(
            self.list_url(), {"company_id": self.company_a.id}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_tenant_user_cannot_create_user(self):
        self.client.force_authenticate(user=self.user_a)
        response = self.client.post(
            self.list_url(), {"company_id": self.company_a.id}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class UserListTests(UserManagementTestBase):
    def test_lists_users_across_companies(self):
        self.authenticate_admin()
        response = self.client.get(self.list_url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row["id"] for row in response.json()}
        self.assertIn(self.user_a.id, ids)
        self.assertIn(self.user_a2.id, ids)
        self.assertIn(self.user_b.id, ids)

    def test_excludes_system_admin_accounts(self):
        self.authenticate_admin()
        rows = self.client.get(self.list_url()).json()
        ids = {row["id"] for row in rows}
        self.assertNotIn(self.admin.id, ids)
        self.assertTrue(
            all(row["company_id"] != self.platform.id for row in rows),
            "platform-company users must never appear in tenant user management",
        )

    def test_company_information_is_correct(self):
        self.authenticate_admin()
        rows = {row["id"]: row for row in self.client.get(self.list_url()).json()}
        row = rows[self.user_a.id]
        self.assertEqual(row["company_id"], self.company_a.id)
        self.assertEqual(row["company_name"], self.company_a.display_name)
        self.assertEqual(row["email"], "alice@a.example")

    def test_credentials_are_never_returned(self):
        self.authenticate_admin()
        rows = self.client.get(self.list_url()).json()
        self.assertTrue(rows)
        for row in rows:
            for forbidden in ("password", "mfa_secret_encrypted", "mfa_enabled"):
                self.assertNotIn(forbidden, row)


class UserCreationTests(UserManagementTestBase):
    def create_payload(self, **overrides):
        payload = {
            "company_id": self.company_a.id,
            "email": "new@a.example",
            "first_name": "New",
            "last_name": "User",
            "password": "Str0ng-pass-123!",
            "role_ids": [self.role_a.id],
        }
        payload.update(overrides)
        return payload

    def test_authorized_admin_creates_tenant_user_and_audits(self):
        self.authenticate_admin()
        response = self.client.post(
            self.list_url(), self.create_payload(), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        user_id = response.json()["id"]
        created = User.objects.get(pk=user_id)
        self.assertEqual(created.company_id, self.company_a.id)
        self.assertTrue(created.check_password("Str0ng-pass-123!"))
        self.assertNotIn("password", response.json())
        self.assertTrue(UserRole.objects.filter(user=created, role=self.role_a).exists())
        audit = AuditLog.objects.get(action="user.create", entity_id=created.id)
        self.assertEqual(audit.new_values["target_company_id"], self.company_a.id)
        self.assertNotIn("password", str(audit.new_values).lower())

    def test_creation_rejects_duplicate_email_in_company(self):
        self.authenticate_admin()
        response = self.client.post(
            self.list_url(),
            self.create_payload(email=self.user_a.email),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", response.json())

    def test_creation_rejects_platform_company(self):
        self.authenticate_admin()
        response = self.client.post(
            self.list_url(), self.create_payload(company_id=self.platform.id), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_creation_rejects_role_from_another_company(self):
        self.authenticate_admin()
        response = self.client.post(
            self.list_url(), self.create_payload(role_ids=[self.role_b.id]), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email="new@a.example").exists())

    def test_company_choices_exclude_platform_and_include_tenant_roles(self):
        self.authenticate_admin()
        response = self.client.get(self.company_choices_url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        choices = {row["id"]: row for row in response.json()}
        self.assertNotIn(self.platform.id, choices)
        self.assertEqual(choices[self.company_a.id]["roles"], [{"id": self.role_a.id, "name": "Manager A"}, {"id": self.role_a2.id, "name": "Viewer A"}])


class UserDetailTests(UserManagementTestBase):
    def test_retrieves_tenant_user_with_roles_and_company(self):
        UserRole.objects.create(user=self.user_a, role=self.role_a)
        self.authenticate_admin()
        response = self.client.get(self.detail_url(self.user_a))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["email"], "alice@a.example")
        self.assertEqual(data["company_id"], self.company_a.id)
        self.assertEqual([r["id"] for r in data["roles"]], [self.role_a.id])
        self.assertEqual(
            {r["id"] for r in data["company_roles"]},
            {self.role_a.id, self.role_a2.id},
        )

    def test_credentials_absent(self):
        self.authenticate_admin()
        data = self.client.get(self.detail_url(self.user_a)).json()
        for forbidden in ("password", "mfa_secret_encrypted", "mfa_enabled"):
            self.assertNotIn(forbidden, data)

    def test_system_admin_detail_is_404(self):
        self.authenticate_admin()
        self.assertEqual(
            self.client.get(self.detail_url(self.admin)).status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_unknown_user_is_404(self):
        self.authenticate_admin()
        self.assertEqual(
            self.client.get(reverse("admin-user-detail", kwargs={"pk": 10**9})).status_code,
            status.HTTP_404_NOT_FOUND,
        )


class UserUpdateTests(UserManagementTestBase):
    def test_updates_allowed_fields_and_audits(self):
        self.authenticate_admin()
        response = self.client.patch(
            self.detail_url(self.user_a),
            {"first_name": "Alicia", "last_name": "Anderson"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user_a.refresh_from_db()
        self.assertEqual(self.user_a.first_name, "Alicia")

        log = AuditLog.objects.get(
            action="user.update", entity_type="user", entity_id=self.user_a.id
        )
        self.assertEqual(log.company_id, self.platform.id)
        self.assertEqual(log.user_id, self.admin.id)
        self.assertEqual(log.new_values["target_company_id"], self.company_a.id)

    def test_duplicate_email_in_same_company_is_rejected(self):
        self.authenticate_admin()
        response = self.client.patch(
            self.detail_url(self.user_a),
            {"email": "anna@a.example"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", response.json())

    def test_same_email_in_another_company_is_allowed(self):
        self.authenticate_admin()
        response = self.client.patch(
            self.detail_url(self.user_a),
            {"email": "bob@b.example"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user_a.refresh_from_db()
        self.assertEqual(self.user_a.email, "bob@b.example")

    def test_company_cannot_be_changed(self):
        self.authenticate_admin()
        response = self.client.patch(
            self.detail_url(self.user_a),
            {"company": self.company_b.id, "company_id": self.company_b.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user_a.refresh_from_db()
        self.assertEqual(self.user_a.company_id, self.company_a.id)

    def test_blank_required_field_is_rejected(self):
        self.authenticate_admin()
        response = self.client.patch(
            self.detail_url(self.user_a), {"first_name": ""}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_system_admin_cannot_be_updated(self):
        self.authenticate_admin()
        response = self.client.patch(
            self.detail_url(self.admin), {"first_name": "Hacked"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.first_name, "Test")


class UserLifecycleTests(UserManagementTestBase):
    def test_deactivate_sets_inactive_and_audits(self):
        self.authenticate_admin()
        response = self.client.post(self.deactivate_url(self.user_a))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user_a.refresh_from_db()
        self.assertFalse(self.user_a.is_active)

        log = AuditLog.objects.get(
            action="user.deactivate", entity_id=self.user_a.id
        )
        self.assertEqual(log.company_id, self.platform.id)
        self.assertEqual(log.new_values["target_company_id"], self.company_a.id)
        self.assertFalse(log.new_values["is_active"])

    def test_activate_sets_active_and_audits(self):
        self.user_a.is_active = False
        self.user_a.save(update_fields=["is_active"])

        self.authenticate_admin()
        response = self.client.post(self.activate_url(self.user_a))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user_a.refresh_from_db()
        self.assertTrue(self.user_a.is_active)
        self.assertTrue(
            AuditLog.objects.filter(
                action="user.activate", entity_id=self.user_a.id
            ).exists()
        )

    def test_system_admin_cannot_be_deactivated(self):
        self.authenticate_admin()
        response = self.client.post(self.deactivate_url(self.admin))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_tenant_user_cannot_change_lifecycle(self):
        self.client.force_authenticate(user=self.user_a)
        self.assertEqual(
            self.client.post(self.deactivate_url(self.user_b)).status_code,
            status.HTTP_403_FORBIDDEN,
        )


class UserRoleAssignmentTests(UserManagementTestBase):
    def test_list_roles_is_empty_initially(self):
        self.authenticate_admin()
        self.assertEqual(self.client.get(self.roles_url(self.user_a)).json(), [])

    def test_assign_tenant_role_and_audit(self):
        self.authenticate_admin()
        response = self.client.post(
            self.roles_url(self.user_a), {"role_id": self.role_a.id}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            UserRole.objects.filter(user=self.user_a, role=self.role_a).exists()
        )

        log = AuditLog.objects.get(
            action="user.role_assign", entity_id=self.user_a.id
        )
        self.assertEqual(log.company_id, self.platform.id)
        self.assertEqual(log.new_values["target_company_id"], self.company_a.id)
        self.assertEqual(log.new_values["role_id"], self.role_a.id)

    def test_reject_system_role(self):
        self.authenticate_admin()
        response = self.client.post(
            self.roles_url(self.user_a),
            {"role_id": self.system_role.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            UserRole.objects.filter(user=self.user_a, role=self.system_role).exists()
        )

    def test_reject_another_company_role(self):
        self.authenticate_admin()
        response = self.client.post(
            self.roles_url(self.user_a), {"role_id": self.role_b.id}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            UserRole.objects.filter(user=self.user_a, role=self.role_b).exists()
        )

    def test_reject_global_tenant_role(self):
        global_role = Role.objects.create(
            name=f"Global {uuid.uuid4().hex[:8]}", company=None, scope=Scope.TENANT
        )
        self.authenticate_admin()
        response = self.client.post(
            self.roles_url(self.user_a), {"role_id": global_role.id}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_assignment_to_system_admin_account(self):
        self.authenticate_admin()
        response = self.client.post(
            self.roles_url(self.admin), {"role_id": self.role_a.id}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_assignment_is_idempotent_and_unique(self):
        self.authenticate_admin()
        first = self.client.post(
            self.roles_url(self.user_a), {"role_id": self.role_a.id}, format="json"
        )
        second = self.client.post(
            self.roles_url(self.user_a), {"role_id": self.role_a.id}, format="json"
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            UserRole.objects.filter(user=self.user_a, role=self.role_a).count(), 1
        )
        # Only the actual change is audited.
        self.assertEqual(
            AuditLog.objects.filter(
                action="user.role_assign", entity_id=self.user_a.id
            ).count(),
            1,
        )

    def test_remove_tenant_role_and_audit(self):
        UserRole.objects.create(user=self.user_a, role=self.role_a)
        self.authenticate_admin()
        response = self.client.delete(self.role_url(self.user_a, self.role_a))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(
            UserRole.objects.filter(user=self.user_a, role=self.role_a).exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(
                action="user.role_remove", entity_id=self.user_a.id
            ).exists()
        )

    def test_remove_unassigned_role_is_404(self):
        self.authenticate_admin()
        response = self.client.delete(self.role_url(self.user_a, self.role_a2))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_remove_another_company_role_is_rejected(self):
        UserRole.objects.create(user=self.user_a, role=self.role_a)
        self.authenticate_admin()
        response = self.client.delete(self.role_url(self.user_a, self.role_b))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_tenant_user_cannot_manage_roles(self):
        self.client.force_authenticate(user=self.user_a)
        self.assertEqual(
            self.client.get(self.roles_url(self.user_b)).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_role_audit_contains_no_credentials(self):
        self.authenticate_admin()
        self.client.post(
            self.roles_url(self.user_a), {"role_id": self.role_a.id}, format="json"
        )
        log = AuditLog.objects.get(
            action="user.role_assign", entity_id=self.user_a.id
        )
        self.assertNotIn("password", log.new_values)
        self.assertNotIn("password_hash", log.new_values)
