"""
Focused API-throttling tests for the expensive generated-document operations
(document creation, DOCX generation, PDF generation).

Proves the real endpoint boundary: requests above each configured rate return
HTTP 429, the expensive operation is not invoked for throttled requests,
tenant isolation is unaffected, and the request/resource limits still work.
"""

import uuid
from unittest import mock

from django.core.cache import cache
from django.core.files.base import ContentFile
from django.test import override_settings
from django.urls import reverse

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle

from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.clients.models import Client, ClientLegalEntity
from apps.document_templates.models import DocumentTemplate, TemplateVersion
from apps.generated_documents.models import GeneratedDocument, GeneratedDocumentVersion
from apps.generated_documents.services.document_creation import DocumentCreationError
from apps.generated_documents.services.generator import GenerationError
from apps.reference_data.models import Currency, DocumentType

ALL_PERMS = ("generated_documents.read", "generated_documents.generate")


class GeneratedDocumentThrottlingTestCase(APITestCase):
    def setUp(self):
        self.company_a = make_company()
        self.company_b = make_company()
        self.alice = make_user(self.company_a, email="alice@example.com")
        self.carol = make_user(self.company_b, email="carol@example.com")
        self.document_type, _ = DocumentType.objects.get_or_create(
            code="invoice", defaults={"name": "Invoice"}
        )
        self.currency = Currency.objects.get_or_create(code="AZN", name="Manat")[0]
        self.template_a, self.template_version_a = self._make_template(self.company_a)
        self.template_b, _ = self._make_template(self.company_b)
        self.client_a = self._make_client(self.company_a, "Acme A")
        self.client_b = self._make_client(self.company_b, "Acme B")
        self.doc_a = self._make_document(
            self.company_a, self.client_a, self.template_a, "INV-A"
        )
        self.doc_b = self._make_document(
            self.company_b, self.client_b, self.template_b, "INV-B"
        )
        self.version_a = GeneratedDocumentVersion.objects.create(
            generated_document=self.doc_a,
            company=self.company_a,
            version_number=1,
            template_version=self.template_version_a,
            currency=self.currency,
            generation_snapshot={},
            storage_path_docx="irrelevant.docx",
        )
        self.grant(self.alice, *ALL_PERMS)
        self.grant(self.carol, *ALL_PERMS)
        self.auth(self.alice)
        cache.clear()

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

    def _make_document(self, company, client, template, number):
        return GeneratedDocument.objects.create(
            company=company,
            client=client,
            document_type=self.document_type,
            template=template,
            document_number=number,
        )

    def grant(self, user, *codes):
        role = Role.objects.create(name=f"R{uuid.uuid4().hex[:8]}", company=None)
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code))
        UserRole.objects.create(user=user, role=role)

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def create_url(self):
        return reverse("generated-document-list")

    def generate_url(self, document_id):
        return reverse("generated-document-generate", kwargs={"pk": document_id})

    def pdf_url(self, version_id):
        return reverse(
            "generated-document-version-generate-pdf",
            kwargs={"version_id": version_id},
        )

    def create_payload(self, item_count=0):
        return {
            "client_id": self.client_a.id,
            "document_type_id": self.document_type.id,
            "currency_id": self.currency.id,
            "items": [
                {
                    "description": f"Item {i}",
                    "quantity": "1",
                    "unit_price": "10.00",
                    "vat_rate_percent": "18",
                }
                for i in range(item_count)
            ],
        }


class DocumentCreationThrottlingTests(GeneratedDocumentThrottlingTestCase):
    def test_creation_within_rate_succeeds(self):
        for _ in range(2):
            response = self.client.post(
                self.create_url(), self.create_payload(), format="json"
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_creation_exceeding_rate_returns_429_without_work(self):
        calls = []

        def fake_create(*args, **kwargs):
            calls.append(True)
            raise DocumentCreationError("stop")

        with mock.patch(
            "apps.generated_documents.api.views.create_generated_document",
            side_effect=fake_create,
        ):
            with mock.patch.object(
                SimpleRateThrottle,
                "THROTTLE_RATES",
                {"document_creation": "2/hour"},
            ):
                for _ in range(2):
                    response = self.client.post(
                        self.create_url(), self.create_payload(), format="json"
                    )
                    self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                throttled = self.client.post(
                    self.create_url(), self.create_payload(), format="json"
                )

        self.assertEqual(
            throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS
        )
        # Creation ran for the allowed requests but never for the throttled one.
        self.assertEqual(len(calls), 2)

    def test_creation_list_is_not_throttled(self):
        with mock.patch.object(
            SimpleRateThrottle,
            "THROTTLE_RATES",
            {"document_creation": "1/hour"},
        ):
            # A GET list request must not consume/exceed the create bucket.
            for _ in range(3):
                response = self.client.get(self.create_url())
            self.assertEqual(response.status_code, status.HTTP_200_OK)


class DocumentGenerationThrottlingTests(GeneratedDocumentThrottlingTestCase):
    def test_generate_within_rate_succeeds(self):
        with mock.patch(
            "apps.generated_documents.api.views.generate_document",
            return_value=self.version_a,
        ):
            with mock.patch.object(
                SimpleRateThrottle,
                "THROTTLE_RATES",
                {"document_generation": "5/hour"},
            ):
                for _ in range(2):
                    response = self.client.post(self.generate_url(self.doc_a.id))
                    self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_generate_exceeding_rate_returns_429_without_generation(self):
        calls = []

        def fake_generate(*args, **kwargs):
            calls.append(True)
            raise GenerationError("stop")

        with mock.patch(
            "apps.generated_documents.api.views.generate_document",
            side_effect=fake_generate,
        ):
            with mock.patch.object(
                SimpleRateThrottle,
                "THROTTLE_RATES",
                {"document_generation": "2/hour"},
            ):
                for _ in range(2):
                    response = self.client.post(self.generate_url(self.doc_a.id))
                    self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                throttled = self.client.post(self.generate_url(self.doc_a.id))

        self.assertEqual(
            throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS
        )
        self.assertEqual(len(calls), 2)


class PdfGenerationThrottlingTests(GeneratedDocumentThrottlingTestCase):
    def test_pdf_within_rate_succeeds(self):
        with mock.patch(
            "apps.generated_documents.api.views.generate_pdf",
            return_value=self.version_a,
        ):
            with mock.patch.object(
                SimpleRateThrottle,
                "THROTTLE_RATES",
                {"pdf_generation": "5/hour"},
            ):
                for _ in range(2):
                    response = self.client.post(self.pdf_url(self.version_a.id))
                    self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_pdf_exceeding_rate_returns_429(self):
        with mock.patch(
            "apps.generated_documents.api.views.generate_pdf",
            return_value=self.version_a,
        ):
            with mock.patch.object(
                SimpleRateThrottle,
                "THROTTLE_RATES",
                {"pdf_generation": "2/hour"},
            ):
                for _ in range(2):
                    response = self.client.post(self.pdf_url(self.version_a.id))
                    self.assertEqual(response.status_code, status.HTTP_200_OK)
                throttled = self.client.post(self.pdf_url(self.version_a.id))

        self.assertEqual(
            throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS
        )


class ThrottlingIsolationTests(GeneratedDocumentThrottlingTestCase):
    def test_cross_company_generation_stays_blocked(self):
        # Alice cannot generate a Company-B document: tenant check returns 404
        # and throttling does not turn it into any other outcome.
        response = self.client.post(self.generate_url(self.doc_b.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_throttle_buckets_are_per_user(self):
        # Alice is throttled, but Bob (company A) keeps an independent bucket.
        bob = make_user(self.company_a, email="bob@example.com")
        self.grant(bob, *ALL_PERMS)

        with mock.patch(
            "apps.generated_documents.api.views.generate_document",
            return_value=self.version_a,
        ):
            with mock.patch.object(
                SimpleRateThrottle,
                "THROTTLE_RATES",
                {"document_generation": "1/hour"},
            ):
                first = self.client.post(self.generate_url(self.doc_a.id))
                self.assertEqual(first.status_code, status.HTTP_201_CREATED)
                throttled_alice = self.client.post(self.generate_url(self.doc_a.id))
                self.assertEqual(
                    throttled_alice.status_code, status.HTTP_429_TOO_MANY_REQUESTS
                )

            # Bob has his own bucket, unaffected by Alice's exhaustion.
            self.auth(bob)
            response = self.client.post(self.generate_url(self.doc_a.id))
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)


class ThrottlingRequestLimitTests(GeneratedDocumentThrottlingTestCase):
    @override_settings(MAX_DOCUMENT_LINE_ITEMS=3)
    def test_line_item_limit_still_rejects_oversized_create(self):
        with mock.patch(
            "apps.generated_documents.api.views.create_generated_document"
        ) as create:
            response = self.client.post(
                self.create_url(), self.create_payload(item_count=4), format="json"
            )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("items", response.json())
        create.assert_not_called()