"""
Phase 7 — System Admin reference-data administration tests.

Covers the authorization matrix, read operations for every catalog, model-
specific CRUD (including PROTECT-safe deletion), VAT range/overlap validation
and the PostgreSQL exclusion constraint, bank activation, exchange-rate
read-only behavior, and platform audit.

Full 600+ backend suite intentionally NOT run.
"""

import datetime
import uuid
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.urls import reverse
from django.utils import timezone

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.audit_logs.models import AuditLog
from apps.authentication.models import Permission, Role, Scope, UserRole
from apps.authentication.rbac import is_system_admin
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.document_templates.models import DocumentTemplate
from apps.reference_data.models import (
    AddressType,
    Bank,
    Currency,
    DocumentType,
    ExchangeRate,
    VatRate,
)
from apps.system_admin.constants import (
    SYSTEM_ADMIN_SCOPE,
    SYSTEM_ADMIN_SCOPE_CLAIM,
)
from apps.system_admin.tests.support import (
    make_platform_company,
    make_system_admin,
)


class ReferenceDataTestBase(APITestCase):
    def setUp(self):
        self.platform = make_platform_company()
        self.admin = make_system_admin(
            company=self.platform, email="root@grm.example"
        )
        self.tenant_company = make_company()
        self.tenant_user = make_user(
            self.tenant_company, email="alice@a.example"
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

    def url(self, name, **kwargs):
        return reverse(name, kwargs=kwargs)


class ReferenceDataAuthorizationTests(ReferenceDataTestBase):
    def endpoints(self):
        return [
            ("GET", self.url("admin-reference-currency-list-create"), None),
            (
                "POST",
                self.url("admin-reference-currency-list-create"),
                {"code": "GBP", "name": "Pound", "minor_unit": 2},
            ),
            ("GET", self.url("admin-reference-document-type-list-create"), None),
            ("GET", self.url("admin-reference-address-type-list-create"), None),
            ("GET", self.url("admin-reference-vat-rate-list-create"), None),
            ("GET", self.url("admin-reference-bank-list-create"), None),
            ("POST", self.url("admin-reference-bank-list-create"), {"name": "X"}),
            ("GET", self.url("admin-reference-exchange-rate-list"), None),
        ]

    def call(self, method, url, body=None):
        fn = getattr(self.client, method.lower())
        if body is not None:
            return fn(url, body, format="json")
        return fn(url)

    def test_anonymous_is_denied_everywhere(self):
        for method, url, body in self.endpoints():
            with self.subTest(method=method, url=url):
                self.assertEqual(
                    self.call(method, url, body).status_code,
                    status.HTTP_401_UNAUTHORIZED,
                )

    def test_tenant_user_is_denied_everywhere(self):
        self.client.force_authenticate(user=self.tenant_user)
        for method, url, body in self.endpoints():
            with self.subTest(method=method, url=url):
                self.assertEqual(
                    self.call(method, url, body).status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_tenant_user_with_all_tenant_permissions_is_denied(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        self.client.force_authenticate(user=self.tenant_user)
        for method, url, body in self.endpoints():
            with self.subTest(method=method, url=url):
                self.assertEqual(
                    self.call(method, url, body).status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_forged_scope_claim_is_denied(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        self.client.force_authenticate(
            user=self.tenant_user, token=self.admin_token()
        )
        response = self.client.get(self.url("admin-reference-currency-list-create"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_without_permission_is_denied(self):
        restricted = make_user(self.platform, email="audit@grm.example")
        self.grant_system_permissions(restricted, "system.audit.read")
        self.assertTrue(is_system_admin(restricted))
        self.authenticate_admin(user=restricted)
        response = self.client.get(self.url("admin-reference-currency-list-create"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_authorized_admin_is_allowed(self):
        self.authenticate_admin()
        response = self.client.get(self.url("admin-reference-currency-list-create"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class ReferenceDataReadTests(ReferenceDataTestBase):
    def test_currencies_seeded_and_global(self):
        self.authenticate_admin()
        rows = self.client.get(self.url("admin-reference-currency-list-create")).json()
        codes = {row["code"] for row in rows}
        self.assertTrue({"AZN", "USD", "EUR"} <= codes)
        self.assertTrue(all({"id", "code", "name", "minor_unit"} <= set(r) for r in rows))
        self.assertTrue(all("company_id" not in r for r in rows))

    def test_document_types_seeded(self):
        self.authenticate_admin()
        rows = self.client.get(
            self.url("admin-reference-document-type-list-create")
        ).json()
        codes = {row["code"] for row in rows}
        self.assertTrue(
            {
                "consulting_contract",
                "purchase_sale_contract",
                "invoice",
                "handover_certificate",
            }
            <= codes
        )

    def test_address_types_seeded(self):
        self.authenticate_admin()
        rows = self.client.get(
            self.url("admin-reference-address-type-list-create")
        ).json()
        self.assertTrue(rows)
        self.assertTrue(all({"id", "code"} <= set(r) for r in rows))

    def test_vat_rates_and_banks_lists(self):
        self.authenticate_admin()
        self.assertEqual(
            self.client.get(self.url("admin-reference-vat-rate-list-create")).status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.get(self.url("admin-reference-bank-list-create")).status_code,
            status.HTTP_200_OK,
        )

    def test_exchange_rates_is_read_only(self):
        self.authenticate_admin()
        self.assertEqual(
            self.client.get(self.url("admin-reference-exchange-rate-list")).status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.post(
                self.url("admin-reference-exchange-rate-list"), {}, format="json"
            ).status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )


class CurrencyAdminTests(ReferenceDataTestBase):
    def test_create_currency(self):
        self.authenticate_admin()
        response = self.client.post(
            self.url("admin-reference-currency-list-create"),
            {"code": "GBP", "name": "Pound Sterling", "minor_unit": 2},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Currency.objects.filter(code="GBP").exists())
        log = AuditLog.objects.get(action="reference_data.create", entity_type="currency")
        self.assertEqual(log.company_id, self.platform.id)
        self.assertEqual(log.user_id, self.admin.id)
        self.assertNotIn("target_company_id", log.new_values or {})

    def test_duplicate_code_is_rejected(self):
        self.authenticate_admin()
        response = self.client.post(
            self.url("admin-reference-currency-list-create"),
            {"code": "USD", "name": "Dup", "minor_unit": 2},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_minor_unit_is_rejected(self):
        self.authenticate_admin()
        response = self.client.post(
            self.url("admin-reference-currency-list-create"),
            {"code": "XTS", "name": "Test", "minor_unit": 9},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_update_currency(self):
        self.authenticate_admin()
        currency = Currency.objects.get(code="USD")
        response = self.client.patch(
            self.url("admin-reference-currency-detail", pk=currency.pk),
            {"name": "US Dollar (updated)"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        currency.refresh_from_db()
        self.assertEqual(currency.name, "US Dollar (updated)")
        self.assertTrue(
            AuditLog.objects.filter(
                action="reference_data.update", entity_type="currency", entity_id=currency.pk
            ).exists()
        )

    def test_delete_unreferenced_currency(self):
        self.authenticate_admin()
        created = self.client.post(
            self.url("admin-reference-currency-list-create"),
            {"code": "XTS", "name": "Test", "minor_unit": 2},
            format="json",
        ).json()
        response = self.client.delete(
            self.url("admin-reference-currency-detail", pk=created["id"])
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Currency.objects.filter(pk=created["id"]).exists())

    def test_delete_referenced_currency_is_rejected(self):
        azn = Currency.objects.get(code="AZN")
        usd = Currency.objects.get(code="USD")
        ExchangeRate.objects.create(
            from_currency=azn,
            to_currency=usd,
            rate=Decimal("1.7"),
            effective_at=timezone.now(),
        )
        self.authenticate_admin()
        response = self.client.delete(
            self.url("admin-reference-currency-detail", pk=azn.pk)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Currency.objects.filter(pk=azn.pk).exists())


class DocumentTypeAdminTests(ReferenceDataTestBase):
    def test_create_update_delete_unreferenced(self):
        self.authenticate_admin()
        created = self.client.post(
            self.url("admin-reference-document-type-list-create"),
            {"code": "act", "name": "Act"},
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertTrue(DocumentType.objects.filter(code="act").exists())

        created_id = created.json()["id"]
        updated = self.client.patch(
            self.url("admin-reference-document-type-detail", pk=created_id),
            {"name": "Act (updated)"},
            format="json",
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK)

        deleted = self.client.delete(
            self.url("admin-reference-document-type-detail", pk=created_id)
        )
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)

    def test_delete_referenced_document_type_is_rejected(self):
        invoice_type = DocumentType.objects.get(code="invoice")
        DocumentTemplate.objects.create(
            company=self.tenant_company,
            document_type=invoice_type,
            name="Invoice Template",
        )
        self.authenticate_admin()
        response = self.client.delete(
            self.url("admin-reference-document-type-detail", pk=invoice_type.pk)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(DocumentType.objects.filter(pk=invoice_type.pk).exists())

    def test_duplicate_code_is_rejected(self):
        self.authenticate_admin()
        response = self.client.post(
            self.url("admin-reference-document-type-list-create"),
            {"code": "invoice", "name": "Dup"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class AddressTypeAdminTests(ReferenceDataTestBase):
    def test_create_update_delete(self):
        self.authenticate_admin()
        created = self.client.post(
            self.url("admin-reference-address-type-list-create"),
            {"code": "warehouse"},
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        address_type = AddressType.objects.get(code="warehouse")

        updated = self.client.patch(
            self.url("admin-reference-address-type-detail", pk=address_type.pk),
            {"code": "warehouse-2"},
            format="json",
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK)

        deleted = self.client.delete(
            self.url("admin-reference-address-type-detail", pk=address_type.pk)
        )
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(AddressType.objects.filter(pk=address_type.pk).exists())


class VatRateAdminTests(ReferenceDataTestBase):
    def test_create_vat_rate_and_audit(self):
        self.authenticate_admin()
        response = self.client.post(
            self.url("admin-reference-vat-rate-list-create"),
            {
                "name": "Standard VAT",
                "rate_percent": "18.00",
                "valid_from": "2026-01-01",
                "valid_to": "2027-01-01",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(VatRate.objects.filter(name="Standard VAT").exists())
        self.assertTrue(
            AuditLog.objects.filter(
                action="reference_data.create", entity_type="vat_rate"
            ).exists()
        )

    def test_invalid_range_is_rejected(self):
        self.authenticate_admin()
        response = self.client.post(
            self.url("admin-reference-vat-rate-list-create"),
            {
                "name": "Bad Range",
                "rate_percent": "18.00",
                "valid_from": "2027-01-01",
                "valid_to": "2026-01-01",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("valid_to", response.json())

    def test_invalid_rate_is_rejected(self):
        self.authenticate_admin()
        response = self.client.post(
            self.url("admin-reference-vat-rate-list-create"),
            {
                "name": "Too High",
                "rate_percent": "150.00",
                "valid_from": "2026-01-01",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_overlapping_range_is_rejected(self):
        VatRate.objects.create(
            name="Standard VAT",
            rate_percent=Decimal("18.00"),
            valid_from=datetime.date(2026, 1, 1),
            valid_to=datetime.date(2026, 7, 1),
        )
        self.authenticate_admin()
        response = self.client.post(
            self.url("admin-reference-vat-rate-list-create"),
            {
                "name": "Standard VAT",
                "rate_percent": "20.00",
                "valid_from": "2026-03-01",
                "valid_to": "2026-09-01",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_adjacent_non_overlapping_range_is_allowed(self):
        VatRate.objects.create(
            name="Standard VAT",
            rate_percent=Decimal("18.00"),
            valid_from=datetime.date(2026, 1, 1),
            valid_to=datetime.date(2026, 7, 1),
        )
        self.authenticate_admin()
        response = self.client.post(
            self.url("admin-reference-vat-rate-list-create"),
            {
                "name": "Standard VAT",
                "rate_percent": "20.00",
                "valid_from": "2026-07-01",
                "valid_to": "2027-01-01",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_database_exclusion_constraint_remains_active(self):
        VatRate.objects.create(
            name="DB VAT",
            rate_percent=Decimal("18.00"),
            valid_from=datetime.date(2026, 1, 1),
            valid_to=datetime.date(2026, 7, 1),
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                VatRate.objects.create(
                    name="DB VAT",
                    rate_percent=Decimal("20.00"),
                    valid_from=datetime.date(2026, 3, 1),
                    valid_to=datetime.date(2026, 9, 1),
                )


class BankAdminTests(ReferenceDataTestBase):
    def test_create_and_update_bank(self):
        self.authenticate_admin()
        created = self.client.post(
            self.url("admin-reference-bank-list-create"),
            {"name": "Kapital Bank", "swift_code": "AIIBAZ2X"},
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        bank = Bank.objects.get(name="Kapital Bank")

        updated = self.client.patch(
            self.url("admin-reference-bank-detail", pk=bank.pk),
            {"name": "Kapital Bank OJSC"},
            format="json",
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        bank.refresh_from_db()
        self.assertEqual(bank.name, "Kapital Bank OJSC")

    def test_activate_deactivate(self):
        bank = Bank.objects.create(name="Inactive Bank", is_active=True)
        self.authenticate_admin()
        deactivated = self.client.post(
            self.url("admin-reference-bank-deactivate", pk=bank.pk)
        )
        self.assertEqual(deactivated.status_code, status.HTTP_200_OK)
        bank.refresh_from_db()
        self.assertFalse(bank.is_active)
        self.assertTrue(
            AuditLog.objects.filter(
                action="reference_data.deactivate", entity_type="bank", entity_id=bank.pk
            ).exists()
        )

        activated = self.client.post(
            self.url("admin-reference-bank-activate", pk=bank.pk)
        )
        self.assertEqual(activated.status_code, status.HTTP_200_OK)
        bank.refresh_from_db()
        self.assertTrue(bank.is_active)

    def test_patch_cannot_set_is_active_directly(self):
        bank = Bank.objects.create(name="Stable Bank", is_active=True)
        self.authenticate_admin()
        response = self.client.patch(
            self.url("admin-reference-bank-detail", pk=bank.pk),
            {"name": "Stable Bank", "is_active": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        bank.refresh_from_db()
        self.assertTrue(bank.is_active)

    def test_bank_has_no_delete_endpoint(self):
        bank = Bank.objects.create(name="No Delete Bank")
        self.authenticate_admin()
        response = self.client.delete(
            self.url("admin-reference-bank-detail", pk=bank.pk)
        )
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertTrue(Bank.objects.filter(pk=bank.pk).exists())
