"""
Phase 4 — System Admin company provisioning and management tests.

Covers the authorization boundary, global list/detail, atomic provisioning of a
tenant + its initial administrator, the restricted update surface, lifecycle
transitions, platform-company protection, and platform audit attribution.
"""

import json
import uuid
from unittest import mock

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
from apps.companies.models import Company
from apps.system_admin.constants import (
    SYSTEM_ADMIN_SCOPE,
    SYSTEM_ADMIN_SCOPE_CLAIM,
    TENANT_ADMIN_ROLE_NAME,
)
from apps.system_admin.provisioning import provision_company
from apps.system_admin.tests.support import (
    make_platform_company,
    make_system_admin,
)

STRONG_PASSWORD = "Str0ng-pass-123!"


def admin_access_token(scope=SYSTEM_ADMIN_SCOPE):
    token = AccessToken()
    if scope is not None:
        token[SYSTEM_ADMIN_SCOPE_CLAIM] = scope
    return token


class CompanyManagementTestBase(APITestCase):
    def setUp(self):
        self.platform = make_platform_company()
        self.admin = make_system_admin(
            company=self.platform, email="root@grm.example"
        )
        self.tenant = make_company()
        self.tenant_user = make_user(self.tenant, email="alice@example.com")

    def authenticate_admin(self, user=None, scope=SYSTEM_ADMIN_SCOPE):
        self.client.force_authenticate(
            user=user or self.admin, token=admin_access_token(scope)
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

    def provision_payload(self, **overrides):
        payload = {
            "legal_name": "Acme LLC",
            "display_name": "Acme",
            "voen": "1234567890",
            "admin_email": "owner@acme.example",
            "admin_first_name": "Owner",
            "admin_last_name": "One",
            "admin_password": STRONG_PASSWORD,
        }
        payload.update(overrides)
        return payload

    def provision(self, payload):
        return self.client.post(
            reverse("admin-company-provision"), payload, format="json"
        )


class CompanyManagementAuthorizationTests(CompanyManagementTestBase):
    def test_anonymous_is_rejected_with_401(self):
        response = self.client.get(reverse("admin-company-list"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_company_user_is_denied(self):
        self.client.force_authenticate(user=self.tenant_user)
        self.assertEqual(
            self.client.get(reverse("admin-company-list")).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_company_user_with_all_tenant_permissions_is_denied(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        self.client.force_authenticate(user=self.tenant_user)

        self.assertEqual(
            self.client.get(reverse("admin-company-list")).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.provision(self.provision_payload()).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertFalse(Company.objects.filter(display_name="Acme").exists())

    def test_forged_admin_claim_on_tenant_user_is_denied(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        self.client.force_authenticate(
            user=self.tenant_user, token=admin_access_token()
        )
        self.assertEqual(
            self.client.get(reverse("admin-company-list")).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_wrong_scope_claim_is_denied(self):
        self.authenticate_admin(scope="tenant")
        self.assertEqual(
            self.client.get(reverse("admin-company-list")).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_system_admin_without_required_permission_is_denied(self):
        restricted = make_user(self.platform, email="audit@grm.example")
        self.grant_system_permissions(restricted, "system.audit.read")
        self.assertTrue(is_system_admin(restricted))

        self.authenticate_admin(user=restricted)
        self.assertEqual(
            self.client.get(reverse("admin-company-list")).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_authorized_system_admin_is_allowed(self):
        self.authenticate_admin()
        self.assertEqual(
            self.client.get(reverse("admin-company-list")).status_code,
            status.HTTP_200_OK,
        )


class CompanyListDetailTests(CompanyManagementTestBase):
    def test_admin_lists_companies_including_the_platform_company(self):
        self.authenticate_admin()
        response = self.client.get(reverse("admin-company-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row["id"] for row in response.json()}
        self.assertIn(self.platform.id, ids)
        self.assertIn(self.tenant.id, ids)

    def test_admin_retrieves_company_detail(self):
        self.authenticate_admin()
        response = self.client.get(
            reverse("admin-company-detail", kwargs={"pk": self.tenant.id})
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["id"], self.tenant.id)
        self.assertEqual(data["display_name"], self.tenant.display_name)
        self.assertIs(data["is_platform"], False)
        for forbidden in ("password", "mfa_secret_encrypted"):
            self.assertNotIn(forbidden, data)

    def test_platform_company_is_flagged_in_detail(self):
        self.authenticate_admin()
        response = self.client.get(
            reverse("admin-company-detail", kwargs={"pk": self.platform.id})
        )
        self.assertIs(response.json()["is_platform"], True)

    def test_tenant_user_cannot_reach_admin_company_api(self):
        self.client.force_authenticate(user=self.tenant_user)
        self.assertEqual(
            self.client.get(reverse("admin-company-list")).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.get(
                reverse("admin-company-detail", kwargs={"pk": self.tenant.id})
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_unknown_company_returns_404(self):
        self.authenticate_admin()
        self.assertEqual(
            self.client.get(
                reverse("admin-company-detail", kwargs={"pk": 10**9})
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )


class CompanyProvisioningTests(CompanyManagementTestBase):
    def test_valid_provisioning_creates_company_user_role_and_never_returns_password(self):
        self.authenticate_admin()
        response = self.provision(self.provision_payload())
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        data = response.json()
        for forbidden in ("admin_password", "password", "mfa_secret_encrypted"):
            self.assertNotIn(forbidden, data)

        company = Company.objects.get(pk=data["id"])
        self.assertEqual(company.display_name, "Acme")
        self.assertFalse(company.is_platform)
        self.assertEqual(company.voen, "1234567890")

        admin_user = User.objects.get(company=company, email="owner@acme.example")
        self.assertTrue(admin_user.check_password(STRONG_PASSWORD))
        self.assertNotEqual(admin_user.password, STRONG_PASSWORD)
        self.assertEqual(admin_user.company_id, company.id)

        role = admin_user.role_assignments.get().role
        self.assertEqual(role.name, TENANT_ADMIN_ROLE_NAME)
        self.assertEqual(role.company_id, company.id)
        self.assertEqual(role.scope, Scope.TENANT)
        self.assertEqual(
            role.permissions.count(),
            Permission.objects.filter(scope=Scope.TENANT).count(),
        )

    def test_provisioning_ignores_is_platform(self):
        self.authenticate_admin()
        response = self.provision(
            self.provision_payload(is_platform=True, status="active")
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        company = Company.objects.get(pk=response.json()["id"])
        self.assertFalse(company.is_platform)
        # Status is not accepted from the client; the model default applies.
        self.assertEqual(company.status, Company.Status.TRIAL)

    def test_provisioning_writes_platform_audit_with_target_and_without_secrets(self):
        self.authenticate_admin()
        response = self.provision(self.provision_payload())
        company = Company.objects.get(pk=response.json()["id"])

        log = AuditLog.objects.get(
            action="company.provision", entity_type="company", entity_id=company.id
        )
        self.assertEqual(log.company_id, self.platform.id)
        self.assertEqual(log.user_id, self.admin.id)
        self.assertEqual(log.new_values["target_company_id"], company.id)
        rendered = json.dumps(log.new_values).lower()
        self.assertNotIn(STRONG_PASSWORD.lower(), rendered)
        self.assertNotIn("password", rendered)

    def test_provisioning_rejects_weak_password(self):
        self.authenticate_admin()
        response = self.provision(self.provision_payload(admin_password="short"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("admin_password", response.json())
        self.assertFalse(Company.objects.filter(display_name="Acme").exists())

    def test_provisioning_requires_company_and_admin_fields(self):
        self.authenticate_admin()
        response = self.provision(
            {"admin_email": "x@example.com", "admin_password": STRONG_PASSWORD}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        body = response.json()
        self.assertIn("legal_name", body)
        self.assertIn("display_name", body)

    def test_provisioning_rejects_invalid_admin_email(self):
        self.authenticate_admin()
        response = self.provision(
            self.provision_payload(admin_email="not-an-email")
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("admin_email", response.json())

    def test_provisioning_rejects_duplicate_voen(self):
        Company.objects.create(
            legal_name="Existing", display_name="Existing", voen="9999999999"
        )
        self.authenticate_admin()
        response = self.provision(self.provision_payload(voen="9999999999"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("voen", response.json())

    def test_provisioning_rolls_back_entirely_on_failure(self):
        with mock.patch(
            "apps.system_admin.provisioning.create_platform_audit_log",
            side_effect=RuntimeError("audit unavailable"),
        ):
            with self.assertRaises(RuntimeError):
                provision_company(
                    company_data={
                        "legal_name": "Rollback LLC",
                        "display_name": "Rollback",
                    },
                    admin_email="rb@acme.example",
                    admin_password=STRONG_PASSWORD,
                    actor=self.admin,
                )

        self.assertFalse(Company.objects.filter(display_name="Rollback").exists())
        self.assertFalse(User.objects.filter(email="rb@acme.example").exists())


class CompanyUpdateTests(CompanyManagementTestBase):
    def test_update_allowed_fields_and_audits(self):
        self.authenticate_admin()
        response = self.client.patch(
            reverse("admin-company-detail", kwargs={"pk": self.tenant.id}),
            {"display_name": "Renamed", "voen": "5555555555"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.display_name, "Renamed")
        self.assertEqual(self.tenant.voen, "5555555555")

        log = AuditLog.objects.get(
            action="company.update", entity_id=self.tenant.id
        )
        self.assertEqual(log.company_id, self.platform.id)
        self.assertEqual(log.user_id, self.admin.id)
        self.assertEqual(log.new_values["target_company_id"], self.tenant.id)
        self.assertEqual(log.new_values["display_name"], "Renamed")

    def test_update_cannot_change_protected_fields(self):
        self.authenticate_admin()
        response = self.client.patch(
            reverse("admin-company-detail", kwargs={"pk": self.tenant.id}),
            {"is_platform": True, "status": "cancelled", "id": 999, "deleted_at": None},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.tenant.refresh_from_db()
        self.assertFalse(self.tenant.is_platform)
        self.assertEqual(self.tenant.status, Company.Status.ACTIVE)
        self.assertIsNone(self.tenant.deleted_at)

    def test_update_rejects_duplicate_voen(self):
        other = make_company()
        other.voen = "7777777777"
        other.save(update_fields=["voen"])

        self.authenticate_admin()
        response = self.client.patch(
            reverse("admin-company-detail", kwargs={"pk": self.tenant.id}),
            {"voen": "7777777777"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("voen", response.json())

    def test_platform_company_cannot_be_updated(self):
        self.authenticate_admin()
        response = self.client.patch(
            reverse("admin-company-detail", kwargs={"pk": self.platform.id}),
            {"display_name": "Hijacked"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.platform.refresh_from_db()
        self.assertEqual(self.platform.display_name, "GRM Platform")

    def test_tenant_user_cannot_update(self):
        self.client.force_authenticate(user=self.tenant_user)
        response = self.client.patch(
            reverse("admin-company-detail", kwargs={"pk": self.tenant.id}),
            {"display_name": "Nope"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.tenant.refresh_from_db()
        self.assertNotEqual(self.tenant.display_name, "Nope")


class CompanyLifecycleTests(CompanyManagementTestBase):
    def test_deactivate_sets_suspended_and_audits(self):
        self.authenticate_admin()
        response = self.client.post(
            reverse("admin-company-deactivate", kwargs={"pk": self.tenant.id})
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.status, Company.Status.SUSPENDED)

        log = AuditLog.objects.get(
            action="company.deactivate", entity_id=self.tenant.id
        )
        self.assertEqual(log.company_id, self.platform.id)
        self.assertEqual(log.new_values["target_company_id"], self.tenant.id)
        self.assertEqual(log.previous_values["status"], Company.Status.ACTIVE)
        self.assertEqual(log.new_values["status"], Company.Status.SUSPENDED)

    def test_activate_sets_active_and_audits(self):
        self.tenant.status = Company.Status.SUSPENDED
        self.tenant.save(update_fields=["status"])

        self.authenticate_admin()
        response = self.client.post(
            reverse("admin-company-activate", kwargs={"pk": self.tenant.id})
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.status, Company.Status.ACTIVE)
        self.assertTrue(
            AuditLog.objects.filter(
                action="company.activate", entity_id=self.tenant.id
            ).exists()
        )

    def test_platform_company_status_cannot_change(self):
        self.authenticate_admin()
        response = self.client.post(
            reverse("admin-company-deactivate", kwargs={"pk": self.platform.id})
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.platform.refresh_from_db()
        self.assertEqual(self.platform.status, Company.Status.ACTIVE)

    def test_tenant_user_cannot_change_status(self):
        self.client.force_authenticate(user=self.tenant_user)
        response = self.client.post(
            reverse("admin-company-deactivate", kwargs={"pk": self.tenant.id})
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_authentication_unaffected_by_suspended_tenant(self):
        self.tenant.status = Company.Status.SUSPENDED
        self.tenant.save(update_fields=["status"])

        self.authenticate_admin()
        self.assertEqual(
            self.client.get(reverse("admin-company-list")).status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.get(reverse("admin-auth-me")).status_code,
            status.HTTP_200_OK,
        )
