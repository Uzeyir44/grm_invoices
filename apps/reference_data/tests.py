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
        # them. No values are invented.
        for model_class in (Currency, DocumentType, VatRate, Bank):
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
        for name in (
            "reference-bank-list",
            "reference-currency-list",
            "reference-document-type-list",
            "reference-vat-rate-list",
            "reference-exchange-rate-list",
        ):
            response = self.client.get(self.list_url(name))
            self.assertEqual(response.status_code, status.HTTP_200_OK, name)
            self.assertEqual(response.json(), [], name)
        # Nothing was fabricated.
        self.assertEqual(Bank.objects.count(), 0)
        self.assertEqual(Currency.objects.count(), 0)
        self.assertEqual(DocumentType.objects.count(), 0)
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