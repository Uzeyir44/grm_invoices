"""
Phase 8 — System Admin platform audit API tests.

Covers authorization, platform-vs-tenant visibility isolation, filters
(including JSONB target_company_id), pagination/ordering, sensitive-data
handling, and read-only enforcement.

Full 600+ backend suite intentionally NOT run.
"""

import json
import uuid
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.audit_logs.models import AuditLog
from apps.audit_logs.services import create_audit_log
from apps.authentication.models import Permission, Role, Scope, UserRole
from apps.authentication.rbac import is_system_admin
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.system_admin.audit import create_platform_audit_log
from apps.system_admin.constants import (
    SYSTEM_ADMIN_SCOPE,
    SYSTEM_ADMIN_SCOPE_CLAIM,
)
from apps.system_admin.tests.support import (
    make_platform_company,
    make_system_admin,
)


class AuditManagementTestBase(APITestCase):
    def setUp(self):
        self.platform = make_platform_company()
        self.admin = make_system_admin(
            company=self.platform, email="root@grm.example"
        )
        self.company_a = make_company()
        self.company_b = make_company()
        self.tenant_user = make_user(self.company_a, email="alice@a.example")

        # One tenant audit row (must never appear in the platform API).
        self.tenant_log = create_audit_log(
            company=self.company_a,
            user=self.tenant_user,
            action="client.create",
            entity_type="client",
            entity_id=111,
        )

        # Platform audit rows (written through create_platform_audit_log).
        self.provision_log = create_platform_audit_log(
            user=self.admin,
            action="company.provision",
            entity_type="company",
            entity_id=self.company_a.id,
            target_company=self.company_a,
            new_values={"display_name": "Acme"},
        )
        self.activate_log = create_platform_audit_log(
            user=self.admin,
            action="company.activate",
            entity_type="company",
            entity_id=self.company_b.id,
            target_company=self.company_b,
            new_values={"status": "active"},
        )
        self.reference_log = create_platform_audit_log(
            user=self.admin,
            action="reference_data.create",
            entity_type="currency",
            entity_id=1,
            new_values={"code": "GBP"},
        )

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

    def grant_system_permissions(self, user, *codes):
        role = Role.objects.create(
            name=f"System Role {uuid.uuid4().hex[:8]}",
            company=None,
            scope=Scope.SYSTEM,
        )
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code, scope=Scope.SYSTEM))
        UserRole.objects.create(user=user, role=role)

    def list_url(self):
        return reverse("admin-audit-log-list")

    def get_list(self, params=None):
        return self.client.get(self.list_url(), params or {})


class AuditAuthorizationTests(AuditManagementTestBase):
    def test_anonymous_is_rejected(self):
        self.assertEqual(
            self.get_list().status_code, status.HTTP_401_UNAUTHORIZED
        )

    def test_tenant_user_is_denied(self):
        self.client.force_authenticate(user=self.tenant_user)
        self.assertEqual(
            self.get_list().status_code, status.HTTP_403_FORBIDDEN
        )

    def test_tenant_user_with_all_tenant_permissions_is_denied(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        self.client.force_authenticate(user=self.tenant_user)
        self.assertEqual(
            self.get_list().status_code, status.HTTP_403_FORBIDDEN
        )

    def test_forged_scope_claim_is_denied(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        self.client.force_authenticate(
            user=self.tenant_user, token=self.admin_token()
        )
        self.assertEqual(
            self.get_list().status_code, status.HTTP_403_FORBIDDEN
        )

    def test_admin_without_audit_permission_is_denied(self):
        restricted = make_user(self.platform, email="ops@grm.example")
        self.grant_system_permissions(restricted, "system.companies.manage")
        self.assertTrue(is_system_admin(restricted))
        self.authenticate_admin(user=restricted)
        self.assertEqual(
            self.get_list().status_code, status.HTTP_403_FORBIDDEN
        )

    def test_authorized_admin_is_allowed(self):
        self.authenticate_admin()
        self.assertEqual(self.get_list().status_code, status.HTTP_200_OK)


class AuditVisibilityTests(AuditManagementTestBase):
    def test_returns_platform_audit_only(self):
        self.authenticate_admin()
        body = self.get_list().json()
        ids = {row["id"] for row in body["results"]}
        self.assertIn(self.provision_log.id, ids)
        self.assertIn(self.activate_log.id, ids)
        self.assertIn(self.reference_log.id, ids)
        # The tenant audit row is never exposed here.
        self.assertNotIn(self.tenant_log.id, ids)

    def test_all_rows_are_the_platform_company(self):
        self.authenticate_admin()
        rows = self.get_list().json()["results"]
        self.assertTrue(rows)
        self.assertTrue(all(row["company_id"] == self.platform.id for row in rows))

    def test_target_company_id_and_name_are_exposed(self):
        self.authenticate_admin()
        rows = {row["id"]: row for row in self.get_list().json()["results"]}
        provision = rows[self.provision_log.id]
        self.assertEqual(provision["target_company_id"], self.company_a.id)
        self.assertEqual(provision["target_company_name"], self.company_a.display_name)
        # A global reference-data event has no target company.
        reference = rows[self.reference_log.id]
        self.assertIsNone(reference["target_company_id"])
        self.assertIsNone(reference["target_company_name"])

    def test_user_name_is_resolved(self):
        self.authenticate_admin()
        rows = {row["id"]: row for row in self.get_list().json()["results"]}
        self.assertEqual(rows[self.provision_log.id]["user_id"], self.admin.id)
        self.assertTrue(rows[self.provision_log.id]["user_name"])


class AuditFilterTests(AuditManagementTestBase):
    def setUp(self):
        super().setUp()
        self.authenticate_admin()

    def test_filter_by_action(self):
        body = self.get_list({"action": "company.provision"}).json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["action"], "company.provision")

    def test_filter_by_entity_type(self):
        body = self.get_list({"entity_type": "currency"}).json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["entity_type"], "currency")

    def test_filter_by_entity_id(self):
        body = self.get_list({"entity_id": self.company_b.id}).json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["action"], "company.activate")

    def test_filter_by_user_id(self):
        self.assertEqual(
            self.get_list({"user_id": self.admin.id}).json()["count"], 3
        )
        # The tenant user's audit row is not part of the platform dataset.
        self.assertEqual(
            self.get_list({"user_id": self.tenant_user.id}).json()["count"], 0
        )

    def test_filter_by_target_company_id(self):
        body = self.get_list({"target_company_id": self.company_a.id}).json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["id"], self.provision_log.id)

    def test_filter_by_nonexistent_target_company(self):
        body = self.get_list({"target_company_id": 10**9}).json()
        self.assertEqual(body["count"], 0)

    def test_filter_by_time_bounds(self):
        future = (timezone.now() + timedelta(days=1)).isoformat()
        past = (timezone.now() - timedelta(days=1)).isoformat()
        self.assertEqual(self.get_list({"created_after": future}).json()["count"], 0)
        self.assertEqual(self.get_list({"created_before": past}).json()["count"], 0)

    def test_invalid_filter_values_are_rejected(self):
        self.assertEqual(
            self.get_list({"entity_id": "abc"}).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            self.get_list({"target_company_id": "abc"}).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            self.get_list({"created_after": "not-a-date"}).status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    def test_created_after_later_than_created_before_is_rejected(self):
        now = timezone.now()
        response = self.get_list(
            {
                "created_after": (now + timedelta(days=1)).isoformat(),
                "created_before": now.isoformat(),
            }
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class AuditPaginationTests(AuditManagementTestBase):
    def test_pagination_ordering_and_no_duplicates(self):
        # A uniquely-actioned dataset so pagination is scoped to exactly these
        # rows (audit rows are immutable, so they cannot be cleared first).
        for index in range(60):
            create_platform_audit_log(
                user=self.admin,
                action="pagination.test",
                entity_type="currency",
                entity_id=index,
                new_values={"index": index},
            )
        self.authenticate_admin()

        first = self.get_list({"action": "pagination.test", "page_size": 10}).json()
        self.assertEqual(first["count"], 60)
        self.assertEqual(len(first["results"]), 10)
        self.assertIsNotNone(first["next"])

        second = self.get_list(
            {"action": "pagination.test", "page_size": 10, "page": 2}
        ).json()
        self.assertEqual(len(second["results"]), 10)

        first_ids = [row["id"] for row in first["results"]]
        second_ids = [row["id"] for row in second["results"]]
        self.assertEqual(set(first_ids) & set(second_ids), set())

        # Newest-first with a deterministic id tiebreak.
        self.assertEqual(first_ids, sorted(first_ids, reverse=True))

    def test_out_of_range_page_is_404(self):
        self.authenticate_admin()
        self.assertEqual(
            self.get_list({"page": 9999}).status_code,
            status.HTTP_404_NOT_FOUND,
        )


class AuditSensitiveDataTests(AuditManagementTestBase):
    def test_sensitive_values_are_redacted_and_not_exposed(self):
        create_platform_audit_log(
            user=self.admin,
            action="reference_data.create",
            entity_type="currency",
            entity_id=2,
            new_values={"password": "hunter2", "mfa_secret": "abc", "name": "Safe"},
        )
        self.authenticate_admin()
        response = self.get_list({"action": "reference_data.create"})
        content = json.dumps(response.json())
        self.assertNotIn("hunter2", content)
        self.assertNotIn('"abc"', content)

        row = next(
            r for r in response.json()["results"] if r["entity_id"] == 2
        )
        self.assertEqual(row["new_values"]["password"], "[REDACTED]")
        self.assertEqual(row["new_values"]["mfa_secret"], "[REDACTED]")
        self.assertEqual(row["new_values"]["name"], "Safe")

    def test_no_credential_fields_in_response(self):
        self.authenticate_admin()
        rows = self.get_list().json()["results"]
        forbidden = (
            "password",
            "password_hash",
            "mfa_secret_encrypted",
            "access_token",
            "refresh_token",
        )
        for row in rows:
            for field in forbidden:
                self.assertNotIn(field, row)


class AuditReadOnlyTests(AuditManagementTestBase):
    def setUp(self):
        super().setUp()
        self.authenticate_admin()

    def test_list_path_has_no_write_methods(self):
        for method in ("post", "patch", "put"):
            response = getattr(self.client, method)(self.list_url(), {}, format="json")
            self.assertEqual(
                response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED
            )
        self.assertEqual(
            self.client.delete(self.list_url()).status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def test_no_detail_endpoint(self):
        url = reverse("admin-audit-log-list") + f"{self.provision_log.id}/"
        self.assertEqual(
            self.client.get(url).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_audit_records_remain_immutable(self):
        from django.db import ProgrammingError, transaction

        log = AuditLog.objects.get(pk=self.provision_log.id)
        log.action = "tampered"
        with self.assertRaises(ProgrammingError):
            with transaction.atomic():
                log.save(update_fields=["action"])
