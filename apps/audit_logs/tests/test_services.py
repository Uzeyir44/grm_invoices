"""
Focused tests for the Step 5.1 audit event writer (audit_logs.services).

Covers successful creation, tenant safety, sensitive-data redaction, JSON
behavior, request metadata, and transaction participation. It does not test
any business-operation integration (that is Step 5.2).
"""

from decimal import Decimal
from uuid import uuid4

from django.db import transaction
from django.test import TestCase

from apps.audit_logs.models import AuditLog
from apps.audit_logs.services import (
    REDACTED_MARKER,
    AuditLogError,
    AuditTenantMismatchError,
    create_audit_log,
    sanitize_audit_payload,
)
from apps.authentication.tests.test_authentication import make_company, make_user


class CreateAuditLogTests(TestCase):
    def setUp(self):
        self.company = make_company()
        self.user = make_user(self.company, email="auditor@example.com")

    def test_creates_audit_log_with_all_fields(self):
        request_id = uuid4()
        event = create_audit_log(
            company=self.company,
            user=self.user,
            action="client.updated",
            entity_type="client",
            entity_id=42,
            previous_values={"name": "Old"},
            new_values={"name": "New"},
            ip_address="10.0.0.5",
            user_agent="Mozilla/5.0",
            request_id=request_id,
        )
        event.refresh_from_db()
        self.assertEqual(event.company_id, self.company.id)
        self.assertEqual(event.user_id, self.user.id)
        self.assertEqual(event.action, "client.updated")
        self.assertEqual(event.entity_type, "client")
        self.assertEqual(event.entity_id, 42)
        self.assertEqual(event.previous_values, {"name": "Old"})
        self.assertEqual(event.new_values, {"name": "New"})
        self.assertEqual(event.ip_address, "10.0.0.5")
        self.assertEqual(event.user_agent, "Mozilla/5.0")
        self.assertEqual(event.request_id, request_id)

    def test_defaults_for_optional_fields(self):
        event = create_audit_log(
            company=self.company,
            action="document.generated",
            entity_type="generated_document",
            entity_id=7,
        )
        self.assertIsNone(event.user)
        self.assertIsNone(event.previous_values)
        self.assertIsNone(event.new_values)
        self.assertIsNone(event.ip_address)
        self.assertIsNone(event.user_agent)
        self.assertIsNone(event.request_id)

    def test_required_fields_are_enforced(self):
        with self.assertRaises(AuditLogError):
            create_audit_log(
                company=None,
                action="x",
                entity_type="y",
                entity_id=1,
            )
        with self.assertRaises(AuditLogError):
            create_audit_log(company=self.company, action="", entity_type="y", entity_id=1)
        with self.assertRaises(AuditLogError):
            create_audit_log(company=self.company, action="x", entity_type="", entity_id=1)
        with self.assertRaises(AuditLogError):
            create_audit_log(company=self.company, action="x", entity_type="y", entity_id=None)


class TenantSafetyTests(TestCase):
    def test_user_of_company_a_with_company_a_works(self):
        company = make_company()
        user = make_user(company)
        event = create_audit_log(
            company=company, user=user, action="a", entity_type="b", entity_id=1
        )
        self.assertEqual(event.company_id, company.id)
        self.assertEqual(event.user_id, user.id)

    def test_user_of_company_b_with_company_a_fails(self):
        company_a = make_company()
        user_b = make_user(make_company())
        with self.assertRaises(AuditTenantMismatchError):
            create_audit_log(
                company=company_a, user=user_b, action="a", entity_type="b", entity_id=1
            )
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_user_none_is_allowed(self):
        event = create_audit_log(
            company=make_company(), user=None, action="a", entity_type="b", entity_id=1
        )
        self.assertIsNone(event.user)


class SensitiveDataTests(TestCase):
    def setUp(self):
        self.company = make_company()

    def _create(self, **values):
        return create_audit_log(
            company=self.company,
            action="record",
            entity_type="client",
            entity_id=1,
            previous_values=values,
        ).previous_values

    def test_flat_sensitive_keys_are_redacted_case_insensitively(self):
        result = self._create(
            password="hunter2",
            Password="P",
            MFA_SECRET="xyz",
            mfa_secret_encrypted="enc",
            access_token="tok",
            refresh_token="r",
            api_key="k",
            secret="s",
            authorization="Bearer abc",
            safe_field="visible",
        )
        self.assertEqual(result["password"], REDACTED_MARKER)
        self.assertEqual(result["Password"], REDACTED_MARKER)
        self.assertEqual(result["MFA_SECRET"], REDACTED_MARKER)
        self.assertEqual(result["mfa_secret_encrypted"], REDACTED_MARKER)
        self.assertEqual(result["access_token"], REDACTED_MARKER)
        self.assertEqual(result["refresh_token"], REDACTED_MARKER)
        self.assertEqual(result["api_key"], REDACTED_MARKER)
        self.assertEqual(result["secret"], REDACTED_MARKER)
        self.assertEqual(result["authorization"], REDACTED_MARKER)
        self.assertEqual(result["safe_field"], "visible")

    def test_nested_sensitive_keys_are_redacted(self):
        result = self._create(
            nested={
                "credentials": {"password": "p1", "username": "bob"},
                "list": [
                    {"access_token": "t1", "ok": 1},
                    {"refresh_token": "t2"},
                ],
                "plain": "kept",
            }
        )
        self.assertEqual(result["nested"]["credentials"]["password"], REDACTED_MARKER)
        self.assertEqual(result["nested"]["credentials"]["username"], "bob")
        self.assertEqual(result["nested"]["list"][0]["access_token"], REDACTED_MARKER)
        self.assertEqual(result["nested"]["list"][0]["ok"], 1)
        self.assertEqual(result["nested"]["list"][1]["refresh_token"], REDACTED_MARKER)
        self.assertEqual(result["nested"]["plain"], "kept")

    def test_original_payload_is_not_mutated(self):
        payload = {"password": "p", "nested": {"token": "t"}, "ok": 1}
        create_audit_log(
            company=self.company,
            action="record",
            entity_type="client",
            entity_id=1,
            new_values=payload,
        )
        self.assertEqual(payload, {"password": "p", "nested": {"token": "t"}, "ok": 1})

    def test_sanitizer_is_pure(self):
        source = {"a": {"secret": "s"}, "b": ["x"]}
        copy = sanitize_audit_payload(source)
        self.assertEqual(source, {"a": {"secret": "s"}, "b": ["x"]})
        self.assertEqual(copy["a"]["secret"], REDACTED_MARKER)


class JsonBehaviorTests(TestCase):
    def setUp(self):
        self.company = make_company()

    def test_json_compatible_payloads_are_stored(self):
        event = create_audit_log(
            company=self.company,
            action="record",
            entity_type="document",
            entity_id=1,
            previous_values={
                "list": [1, "two", None, True],
                "nested": {"ok": "kept"},
                "flag": False,
            },
            new_values=None,
        )
        event.refresh_from_db()
        self.assertEqual(
            event.previous_values["list"], [1, "two", None, True]
        )
        self.assertEqual(event.previous_values["nested"], {"ok": "kept"})
        self.assertIsNone(event.new_values)

    def test_non_json_payload_is_rejected(self):
        with self.assertRaises(AuditLogError):
            create_audit_log(
                company=self.company,
                action="record",
                entity_type="client",
                entity_id=1,
                new_values={"bad": object()},
            )
        with self.assertRaises(AuditLogError):
            create_audit_log(
                company=self.company,
                action="record",
                entity_type="client",
                entity_id=1,
                previous_values={"bad": {1, 2, 3}},
            )
        # Standard JSON cannot represent Decimal (the DB driver uses plain
        # json.dumps), so it must be rejected at the service boundary too.
        with self.assertRaises(AuditLogError):
            create_audit_log(
                company=self.company,
                action="record",
                entity_type="client",
                entity_id=1,
                previous_values={"bad": Decimal("12.50")},
            )

    def test_invalid_request_id_is_rejected(self):
        with self.assertRaises(AuditLogError):
            create_audit_log(
                company=self.company,
                action="record",
                entity_type="client",
                entity_id=1,
                request_id="not-a-uuid",
            )


class TransactionBehaviorTests(TestCase):
    def test_audit_row_participates_in_surrounding_transaction(self):
        company = make_company()
        create_audit_log(
            company=company, action="ok", entity_type="client", entity_id=1
        )
        self.assertEqual(AuditLog.objects.count(), 1)

        with transaction.atomic():
            create_audit_log(
                company=company, action="rollback", entity_type="client", entity_id=2
            )
            self.assertEqual(AuditLog.objects.count(), 2)
            transaction.set_rollback(True)

        self.assertEqual(AuditLog.objects.count(), 1)
        self.assertFalse(
            AuditLog.objects.filter(action="rollback").exists()
        )