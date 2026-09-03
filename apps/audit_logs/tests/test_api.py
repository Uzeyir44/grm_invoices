"""
Step 5.3/5.4 tests: audit_logs.read permission, tenant-scoped read-only
GET /api/audit-logs/, plus filtering, pagination, and ordering.
"""

import uuid
from urllib.parse import urlencode
from uuid import uuid4

from django.utils import timezone
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

    def record(self, company, *, user=None, action="update", entity_type="client", entity_id=1, **payload):
        return create_audit_log(
            company=company,
            user=user,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            ip_address="10.0.0.1",
            user_agent="TestAgent/1.0",
            **payload,
        )

    def list_url(self, **query):
        path = reverse("audit-log-list")
        return path + ("?" + urlencode(query) if query else "")

    def get_list(self, **query):
        response = self.client.get(self.list_url(**query))
        return response

    def results(self, response):
        data = response.json()
        return data["results"]


class AuthenticationTests(AuditLogAPITestCase):
    def test_unauthenticated_request_is_denied(self):
        self.deauth()
        response = self.get_list()
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_authenticated_user_without_permission_is_denied(self):
        self.auth(self.alice)
        response = self.get_list()
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_authenticated_user_with_permission_can_access(self):
        self.grant(self.alice, *READ)
        self.auth(self.alice)
        response = self.get_list()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("count", response.json())
        self.assertIn("results", response.json())


class TenantIsolationTests(AuditLogAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *READ)
        self.grant(self.bob, *READ)
        self.event_a = self.record(self.company_a, user=self.alice, entity_id=10)
        self.event_b = self.record(self.company_b, user=self.bob, entity_id=20)

    def test_company_a_sees_only_its_own_logs(self):
        self.auth(self.alice)
        data = self.get_list().json()
        ids = {row["id"] for row in data["results"]}
        self.assertEqual(ids, {self.event_a.id})
        self.assertNotIn(self.event_b.id, ids)

    def test_company_b_sees_only_its_own_logs(self):
        self.auth(self.bob)
        ids = {row["id"] for row in self.get_list().json()["results"]}
        self.assertEqual(ids, {self.event_b.id})

    def test_entity_id_filter_remains_tenant_scoped(self):
        # Both companies have an entity with the SAME numeric id; only the
        # caller's own company record may surface.
        self.record(self.company_b, user=self.bob, entity_id=10, action="create")
        self.auth(self.alice)
        ids = {row["id"] for row in self.results(self.get_list(entity_id="10"))}
        self.assertEqual(ids, {self.event_a.id})

    def test_user_id_filter_from_other_company_returns_nothing(self):
        self.auth(self.alice)
        ids = [row["id"] for row in self.results(self.get_list(user_id=self.bob.id))]
        self.assertEqual(ids, [])

    def test_action_filter_from_other_company_returns_nothing(self):
        self.record(self.company_b, user=self.bob, action="generate_pdf")
        self.auth(self.alice)
        ids = [row["id"] for row in self.results(self.get_list(action="generate_pdf"))]
        self.assertEqual(ids, [])


class ListingTests(AuditLogAPITestCase):
    def test_newest_first_with_deterministic_order(self):
        self.grant(self.alice, *READ)
        self.auth(self.alice)
        for i in range(5):
            self.record(self.company_a, user=self.alice, entity_id=i)
        expected = list(
            AuditLog.objects.filter(company_id=self.company_a.id)
            .order_by("-created_at", "-id")
            .values_list("id", flat=True)
        )
        seen = [row["id"] for row in self.results(self.get_list())]
        self.assertEqual(seen, expected)

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
        row = self.results(self.get_list())[0]
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

    def test_empty_company_gets_empty_paginated_result(self):
        self.grant(self.bob, *READ)
        self.auth(self.bob)
        data = self.get_list().json()
        self.assertEqual(data["count"], 0)
        self.assertEqual(data["results"], [])


class FilteringTests(AuditLogAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *READ)
        self.auth(self.alice)
        self.create_event = self.record(self.company_a, user=self.alice, action="create", entity_type="client", entity_id=1)
        self.update_event = self.record(self.company_a, user=self.alice, action="update", entity_type="client", entity_id=2)
        self.pdf_event = self.record(self.company_a, user=self.alice, action="generate_pdf", entity_type="generated_document_version", entity_id=3)
        self.template_event = self.record(self.company_a, user=self.alice, action="update", entity_type="document_template", entity_id=4)

    def test_action_filter(self):
        ids = {row["id"] for row in self.results(self.get_list(action="create"))}
        self.assertEqual(ids, {self.create_event.id})
        ids = {row["id"] for row in self.results(self.get_list(action="update"))}
        self.assertEqual(ids, {self.update_event.id, self.template_event.id})
        ids = {row["id"] for row in self.results(self.get_list(action="generate_pdf"))}
        self.assertEqual(ids, {self.pdf_event.id})

    def test_entity_type_filter(self):
        ids = {row["id"] for row in self.results(self.get_list(entity_type="client"))}
        self.assertEqual(ids, {self.create_event.id, self.update_event.id})
        ids = {row["id"] for row in self.results(self.get_list(entity_type="document_template"))}
        self.assertEqual(ids, {self.template_event.id})

    def test_entity_id_filter(self):
        ids = {row["id"] for row in self.results(self.get_list(entity_id="3"))}
        self.assertEqual(ids, {self.pdf_event.id})

    def test_user_id_filter(self):
        ids = {row["id"] for row in self.results(self.get_list(user_id=self.alice.id))}
        self.assertEqual(ids, {
            self.create_event.id, self.update_event.id, self.pdf_event.id, self.template_event.id
        })

    def test_combined_filters(self):
        ids = {row["id"] for row in self.results(
            self.get_list(action="update", entity_type="client", user_id=self.alice.id)
        )}
        self.assertEqual(ids, {self.update_event.id})

    def test_invalid_entity_id_returns_400(self):
        response = self.get_list(entity_id="abc")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_user_id_returns_400(self):
        response = self.get_list(user_id="not-a-number")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_valid_filter_with_no_matches_returns_empty(self):
        data = self.get_list(action="delete").json()
        self.assertEqual(data["count"], 0)
        self.assertEqual(data["results"], [])


class DateFilteringTests(AuditLogAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *READ)
        self.auth(self.alice)
        self.now = timezone.now()
        self.event = self.record(self.company_a, user=self.alice, action="create")

    def test_created_after(self):
        ids = {row["id"] for row in self.results(
            self.get_list(created_after=self.now.isoformat())
        )}
        self.assertIn(self.event.id, ids)

    def test_created_before_future_returns_all(self):
        future = self.now + timezone.timedelta(hours=1)
        data = self.get_list(created_before=future.isoformat()).json()
        self.assertEqual(data["count"], 1)

    def test_created_after_and_before_together(self):
        past = self.now - timezone.timedelta(hours=1)
        future = self.now + timezone.timedelta(hours=1)
        data = self.get_list(
            created_after=past.isoformat(), created_before=future.isoformat()
        ).json()
        self.assertEqual(data["count"], 1)

    def test_invalid_datetime_returns_400(self):
        response = self.get_list(created_after="not-a-date")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        response = self.get_list(created_before="also-not-a-date")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_created_after_later_than_before_returns_400(self):
        past = self.now - timezone.timedelta(hours=1)
        earlier = self.now - timezone.timedelta(hours=2)
        response = self.get_list(created_after=past.isoformat(), created_before=earlier.isoformat())
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class PaginationTests(AuditLogAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *READ)
        self.auth(self.alice)
        for i in range(120):
            self.record(self.company_a, user=self.alice, entity_id=i)

    def test_default_pagination(self):
        data = self.get_list().json()
        self.assertEqual(data["count"], 120)
        self.assertEqual(len(data["results"]), 50)
        self.assertIsNotNone(data["next"])
        self.assertIsNone(data["previous"])

    def test_later_pages(self):
        page2 = self.get_list(page="2").json()
        self.assertEqual(len(page2["results"]), 50)
        self.assertIsNotNone(page2["previous"])
        page3 = self.get_list(page="3").json()
        self.assertEqual(len(page3["results"]), 20)
        self.assertIsNone(page3["next"])

    def test_page_size_and_max_page_size(self):
        sized = self.get_list(page_size="10").json()
        self.assertEqual(len(sized["results"]), 10)
        self.assertEqual(sized["count"], 120)
        # Requested page size above the cap is clamped, not honoured blindly.
        clamped = self.get_list(page_size="10000").json()
        self.assertEqual(len(clamped["results"]), 100)

    def test_page_beyond_end_is_404(self):
        # DRF's PageNumberPagination yields NotFound for an out-of-range page.
        response = self.get_list(page="999")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


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
        row = self.results(self.get_list())[0]
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
        row = self.results(self.get_list())[0]
        self.assertEqual(row["new_values"]["password"], "[REDACTED]")
        self.assertEqual(row["new_values"]["nested"]["access_token"], "[REDACTED]")
        self.assertEqual(row["new_values"]["nested"]["ok"], 1)