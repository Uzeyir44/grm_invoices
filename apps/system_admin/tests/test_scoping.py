"""
Scoped-RBAC regression and enforcement tests (System Admin Phase 1).

Covers the structural tenant/system separation: scope on Permission and Role,
the database triggers that refuse mixed-scope role/permission pairs and
system-role assignment to tenant users, and the RBAC resolver's scope filters.
"""

import uuid

from django.db import ProgrammingError, transaction
from django.test import TestCase

from apps.authentication.models import Permission, Role, RolePermission, UserRole
from apps.authentication.rbac import (
    is_system_admin,
    permission_codes_for,
    system_permission_codes_for,
    user_has_permission,
    user_has_system_permission,
)
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.system_admin.tests.support import (
    make_platform_company,
    make_system_admin,
    system_admin_role,
)


class ScopeSeparationTests(TestCase):
    def setUp(self):
        self.tenant = make_company()
        self.tenant_user = make_user(self.tenant, email="alice@example.com")
        self.system_role = system_admin_role()
        self.system_permission = Permission.objects.get(code="system.companies.manage")
        self.tenant_permission = Permission.objects.get(code="clients.read")
        self.tenant_role = Role.objects.create(
            name=f"Reader {uuid.uuid4().hex[:8]}", company=None, scope="tenant"
        )
        self.tenant_role.permissions.add(self.tenant_permission)

    def test_seeded_scopes(self):
        self.assertEqual(self.system_permission.scope, "system")
        self.assertEqual(self.tenant_permission.scope, "tenant")
        self.assertEqual(self.system_role.scope, "system")
        self.assertEqual(self.tenant_role.scope, "tenant")

    def test_all_seeded_system_permissions_are_system_scoped(self):
        codes = [
            "system.companies.manage",
            "system.users.manage",
            "system.roles.manage",
            "system.reference.manage",
            "system.audit.read",
            "system.backups.manage",
            "system.settings.manage",
        ]
        scopes = set(
            Permission.objects.filter(code__in=codes).values_list("scope", flat=True)
        )
        self.assertEqual(scopes, {"system"})

    def test_tenant_role_cannot_hold_system_permission(self):
        with self.assertRaises(ProgrammingError):
            with transaction.atomic():
                RolePermission.objects.create(
                    role=self.tenant_role, permission=self.system_permission
                )

    def test_system_role_cannot_hold_tenant_permission(self):
        with self.assertRaises(ProgrammingError):
            with transaction.atomic():
                RolePermission.objects.create(
                    role=self.system_role, permission=self.tenant_permission
                )

    def test_system_role_cannot_be_assigned_to_tenant_user(self):
        with self.assertRaises(ProgrammingError):
            with transaction.atomic():
                UserRole.objects.create(user=self.tenant_user, role=self.system_role)
        self.assertFalse(is_system_admin(self.tenant_user))

    def test_system_role_can_be_assigned_to_platform_user(self):
        admin = make_system_admin(email="root2@grm.example")
        self.assertTrue(is_system_admin(admin))

    def test_tenant_role_is_not_treated_as_system(self):
        UserRole.objects.create(user=self.tenant_user, role=self.tenant_role)
        self.assertFalse(is_system_admin(self.tenant_user))
        self.assertEqual(system_permission_codes_for(self.tenant_user), frozenset())
        self.assertFalse(
            user_has_system_permission(self.tenant_user, "system.companies.manage")
        )

    def test_system_role_is_not_treated_as_tenant(self):
        admin = make_system_admin(email="root3@grm.example")
        self.assertTrue(is_system_admin(admin))
        # The system role grants no tenant permissions.
        self.assertEqual(permission_codes_for(admin), frozenset())
        self.assertFalse(user_has_permission(admin, "clients.read"))
        # And the tenant role's tenant permission is not resolved as a system one.
        UserRole.objects.create(user=self.tenant_user, role=self.tenant_role)
        self.assertTrue(user_has_permission(self.tenant_user, "clients.read"))
        self.assertFalse(
            user_has_system_permission(self.tenant_user, "clients.read")
        )

    def test_system_admin_detection_requires_role_not_company_membership(self):
        platform = make_platform_company()
        plain_platform_user = make_user(platform, email="plain@grm.example")
        self.assertFalse(is_system_admin(plain_platform_user))

    def test_system_permissions_resolve_for_system_admin(self):
        admin = make_system_admin(email="root4@grm.example")
        codes = system_permission_codes_for(admin)
        self.assertIn("system.companies.manage", codes)
        self.assertIn("system.settings.manage", codes)
        self.assertTrue(
            user_has_system_permission(admin, "system.companies.manage")
        )

    def test_global_tenant_role_still_applies(self):
        # Regression: existing global tenant roles and their permissions work
        # exactly as before the scope field was added.
        UserRole.objects.create(user=self.tenant_user, role=self.tenant_role)
        self.assertIn("clients.read", permission_codes_for(self.tenant_user))
        self.assertTrue(user_has_permission(self.tenant_user, "clients.read"))

    def test_company_specific_tenant_role_still_scoped(self):
        other_company = make_company()
        other_user = make_user(other_company, email="bob@example.com")
        company_role = Role.objects.create(
            name=f"Local {uuid.uuid4().hex[:8]}",
            company=self.tenant,
            scope="tenant",
        )
        company_role.permissions.add(self.tenant_permission)
        UserRole.objects.create(user=self.tenant_user, role=company_role)
        self.assertTrue(user_has_permission(self.tenant_user, "clients.read"))
        self.assertFalse(user_has_permission(other_user, "clients.read"))
