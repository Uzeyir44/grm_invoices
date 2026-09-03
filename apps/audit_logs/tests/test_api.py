"""
Step 5.3 focused tests: audit_logs.read permission + tenant-scoped, read-only
GET /api/audit-logs/ endpoint.
"""

import uuid
from uuid import uuid4

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.audit_logs.models import AuditLog
from apps.audit_logs.services import create_audit_log
from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.tests.test_authentication import make_company, make_user

READ = ("audit_logs.read",)


class AuditLogAPITestCase(APITestCase):
    def setUp(self):
        self.company_a = make_company()
        self.company_b = make_company()
        self.alice = make_user(self.company_a, email="alice@example.com")
        self.bob = make_user(self.company_b, email="bob@example.com")

    def grant(self, user, *codes):
        role = Role.objects.create(name=f"R{uuid.uuid4().hex[:8]}", company=None)
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code))
        UserRole.objects.create(user=user, role=role)

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def deauth(self):
        self.client.force_authenticate(user=None)

    def record(self, company, *, user=None, action="update", **payload):
        return create_audit_log(
            company=company,
            user=user,
            action=action,
            entity_type="client",
            entity_id=payload.pop("entity_id", 1),
            ip_address="10.0.0.1",
            user_agent="TestAgent/1.0",
            **payload,
        )

    def list_url(self):
        return reverse("audit-log-list")


class AuthenticationTests(AuditLogAPITestCase):
    def test_unauthenticated_request_is_denied(self):
        self.deauth()
        response = self.client.get(self.list_url())
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_authenticated_user_without_permission_is_denied(self):
        self.auth(self.alice)
        response = self.client.get(self.list_url())
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_authenticated_user_with_permission_can_access(self):
        self.grant(self.alice, *READ)
        self.auth(self.alice)
        response = self.client.get(self.list_url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class TenantIsolationTests(AuditLogAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *READ)
        self.grant(self.bob, *READ)
        self.event_a = self.record(self.company_a, user=self.alice, entity_id=10)
        self.event_b = self.record(self.company_b, user=self.bob, entity_id=20)

    def test_company_a_sees_only_its_own_logs(self):
        self.auth(self.alice)
        response = self.client.get(self.list_url())
        data = response.json()
        ids = {row["id"] for row in data}
        self.assertEqual(ids, {self.event_a.id})
        self.assertNotIn(self.event_b.id, ids)

    def test_company_b_sees_only_its_own_logs(self):
        self.auth(self.bob)
        response = self.client.get(self.list_url())
        ids = {row["id"] for row in response.json()}
        self.assertEqual(ids, {self.event_b.id})
        self.assertNotIn(self.event_a.id, ids)

    def test_knowing_other_company_id_does_not_expose_its_log(self):
        self.auth(self.alice)
        response = self.client.get(self.list_url())
        data = response.json()
        self.assertTrue(all(row["company_id"] == self.company_a.id for row in data))
        self.assertTrue(all(row["id"] != self.event_b.id for row in data))


class ListingTests(AuditLogAPITestCase):
    def test_newest_records_appear_first(self):
        self.grant(self.alice, *READ)
        self.auth(self.alice)
        self.record(self.company_a, user=self.alice, entity_id=1)
        self.record(self.company_a, user=self.alice, entity_id=2)
        self.record(self.company_a, user=self.alice, entity_id=3)
        response = self.client.get(self.list_url())
        data = response.json()
        ids = [row["id"] for row in data]
        self.assertEqual(ids, sorted(ids, reverse=True))
        self.assertEqual(len(ids), 3)

    def test_serialized_fields_are_correct(self):
        self.grant(self.alice, *READ)
        self.auth(self.alice)
        request_id = uuid4()
        event = self.record(
            self.company_a,
            user=self.alice,
            entity_id=7,
            previous_values={"name": "Old"},
            new_values={"name": "New"},
            request_id=request_id,
            action="update",
        )
        response = self.client.get(self.list_url())
        row = response.json()[0]
        self.assertEqual(row["id"], event.id)
        self.assertEqual(row["company_id"], self.company_a.id)
        self.assertEqual(row["user_id"], self.alice.id)
        self.assertEqual(row["action"], "update")
        self.assertEqual(row["entity_type"], "client")
        self.assertEqual(row["entity_id"], 7)
        self.assertEqual(row["previous_values"], {"name": "Old"})
        self.assertEqual(row["new_values"], {"name": "New"})
        self.assertEqual(row["ip_address"], "10.0.0.1")
        self.assertEqual(row["user_agent"], "TestAgent/1.0")
        self.assertEqual(row["request_id"], str(request_id))
        self.assertIn("created_at", row)

    def test_company_with_no_records_gets_empty_list(self):
        self.grant(self.bob, *READ)
        self.auth(self.bob)
        response = self.client.get(self.list_url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json(), [])


class ReadOnlyTests(AuditLogAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *READ)
        self.auth(self.alice)
        self.record(self.company_a, user=self.alice, entity_id=1)

    def test_write_methods_are_not_supported(self):
        for method in ("post", "put", "patch", "delete"):
            response = getattr(self.client, method)(self.list_url(), {}, format="json")
            self.assertIn(
                response.status_code,
                (status.HTTP_405_METHOD_NOT_ALLOWED, status.HTTP_403_FORBIDDEN),
                f"{method} should not be allowed",
            )

    def test_no_sensitive_fields_are_exposed(self):
        response = self.client.get(self.list_url())
        row = response.json()[0]
        sensitive = ("password", "mfa", "token", "authorization", "secret", "api_key")
        for key in sensitive:
            self.assertNotIn(key, row)


class SensitiveDataTests(AuditLogAPITestCase):
    def test_api_returns_already_redacted_payloads(self):
        self.grant(self.alice, *READ)
        self.auth(self.alice)
        create_audit_log(
            company=self.company_a,
            user=self.alice,
            action="create",
            entity_type="user",
            entity_id=5,
            new_values={
                "password": "hunter2",
                "nested": {"access_token": "tok", "ok": 1},
            },
        )
        response = self.client.get(self.list_url())
        row = response.json()[0]
        self.assertEqual(row["new_values"]["password"], "[REDACTED]")
        self.assertEqual(row["new_values"]["nested"]["access_token"], "[REDACTED]")
        self.assertEqual(row["new_values"]["nested"]["ok"], 1)