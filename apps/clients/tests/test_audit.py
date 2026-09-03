"""
Step 5.2 integration tests: client operations produce audit events (create /
update / deactivate), with correct company, acting user, payloads, and no
events for failed operations.
"""

import uuid
from unittest import mock

from django.db import IntegrityError
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.audit_logs.models import AuditLog
from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.clients.models import ClientLegalEntity

ALL_PERMS = ("clients.read", "clients.create", "clients.update", "clients.delete")


class ClientAuditTestCase(APITestCase):
    def setUp(self):
        self.company = make_company()
        self.user = make_user(self.company, email="alice@example.com")
        self.grant(self.user, *ALL_PERMS)
        self.auth(self.user)

    def grant(self, user, *codes):
        role = Role.objects.create(name=f"R{uuid.uuid4().hex[:8]}", company=None)
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code))
        UserRole.objects.create(user=user, role=role)

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def legal_payload(self, legal_name="Acme Ltd", voen="1234567890"):
        return {
            "client_type": "legal_entity",
            "legal_entity": {"legal_name": legal_name, "voen": voen},
        }

    def create_client(self, **overrides):
        response = self.client.post(
            reverse("client-list-create"), self.legal_payload(**overrides), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return response.json()


class ClientCreateAuditTests(ClientAuditTestCase):
    def test_client_create_records_one_audit_event(self):
        created = self.create_client(legal_name="Acme Ltd")
        events = AuditLog.objects.filter(entity_type="client", entity_id=created["id"])
        self.assertEqual(events.count(), 1)
        event = events.get()
        self.assertEqual(event.action, "create")
        self.assertEqual(event.company_id, self.company.id)
        self.assertEqual(event.user_id, self.user.id)
        self.assertIsNone(event.previous_values)
        self.assertEqual(event.new_values["name"], "Acme Ltd")
        self.assertEqual(event.new_values["client_type"], "legal_entity")
        self.assertEqual(event.new_values["status"], created["status"])
        self.assertEqual(event.ip_address, "127.0.0.1")

    def test_client_create_lists_only_changed_company_user(self):
        created = self.create_client()
        event = AuditLog.objects.filter(entity_type="client", entity_id=created["id"]).get()
        self.assertEqual(event.company, self.company)
        self.assertEqual(event.user, self.user)
        self.assertEqual(event.company_id, event.user.company_id)


class ClientUpdateAuditTests(ClientAuditTestCase):
    def setUp(self):
        super().setUp()
        self.client_id = self.create_client()["id"]

    def test_client_update_records_diff(self):
        response = self.client.patch(
            reverse("client-detail", kwargs={"pk": self.client_id}),
            {"legal_entity": {"legal_name": "Acme LLC"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        events = AuditLog.objects.filter(entity_type="client", entity_id=self.client_id)
        self.assertEqual(events.count(), 2)  # create + update
        event = events.order_by("created_at").last()
        self.assertEqual(event.action, "update")
        self.assertEqual(event.company_id, self.company.id)
        self.assertEqual(event.user_id, self.user.id)
        self.assertEqual(event.previous_values, {"name": "Acme Ltd"})
        self.assertEqual(event.new_values, {"name": "Acme LLC"})

    def test_failed_client_update_records_no_event(self):
        before = AuditLog.objects.count()
        response = self.client.patch(
            reverse("client-detail", kwargs={"pk": self.client_id}),
            {"client_type": "individual"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(AuditLog.objects.count(), before)

    def test_noop_client_update_records_no_event(self):
        before = AuditLog.objects.count()
        response = self.client.patch(
            reverse("client-detail", kwargs={"pk": self.client_id}),
            {"legal_entity": {"legal_name": "Acme Ltd"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Unchanged fields must not be logged.
        self.assertEqual(AuditLog.objects.count(), before)

    def test_client_update_db_failure_records_no_event(self):
        before = AuditLog.objects.count()
        with mock.patch(
            "apps.clients.api.serializers.ClientSerializer.save",
            side_effect=IntegrityError("boom"),
        ):
            response = self.client.patch(
                reverse("client-detail", kwargs={"pk": self.client_id}),
                {"legal_entity": {"legal_name": "Acme LLC"}},
                format="json",
            )
        # The clients base view maps DB integrity conflicts to 400; a failed
        # update must never leave an audit event behind.
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(AuditLog.objects.count(), before)


class ClientDeactivateAuditTests(ClientAuditTestCase):
    def test_client_delete_is_deactivate_event(self):
        client_id = self.create_client()["id"]
        response = self.client.delete(reverse("client-detail", kwargs={"pk": client_id}))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        events = AuditLog.objects.filter(entity_type="client", entity_id=client_id)
        self.assertEqual(events.count(), 2)
        event = events.order_by("created_at").last()
        self.assertEqual(event.action, "deactivate")
        self.assertEqual(event.previous_values["name"], "Acme Ltd")
        self.assertIsNone(event.new_values)
        self.assertEqual(event.company_id, self.company.id)
        self.assertEqual(event.user_id, self.user.id)


class ClientFailedCreateAuditTests(ClientAuditTestCase):
    def test_failed_client_create_records_no_event(self):
        before = AuditLog.objects.count()
        response = self.client.post(
            reverse("client-list-create"),
            {"client_type": "legal_entity"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(AuditLog.objects.count(), before)


class ClientTenantAuditTests(ClientAuditTestCase):
    def test_events_are_scoped_to_the_operating_company(self):
        company_b = make_company()
        user_b = make_user(company_b, email="carol@example.com")
        self.grant(user_b, *ALL_PERMS)
        self.auth(user_b)

        response = self.client.post(
            reverse("client-list-create"), self.legal_payload(legal_name="Acme B"),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        event = AuditLog.objects.filter(entity_type="client").get(
            new_values__name="Acme B"
        )
        self.assertEqual(event.company_id, company_b.id)
        self.assertEqual(event.user_id, user_b.id)
        ClientLegalEntity.objects.filter(company=company_b).delete()