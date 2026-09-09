"""
Request/resource-limit tests for the generated-documents API.

Covers:
  * the line-item cap on document create (below / at / above limit), proving
    oversized requests are rejected before generation is invoked;
  * the application-level request-body-size guard (413);
  * that unauthenticated and cross-company requests still behave as before.
"""

import shutil
import tempfile
import uuid
from unittest import mock

from django.core.files.base import ContentFile
from django.test import override_settings
from django.urls import reverse

from rest_framework import status
from rest_framework.test import APITestCase

from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.clients.models import Client, ClientLegalEntity
from apps.document_templates.models import DocumentTemplate, TemplateVersion
from apps.generated_documents.models import GeneratedDocument
from apps.reference_data.models import Currency, DocumentType

TEMP_MEDIA = tempfile.mkdtemp(prefix="grm_limits_tests_")
ALL_PERMS = ("generated_documents.read", "generated_documents.generate")
LIMIT = 5


@override_settings(MEDIA_ROOT=TEMP_MEDIA, MAX_DOCUMENT_LINE_ITEMS=LIMIT)
class GeneratedDocumentRequestLimitTestCase(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TEMP_MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.company_a = make_company()
        self.company_b = make_company()
        self.alice = make_user(self.company_a, email="alice@example.com")
        self.carol = make_user(self.company_b, email="carol@example.com")
        self.document_type, _ = DocumentType.objects.get_or_create(
            code="invoice", defaults={"name": "Invoice"}
        )
        self.currency = Currency.objects.get_or_create(code="AZN", name="Manat")[0]
        self.template_a, _ = self._make_template(self.company_a)
        self.client_a = self._make_client(self.company_a, "Acme A")
        self.client_b = self._make_client(self.company_b, "Acme B")
        self.grant(self.alice, *ALL_PERMS)
        self.grant(self.carol, *ALL_PERMS)
        self.auth(self.alice)

    def _make_template(self, company):
        template = DocumentTemplate.objects.create(
            company=company, document_type=self.document_type, name="Invoice Template"
        )
        version = TemplateVersion.objects.create(
            template=template,
            company=company,
            version_number=1,
            storage_path="v1",
            is_active=True,
        )
        version.file.save("tpl.docx", ContentFile(b"docx"), save=True)
        return template, version

    def _make_client(self, company, legal_name):
        client = Client.objects.create(
            company=company, client_type=Client.ClientType.LEGAL_ENTITY
        )
        ClientLegalEntity.objects.create(
            client=client, company=company, legal_name=legal_name, voen="1234567890"
        )
        return client

    def grant(self, user, *codes):
        role = Role.objects.create(name=f"R{uuid.uuid4().hex[:8]}", company=None)
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code))
        UserRole.objects.create(user=user, role=role)

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def create_url(self):
        return reverse("generated-document-list")

    def item(self, index):
        return {
            "description": f"Item {index}",
            "quantity": "1",
            "unit_price": "10.00",
            "vat_rate_percent": "18",
        }

    def payload(self, item_count):
        return {
            "client_id": self.client_a.id,
            "document_type_id": self.document_type.id,
            "currency_id": self.currency.id,
            "items": [self.item(i) for i in range(item_count)],
        }

    def test_items_below_limit_are_accepted(self):
        response = self.client.post(self.create_url(), self.payload(3), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_items_exactly_at_limit_are_accepted(self):
        response = self.client.post(self.create_url(), self.payload(LIMIT), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_no_items_are_accepted(self):
        response = self.client.post(self.create_url(), self.payload(0), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_items_above_limit_are_rejected_before_generation(self):
        with mock.patch(
            "apps.generated_documents.api.views.create_generated_document"
        ) as create:
            response = self.client.post(
                self.create_url(), self.payload(LIMIT + 1), format="json"
            )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        create.assert_not_called()
        self.assertIn("items", response.json())
        self.assertEqual(GeneratedDocument.objects.count(), 0)

    def test_unauthenticated_create_is_rejected(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(self.create_url(), self.payload(1), format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_cross_company_client_is_rejected_with_404(self):
        payload = self.payload(1)
        payload["client_id"] = self.client_b.id
        with mock.patch(
            "apps.generated_documents.api.views.create_generated_document"
        ) as create:
            response = self.client.post(self.create_url(), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        create.assert_not_called()
        self.assertEqual(GeneratedDocument.objects.count(), 0)

    @override_settings(MAX_REQUEST_BODY_SIZE=1024)
    def test_oversized_request_body_is_rejected_with_413(self):
        big = "x" * 2048
        payload = {
            "client_id": self.client_a.id,
            "document_type_id": self.document_type.id,
            "currency_id": self.currency.id,
            "items": [
                {
                    "description": big,
                    "quantity": "1",
                    "unit_price": "10",
                    "vat_rate_percent": "18",
                }
            ],
        }
        with mock.patch(
            "apps.generated_documents.api.views.create_generated_document"
        ) as create:
            response = self.client.post(self.create_url(), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        create.assert_not_called()
        self.assertEqual(GeneratedDocument.objects.count(), 0)