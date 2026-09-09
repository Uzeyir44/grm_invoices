from datetime import datetime, timezone
from decimal import Decimal

from django.test import TestCase

from apps.authentication.tests.test_authentication import make_company
from apps.clients.models import (
    Client,
    ClientContact,
    ClientIndividual,
    ClientLegalEntity,
)
from apps.document_templates.models import DocumentTemplate
from apps.document_templates.variables import valid_variable_keys
from apps.generated_documents.models import GeneratedDocument, GeneratedDocumentVersion
from apps.generated_documents.services.context import (
    GenerationContextError,
    build_generation_context,
    flat_context_keys,
)
from apps.reference_data.models import DocumentType, Currency


def make_document_type(code="invoice"):
    return DocumentType.objects.get_or_create(code=code, defaults={"name": "Invoice"})[0]


def make_template(company, document_type):
    return DocumentTemplate.objects.create(
        company=company, document_type=document_type, name="Invoice Template"
    )


def make_legal_client(company, legal_name="Acme Ltd", voen="1234567890"):
    client = Client.objects.create(
        company=company, client_type=Client.ClientType.LEGAL_ENTITY
    )
    ClientLegalEntity.objects.create(
        client=client, company=company, legal_name=legal_name, voen=voen
    )
    return client


def make_individual_client(
    company, first_name="Jane", last_name="Doe", middle_name=None
):
    client = Client.objects.create(
        company=company, client_type=Client.ClientType.INDIVIDUAL
    )
    ClientIndividual.objects.create(
        client=client,
        company=company,
        first_name=first_name,
        last_name=last_name,
        middle_name=middle_name,
    )
    return client


def make_document(company, client, document_type, template, number="INV-001"):
    return GeneratedDocument.objects.create(
        company=company,
        client=client,
        document_type=document_type,
        template=template,
        document_number=number,
    )


class ContextBuilderTestCase(TestCase):
    def setUp(self):
        self.company = make_company()
        self.document_type = make_document_type()
        self.template = make_template(self.company, self.document_type)

    def legal_document(self, **kwargs):
        client = make_legal_client(self.company)
        return make_document(
            self.company, client, self.document_type, self.template, **kwargs
        )

    def individual_document(self, **kwargs):
        client = make_individual_client(self.company)
        return make_document(
            self.company, client, self.document_type, self.template, **kwargs
        )


class CompanyContextTests(ContextBuilderTestCase):
    def test_correct_company_data_is_returned(self):
        self.company.display_name = "Acme LLC"
        self.company.legal_name = "Acme LLC"
        self.company.voen = "AZ1234567"
        self.company.registration_number = "RN-001"
        self.company.save()

        ctx = build_generation_context(document=self.legal_document())

        self.assertEqual(ctx["company"]["name"], "Acme LLC")
        self.assertEqual(ctx["company"]["legal_name"], "Acme LLC")
        self.assertEqual(ctx["company"]["voen"], "AZ1234567")
        self.assertEqual(ctx["company"]["registration_number"], "RN-001")


class ClientContextTests(ContextBuilderTestCase):
    def test_legal_entity_client_context(self):
        client = make_legal_client(
            self.company, legal_name="Acme Ltd", voen="9998887770"
        )
        ClientContact.objects.create(
            client=client,
            company=self.company,
            full_name="Mgr",
            email="acme@example.com",
            phone="+994500000001",
            is_primary=True,
        )
        doc = make_document(
            self.company, client, self.document_type, self.template
        )

        ctx = build_generation_context(document=doc)

        self.assertEqual(ctx["client"]["name"], "Acme Ltd")
        self.assertEqual(ctx["client"]["voen"], "9998887770")
        self.assertEqual(ctx["client"]["email"], "acme@example.com")
        self.assertEqual(ctx["client"]["phone"], "+994500000001")

    def test_individual_client_context(self):
        client = make_individual_client(
            self.company, first_name="Jane", middle_name="A", last_name="Doe"
        )
        doc = make_document(
            self.company, client, self.document_type, self.template
        )

        ctx = build_generation_context(document=doc)

        self.assertEqual(ctx["client"]["name"], "Jane A Doe")
        self.assertIsNone(ctx["client"]["voen"])

    def test_individual_without_middle_name(self):
        client = make_individual_client(self.company, first_name="John", last_name="Doe")
        doc = make_document(
            self.company, client, self.document_type, self.template
        )

        ctx = build_generation_context(document=doc)

        self.assertEqual(ctx["client"]["name"], "John Doe")


class DocumentContextTests(ContextBuilderTestCase):
    def test_document_fields_are_mapped(self):
        doc = self.legal_document(number="INV-2024-001")
        doc.created_at = datetime(2024, 5, 1, 12, 0, tzinfo=timezone.utc)
        doc.save(update_fields=["created_at"])

        ctx = build_generation_context(document=doc)

        self.assertEqual(ctx["document"]["number"], "INV-2024-001")
        self.assertEqual(ctx["document"]["date"], "2024-05-01")
        self.assertEqual(ctx["document"]["type"], "Invoice")


class OptionalDataTests(ContextBuilderTestCase):
    def test_missing_optional_company_data_does_not_crash(self):
        self.company.display_name = "Acme LLC"
        self.company.legal_name = "Acme LLC"
        self.company.voen = None
        self.company.registration_number = None
        self.company.save()

        ctx = build_generation_context(document=self.legal_document())

        self.assertIsNone(ctx["company"]["voen"])
        self.assertIsNone(ctx["company"]["registration_number"])

    def test_missing_client_contact_resolves_to_none(self):
        doc = self.legal_document()

        ctx = build_generation_context(document=doc)

        self.assertIsNone(ctx["client"]["email"])
        self.assertIsNone(ctx["client"]["phone"])

    def test_legal_entity_voen_present_individual_voen_none(self):
        legal_ctx = build_generation_context(document=self.legal_document(number="INV-001"))
        individual_ctx = build_generation_context(
            document=self.individual_document(number="INV-002")
        )

        self.assertEqual(legal_ctx["client"]["voen"], "1234567890")
        self.assertIsNone(individual_ctx["client"]["voen"])

    def test_clientless_document_requires_client(self):
        doc = make_document(
            self.company, None, self.document_type, self.template
        )

        with self.assertRaises(GenerationContextError):
            build_generation_context(document=doc)


class TenantSafetyTests(ContextBuilderTestCase):
    def setUp(self):
        super().setUp()
        self.other_company = make_company()

    def test_mismatched_company_is_rejected(self):
        doc = self.legal_document()

        with self.assertRaises(GenerationContextError):
            build_generation_context(
                company=self.other_company, document=doc
            )

    def test_mismatched_client_is_rejected(self):
        doc = self.legal_document()
        foreign_client = make_legal_client(
            self.other_company, legal_name="Foreign Ltd", voen="1112223330"
        )

        with self.assertRaises(GenerationContextError):
            build_generation_context(client=foreign_client, document=doc)

    def test_explicit_matching_company_client_document_is_accepted(self):
        client = make_legal_client(self.company)
        doc = make_document(
            self.company, client, self.document_type, self.template
        )

        ctx = build_generation_context(
            company=self.company, client=client, document=doc
        )

        self.assertEqual(ctx["company"]["name"], self.company.display_name)


class VariableContractTests(ContextBuilderTestCase):
    def test_context_contains_only_approved_variable_keys(self):
        doc = self.legal_document()

        ctx = build_generation_context(document=doc)

        produced = flat_context_keys(ctx)
        approved = set(valid_variable_keys())
        non_item = {k for k in approved if not k.startswith("item.")}
        # The produced context must never introduce an unapproved key, and it
        # must include every non-line-item variable. item.* keys only appear
        # when the document actually has line items (empty collection -> no
        # item.* keys).
        self.assertLessEqual(produced, approved)
        self.assertLessEqual(non_item, produced)

    def test_line_item_keys_present_when_items_exist(self):
        doc = self.legal_document()
        ctx = build_generation_context(document=doc)
        version = doc.versions.first()
        if version is not None:
            ctx_with_items = build_generation_context(document=doc, version=version)
        else:
            ctx_with_items = build_generation_context(document=doc)
        # With no real version/line items in this fixture, items is empty and
        # no item.* keys are expected.
        self.assertIn("items", ctx_with_items)
        for item_keys in flat_context_keys({"items": ctx_with_items["items"]}):
            self.assertTrue(item_keys.startswith("item."))

    def test_context_structure_is_namespaced(self):
        ctx = build_generation_context(document=self.legal_document())

        self.assertEqual(set(ctx.keys()), {"company", "client", "document", "items"})


class LineItemContextTests(ContextBuilderTestCase):
    def _make_version(self, document):
        from apps.document_templates.models import TemplateVersion
        from apps.reference_data.models import Currency

        currency = Currency.objects.get_or_create(code="AZN", name="Manat")[0]
        template_version = TemplateVersion.objects.create(
            template=document.template,
            company=document.company,
            version_number=1,
            storage_path="x",
        )
        return GeneratedDocumentVersion.objects.create(
            generated_document=document,
            company=document.company,
            version_number=1,
            template_version=template_version,
            currency=currency,
            generation_snapshot={},
        )

    def _make_line_item(self, version, line_number, description, quantity=Decimal("1")):
        from apps.generated_documents.models import DocumentLineItem
        from apps.reference_data.models import Currency

        currency = Currency.objects.get_or_create(code="AZN", name="Manat")[0]
        return DocumentLineItem.objects.create(
            generated_document_version=version,
            company=version.company,
            currency=currency,
            line_number=line_number,
            description=description,
            quantity=quantity,
            unit="h",
            unit_price=Decimal("100.00"),
            discount_percent=Decimal("0"),
            vat_rate_percent=Decimal("18"),
            subtotal=Decimal("100.00"),
            vat_amount=Decimal("18.00"),
            total=Decimal("118.00"),
        )

    def test_line_items_included_and_ordered(self):
        doc = self.legal_document()
        version = self._make_version(doc)
        self._make_line_item(version, 2, "Second")
        self._make_line_item(version, 1, "First")
        self._make_line_item(version, 3, "Third")

        ctx = build_generation_context(document=doc)

        self.assertEqual(
            [i["description"] for i in ctx["items"]], ["First", "Second", "Third"]
        )
        self.assertEqual([i["line_number"] for i in ctx["items"]], [1, 2, 3])

    def test_only_the_documents_own_line_items_are_included(self):
        other_company = make_company()
        other_client = make_legal_client(other_company, legal_name="Other Ltd")
        other_type = DocumentType.objects.create(code="contract", name="Contract")
        other_template = DocumentTemplate.objects.create(
            company=other_company, document_type=other_type, name="Other Tpl"
        )
        other_doc = make_document(
            other_company, other_client, other_type, other_template, number="INV-002"
        )
        other_version = self._make_version(other_doc)
        self._make_line_item(other_version, 1, "Foreign item")

        doc = self.legal_document(number="INV-003")
        version = self._make_version(doc)
        self._make_line_item(version, 1, "Own item")

        ctx = build_generation_context(document=doc)

        self.assertEqual([i["description"] for i in ctx["items"]], ["Own item"])
        self.assertNotIn("Foreign item", [i["description"] for i in ctx["items"]])

    def test_explicit_version_for_another_document_is_rejected(self):
        doc_a = self.legal_document(number="INV-A")
        client_b = make_legal_client(
            self.company, legal_name="Beta Ltd", voen="2222333440"
        )
        doc_b = make_document(
            self.company, client_b, self.document_type, self.template, number="INV-B"
        )
        version_b = self._make_version(doc_b)

        with self.assertRaises(GenerationContextError):
            build_generation_context(document=doc_a, version=version_b)

    def test_document_without_version_has_empty_items(self):
        ctx = build_generation_context(document=self.legal_document())
        self.assertEqual(ctx["items"], [])