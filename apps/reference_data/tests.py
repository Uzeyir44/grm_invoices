"""
Reference Data Step 6.1 focused tests: model/app structure and schema
verification only.

Verifies that all six reference-data models exist in the registered app with
the expected database table names, shared (non-tenant) ownership, correct
relationships to the domains that reference them, and the expected unique
constraints / exclusion constraint / indexes. Business behavior, seeding, APIs,
and integrations belong to later steps.
"""

import uuid
from datetime import date
from decimal import Decimal

from django.apps import apps
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.clients.models import Client, ClientLegalEntity
from apps.reference_data.models import (
    AddressType,
    Bank,
    Currency,
    DocumentType,
    ExchangeRate,
    VatRate,
)

ALL_MODELS = (AddressType, Bank, Currency, DocumentType, ExchangeRate, VatRate)


class ReferenceDataAppTests(SimpleTestCase):
    def test_app_is_registered(self):
        app_config = apps.get_app_config("reference_data")
        self.assertEqual(app_config.name, "apps.reference_data")
        self.assertEqual(app_config.label, "reference_data")

    def test_all_six_models_exist(self):
        for model_class in ALL_MODELS:
            self.assertIs(
                apps.get_model("reference_data", model_class.__name__),
                model_class,
                f"{model_class.__name__} should be registered in reference_data",
            )

    def test_expected_database_table_names(self):
        expected = {
            AddressType: "address_types",
            Bank: "banks",
            Currency: "currencies",
            DocumentType: "document_types",
            ExchangeRate: "exchange_rates",
            VatRate: "vat_rates",
        }
        for model_class, table in expected.items():
            self.assertEqual(model_class._meta.db_table, table)

    def test_no_duplicate_models(self):
        app_models = [
            m for m in apps.get_models() if m._meta.app_label == "reference_data"
        ]
        self.assertEqual(len(app_models), 6)
        tables = [m._meta.db_table for m in app_models]
        self.assertEqual(len(tables), len(set(tables)), "duplicate db_table names")

    def test_models_are_shared_not_tenant_owned(self):
        for model_class in ALL_MODELS:
            field_names = {f.name for f in model_class._meta.get_fields()}
            self.assertNotIn(
                "company", field_names, f"{model_class.__name__} must not be tenant-owned"
            )

    def test_expected_unique_codes(self):
        for model_class, field_name in (
            (AddressType, "code"),
            (Currency, "code"),
            (DocumentType, "code"),
        ):
            self.assertTrue(model_class._meta.get_field(field_name).unique)


class ReferenceDataRelationshipsTests(SimpleTestCase):
    def test_exchange_rate_references_currency(self):
        self.assertEqual(
            ExchangeRate._meta.get_field("from_currency").remote_field.model, Currency
        )
        self.assertEqual(
            ExchangeRate._meta.get_field("to_currency").remote_field.model, Currency
        )

    def test_client_models_reference_shared_reference_data(self):
        from apps.clients.models import ClientAddress, ClientBankAccount

        self.assertEqual(
            ClientAddress._meta.get_field("address_type").remote_field.model,
            AddressType,
        )
        self.assertEqual(
            ClientBankAccount._meta.get_field("bank").remote_field.model, Bank
        )
        self.assertEqual(
            ClientBankAccount._meta.get_field("currency").remote_field.model, Currency
        )

    def test_templates_and_documents_reference_shared_reference_data(self):
        from apps.document_templates.models import DocumentTemplate
        from apps.generated_documents.models import (
            DocumentLineItem,
            GeneratedDocument,
            GeneratedDocumentVersion,
        )

        self.assertEqual(
            DocumentTemplate._meta.get_field("document_type").remote_field.model,
            DocumentType,
        )
        self.assertEqual(
            GeneratedDocument._meta.get_field("document_type").remote_field.model,
            DocumentType,
        )
        self.assertEqual(
            GeneratedDocumentVersion._meta.get_field("currency").remote_field.model,
            Currency,
        )
        self.assertEqual(
            DocumentLineItem._meta.get_field("currency").remote_field.model, Currency
        )


class ReferenceDataConstraintsTests(SimpleTestCase):
    def test_vat_rate_exclusion_constraint_present(self):
        names = {c.name for c in VatRate._meta.constraints}
        self.assertIn("no_overlapping_vat_periods", names)

    def test_exchange_rate_index_present(self):
        index_names = {i.name for i in ExchangeRate._meta.indexes}
        self.assertIn("ix_exchange_rates_pair_time", index_names)

    def test_exchange_rate_index_fields(self):
        index = next(
            i for i in ExchangeRate._meta.indexes if i.name == "ix_exchange_rates_pair_time"
        )
        self.assertEqual(index.fields, ["from_currency", "to_currency", "effective_at"])


class SeedCatalogTests(TestCase):
    """
    Step 6.2 seed/catalog verification.

    The test database is built from the full migration history, so these tests
    exercise the canonical data migrations as they run on a clean database.
    """

    def test_address_types_are_seeded(self):
        codes = set(AddressType.objects.values_list("code", flat=True))
        self.assertEqual(codes, {"legal", "business", "residential"})

    def test_address_type_codes_are_unique(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                AddressType.objects.create(code="legal")
        self.assertEqual(AddressType.objects.filter(code="legal").count(), 1)

    def test_catalogs_without_canonical_definitions_are_not_seeded(self):
        # No authoritative canonical values are defined (yet) for these
        # catalogs, so a migration-built database must contain no rows for
        # them. No values are invented. (Document types do have canonical
        # values — see 0003_seed_document_types and SeededDocumentTypeTests.)
        for model_class in (Currency, VatRate, Bank):
            self.assertEqual(
                model_class.objects.count(),
                0,
                f"{model_class.__name__} must not be seeded until canonical data is defined",
            )

    def test_exchange_rate_is_not_auto_populated(self):
        # ExchangeRate is dynamic operational data; Step 6.2 must not populate
        # it automatically (external/provider integration is deferred).
        self.assertEqual(ExchangeRate.objects.count(), 0)

    def test_vat_rate_exclusion_constraint_rejects_overlap(self):
        # Back-to-back half-open periods are non-overlapping (valid_to is the
        # first day NOT covered) and must be accepted.
        VatRate.objects.create(
            name="AZ VAT",
            rate_percent=Decimal("18.00"),
            valid_from=date(2024, 1, 1),
            valid_to=date(2024, 6, 1),
        )
        VatRate.objects.create(
            name="AZ VAT",
            rate_percent=Decimal("20.00"),
            valid_from=date(2024, 6, 1),
            valid_to=None,
        )
        # A period overlapping either existing range is rejected by the still
        # active no_overlapping_vat_periods constraint.
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                VatRate.objects.create(
                    name="AZ VAT",
                    rate_percent=Decimal("22.00"),
                    valid_from=date(2024, 3, 1),
                    valid_to=None,
                )
        self.assertEqual(VatRate.objects.count(), 2)


class ReferenceDataApiTestCase(APITestCase):
    READ = ("reference_data.read",)

    CATALOG_URL_NAMES = (
        "reference-address-type-list",
        "reference-bank-list",
        "reference-currency-list",
        "reference-document-type-list",
        "reference-vat-rate-list",
        "reference-exchange-rate-list",
    )

    def setUp(self):
        self.company = make_company()
        self.user = make_user(self.company, email="alice@example.com")
        self.other_company = make_company()
        self.other_user = make_user(self.other_company, email="carol@example.com")

    def grant(self, user, *codes):
        role = Role.objects.create(name=f"R{uuid.uuid4().hex[:8]}", company=None)
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code))
        UserRole.objects.create(user=user, role=role)

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def deauth(self):
        self.client.force_authenticate(user=None)

    def list_url(self, name):
        return reverse(name)

    def get_catalog(self, name, query=None):
        url = self.list_url(name)
        if query:
            url += f"?{query}"
        return self.client.get(url)


class ReferenceDataAuthenticationTests(ReferenceDataApiTestCase):
    def test_unauthenticated_request_is_denied(self):
        self.deauth()
        response = self.client.get(self.list_url("reference-address-type-list"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_authenticated_user_without_permission_is_denied(self):
        self.auth(self.user)
        for name in self.CATALOG_URL_NAMES:
            response = self.client.get(self.list_url(name))
            self.assertEqual(
                response.status_code, status.HTTP_403_FORBIDDEN, name
            )

    def test_authenticated_user_with_permission_can_read_all_catalogs(self):
        self.grant(self.user, *self.READ)
        self.auth(self.user)
        for name in self.CATALOG_URL_NAMES:
            response = self.client.get(self.list_url(name))
            self.assertEqual(response.status_code, status.HTTP_200_OK, name)


class ReferenceDataCatalogTests(ReferenceDataApiTestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.user, *self.READ)
        self.auth(self.user)

    def test_seeded_address_types_are_returned(self):
        response = self.client.get(self.list_url("reference-address-type-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        codes = {row["code"] for row in response.json()}
        self.assertEqual(codes, {"legal", "business", "residential"})

    def test_address_types_are_ordered_by_code(self):
        response = self.client.get(self.list_url("reference-address-type-list"))
        rows = response.json()
        self.assertEqual(
            [row["code"] for row in rows],
            sorted(row["code"] for row in rows),
        )

    def test_currently_unseeded_catalogs_return_empty_without_fabricating_data(self):
        # Document types are seeded (0003_seed_document_types) and covered by
        # SeededDocumentTypeTests below; the remaining catalogs are still
        # unseeded and must return an empty list without fabricating data.
        for name in (
            "reference-bank-list",
            "reference-currency-list",
            "reference-vat-rate-list",
            "reference-exchange-rate-list",
        ):
            response = self.client.get(self.list_url(name))
            self.assertEqual(response.status_code, status.HTTP_200_OK, name)
            self.assertEqual(response.json(), [], name)
        # Nothing was fabricated.
        self.assertEqual(Bank.objects.count(), 0)
        self.assertEqual(Currency.objects.count(), 0)
        self.assertEqual(VatRate.objects.count(), 0)
        self.assertEqual(ExchangeRate.objects.count(), 0)

    def test_serializer_exposes_only_intended_fields(self):
        response = self.client.get(self.list_url("reference-address-type-list"))
        row = response.json()[0]
        self.assertEqual(set(row.keys()), {"id", "code"})

    def test_exchange_rate_serializer_is_safe(self):
        # Even when populated later, the serializer must only expose compact
        # currency IDs and rate/time fields.
        serializer_fields = {
            "id",
            "from_currency_id",
            "to_currency_id",
            "rate",
            "effective_at",
        }
        from apps.reference_data.api.serializers import ExchangeRateSerializer

        declared = set(ExchangeRateSerializer.Meta.fields)
        self.assertEqual(declared, serializer_fields)


class SeededDocumentTypeTests(ReferenceDataApiTestCase):
    """
    Coverage for the 0003_seed_document_types data migration: the document
    type catalog is seeded (unlike the other catalogs), shared across
    companies, ordered by code, and the migration is idempotent with a
    reverse that removes only the seeded rows.
    """

    SEEDED = {
        "consulting_contract": "Consulting Contract",
        "purchase_sale_contract": "Purchase/Sale Contract",
        "invoice": "Invoice",
        "handover_certificate": "Handover Certificate",
    }

    def setUp(self):
        super().setUp()
        self.grant(self.user, *self.READ)
        self.grant(self.other_user, *self.READ)

    def test_seeded_document_types_exist_with_exact_names(self):
        rows = {row.code: row.name for row in DocumentType.objects.all()}
        for code, name in self.SEEDED.items():
            self.assertEqual(rows.get(code), name, code)
        self.assertEqual(DocumentType.objects.count(), len(self.SEEDED))

    def test_catalog_endpoint_returns_seeded_types_ordered_by_code(self):
        self.auth(self.user)
        response = self.client.get(self.list_url("reference-document-type-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = response.json()
        self.assertEqual([row["code"] for row in rows], sorted(self.SEEDED))
        self.assertEqual(
            [(row["code"], row["name"]) for row in rows],
            [(code, self.SEEDED[code]) for code in sorted(self.SEEDED)],
        )
        for row in rows:
            self.assertEqual(set(row.keys()), {"id", "code", "name"})

    def test_seeded_catalog_is_shared_across_companies(self):
        self.auth(self.user)
        a_codes = [row["code"] for row in self.client.get(
            self.list_url("reference-document-type-list")
        ).json()]
        self.auth(self.other_user)
        b_codes = [row["code"] for row in self.client.get(
            self.list_url("reference-document-type-list")
        ).json()]
        self.assertEqual(a_codes, b_codes)
        self.assertEqual(a_codes, sorted(self.SEEDED))

    def test_seed_migration_is_idempotent(self):
        from importlib import import_module

        migration = import_module("apps.reference_data.migrations.0003_seed_document_types")
        migration.seed_document_types(apps, None)
        migration.seed_document_types(apps, None)
        self.assertEqual(DocumentType.objects.count(), len(self.SEEDED))
        for code, name in self.SEEDED.items():
            self.assertEqual(DocumentType.objects.get(code=code).name, name)

    def test_reverse_migration_removes_only_seeded_types(self):
        from importlib import import_module

        DocumentType.objects.create(code="contract", name="Contract")
        migration = import_module("apps.reference_data.migrations.0003_seed_document_types")
        migration.unseed_document_types(apps, None)
        remaining = {row.code for row in DocumentType.objects.all()}
        self.assertEqual(remaining, {"contract"})


class ReferenceDataReadOnlyTests(ReferenceDataApiTestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.user, *self.READ)
        self.auth(self.user)

    def test_write_methods_are_rejected(self):
        for name in self.CATALOG_URL_NAMES:
            url = self.list_url(name)
            for method in ("post", "put", "patch", "delete"):
                response = getattr(self.client, method)(url, {}, format="json")
                self.assertEqual(
                    response.status_code,
                    status.HTTP_405_METHOD_NOT_ALLOWED,
                    f"{method.upper()} {name}",
                )


class ReferenceDataGlobalCatalogTests(ReferenceDataApiTestCase):
    def test_users_from_different_companies_read_the_same_shared_catalog(self):
        self.grant(self.user, *self.READ)
        self.grant(self.other_user, *self.READ)

        self.auth(self.user)
        a_codes = {
            row["code"]
            for row in self.client.get(
                self.list_url("reference-address-type-list")
            ).json()
        }
        self.auth(self.other_user)
        b_codes = {
            row["code"]
            for row in self.client.get(
                self.list_url("reference-address-type-list")
            ).json()
        }
        self.assertEqual(a_codes, b_codes)
        self.assertEqual(a_codes, {"legal", "business", "residential"})


class ReferenceDataBusinessValidationTests(APITestCase):
    """
    Step 6.4 integration validation: business objects reference the shared
    reference-data catalogs through real FKs, and invalid/nonexistent
    reference-data IDs are rejected at the API layer.

    Rows used here are test fixtures created through the ORM — they are not
    seed data (Step 6.2's empty-catalog decisions remain authoritative).
    """

    CLIENT_PERMS = ("clients.read", "clients.create", "clients.update")

    def setUp(self):
        self.company_a = make_company()
        self.company_b = make_company()
        self.alice = make_user(self.company_a, email="alice@example.com")
        self.carol = make_user(self.company_b, email="carol@example.com")

        # Shared catalogs: AddressType already has canonical seed rows
        # (legal/business/residential); the other catalogs are currently
        # unseeded, so their rows here are application/test fixtures managed
        # through the ORM — not seed data.
        self.address_type = AddressType.objects.get(code="legal")
        self.bank = Bank.objects.create(name="Test Bank")
        self.currency = Currency.objects.create(code="AZN", name="Manat")
        self.document_type, _ = DocumentType.objects.get_or_create(
            code="invoice", defaults={"name": "Invoice"}
        )

        self.client_a = self._make_client(self.company_a, "Acme A")
        self.client_b = self._make_client(self.company_b, "Acme B")

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

    def address_url(self, client):
        return reverse("client-address-list-create", kwargs={"pk": client.id})

    def bank_account_url(self, client):
        return reverse("client-bank-account-list-create", kwargs={"pk": client.id})


class ValidReferenceTests(ReferenceDataBusinessValidationTests):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *self.CLIENT_PERMS)
        self.auth(self.alice)

    def test_valid_address_type_is_accepted(self):
        response = self.client.post(
            self.address_url(self.client_a),
            {"address_type": self.address_type.id, "line1": "Main St 1"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_valid_bank_and_currency_are_accepted(self):
        response = self.client.post(
            self.bank_account_url(self.client_a),
            {
                "bank": self.bank.id,
                "currency": self.currency.id,
                "iban": "AZ00TEST0000000000000001",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)


class InvalidReferenceTests(ReferenceDataBusinessValidationTests):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *self.CLIENT_PERMS)
        self.auth(self.alice)

    def test_nonexistent_address_type_is_rejected(self):
        response = self.client.post(
            self.address_url(self.client_a),
            {"address_type": 999999, "line1": "Main St 1"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_nonexistent_bank_is_rejected(self):
        response = self.client.post(
            self.bank_account_url(self.client_a),
            {
                "bank": 999999,
                "currency": self.currency.id,
                "iban": "AZ00TEST0000000000000002",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_nonexistent_currency_is_rejected(self):
        response = self.client.post(
            self.bank_account_url(self.client_a),
            {
                "bank": self.bank.id,
                "currency": 999999,
                "iban": "AZ00TEST0000000000000003",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reference_id_from_another_catalog_is_rejected(self):
        # An id that is valid in one catalog (DocumentType) must not be
        # accepted as an AddressType simply because the number exists
        # somewhere in the system.
        DocumentType.objects.create(pk=500, code="contract", name="Contract")
        response = self.client.post(
            self.address_url(self.client_a),
            {"address_type": 500, "line1": "Main St 1"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TenantIntegrationTests(ReferenceDataBusinessValidationTests):
    def test_global_catalog_does_not_bypass_business_tenant_isolation(self):
        self.grant(self.alice, *self.CLIENT_PERMS)
        self.grant(self.carol, *self.CLIENT_PERMS)
        self.auth(self.carol)
        # Carol (Company B) shares the global AddressType catalog but cannot
        # attach an address to Alice's (Company A) client.
        response = self.client.post(
            self.address_url(self.client_a),
            {"address_type": self.address_type.id, "line1": "Hi-jacked"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(
            self.client_a.addresses.filter(line1="Hi-jacked").exists()
        )