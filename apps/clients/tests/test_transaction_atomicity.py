"""
Transaction-atomicity tests for the Client create/update flow.

A client's logical create/update writes the base ``Client`` row plus its
subtype (and an audit event) inside one ``transaction.atomic()`` block. These
tests force a controlled failure *after* the base write has actually been
executed (proven inside the same transaction) and verify that nothing remains
partially committed.
"""

from unittest import mock

from django.db import IntegrityError

from rest_framework import status

from apps.audit_logs.models import AuditLog
from apps.clients.models import (
    Client,
    ClientIndividual,
    ClientLegalEntity,
)
from apps.clients.tests.test_api import ClientAPITestCase

ALL_CLIENT_PERMISSIONS = (
    "clients.read",
    "clients.create",
    "clients.update",
    "clients.delete",
)


class ClientTransactionAtomicityTests(ClientAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *ALL_CLIENT_PERMISSIONS)

    def test_failed_legal_entity_create_leaves_no_partial_client(self):
        def fail_after_base_write(*args, **kwargs):
            # The base Client INSERT has already executed and is visible inside
            # this transaction; the subtype write then fails.
            self.assertTrue(
                Client.objects.filter(
                    company=self.company_a,
                    client_type=Client.ClientType.LEGAL_ENTITY,
                ).exists()
            )
            raise IntegrityError("boom")

        with mock.patch.object(
            ClientLegalEntity, "save", side_effect=fail_after_base_write
        ):
            response = self.create_client(self.alice, self.legal_payload())

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Client.objects.exists())
        self.assertFalse(ClientLegalEntity.objects.exists())
        self.assertFalse(AuditLog.objects.exists())

    def test_failed_individual_create_leaves_no_partial_client(self):
        def fail_after_base_write(*args, **kwargs):
            self.assertTrue(
                Client.objects.filter(
                    company=self.company_a,
                    client_type=Client.ClientType.INDIVIDUAL,
                ).exists()
            )
            raise IntegrityError("boom")

        with mock.patch.object(
            ClientIndividual, "save", side_effect=fail_after_base_write
        ):
            response = self.create_client(self.alice, self.individual_payload())

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Client.objects.exists())
        self.assertFalse(ClientIndividual.objects.exists())
        self.assertFalse(AuditLog.objects.exists())

    def test_failed_update_restores_client_and_subtype_values(self):
        client_id = self.create_client(self.alice, self.legal_payload()).json()["id"]

        def fail_after_base_update(*args, **kwargs):
            # The base Client UPDATE has already executed and is visible inside
            # this transaction; the subtype update then fails.
            self.assertEqual(
                Client.objects.get(pk=client_id).status, Client.Status.INACTIVE
            )
            raise IntegrityError("boom")

        with mock.patch.object(
            ClientLegalEntity, "save", side_effect=fail_after_base_update
        ):
            self.auth(self.alice)
            response = self.client.patch(
                self.client_detail_url(client_id),
                {
                    "status": "inactive",
                    "legal_entity": {"legal_name": "Acme LLC"},
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        client = Client.objects.get(pk=client_id)
        self.assertEqual(client.status, Client.Status.ACTIVE)
        self.assertEqual(
            ClientLegalEntity.objects.get(client_id=client_id).legal_name, "Acme Ltd"
        )

    def test_successful_create_commits_client_and_subtype(self):
        response = self.create_client(self.alice, self.legal_payload())
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        client = Client.objects.get(pk=response.json()["id"])
        self.assertEqual(client.company_id, self.company_a.id)
        self.assertEqual(client.client_type, Client.ClientType.LEGAL_ENTITY)
        subtype = ClientLegalEntity.objects.get(client_id=client.id)
        self.assertEqual(subtype.legal_name, "Acme Ltd")
        self.assertEqual(subtype.voen, "1234567890")

    def test_successful_update_commits_client_and_subtype(self):
        client_id = self.create_client(self.alice, self.legal_payload()).json()["id"]

        self.auth(self.alice)
        response = self.client.patch(
            self.client_detail_url(client_id),
            {
                "status": "inactive",
                "legal_entity": {"legal_name": "Acme LLC"},
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        client = Client.objects.get(pk=client_id)
        self.assertEqual(client.status, Client.Status.INACTIVE)
        self.assertEqual(
            ClientLegalEntity.objects.get(client_id=client_id).legal_name, "Acme LLC"
        )

    def test_cross_company_update_still_blocked(self):
        other = self.make_client_row(self.company_b)
        self.auth(self.alice)
        response = self.client.patch(
            self.client_detail_url(other.id),
            {"status": "inactive"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        refreshed = Client.objects.get(pk=other.id)
        self.assertEqual(refreshed.company_id, self.company_b.id)
        self.assertEqual(refreshed.status, Client.Status.ACTIVE)