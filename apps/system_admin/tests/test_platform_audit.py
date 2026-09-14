"""
Phase 2 — platform audit attribution tests.

A platform action is audited against the reserved platform company (the actor
company) with the administered tenant recorded explicitly as
``target_company_id`` in the payload. Callers cannot forge the audit company,
non-platform actors are rejected, and platform events stay invisible to tenant
audit readers.
"""

import uuid

from django.contrib.auth.models import AnonymousUser
from django.core.cache import cache
from django.db import IntegrityError, ProgrammingError, transaction
from django.urls import reverse

from rest_framework import status
from rest_framework.test import APITestCase

from apps.audit_logs.models import AuditLog
from apps.audit_logs.services import create_audit_log
from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.system_admin.audit import (
    TARGET_COMPANY_ID_KEY,
    PlatformAuditError,
    create_platform_audit_log,
)
from apps.system_admin.tests.support import make_platform_company, make_system_admin


class PlatformAuditAttributionTests(APITestCase):
    def setUp(self):
        self.platform = make_platform_company()
        self.admin = make_system_admin(
            company=self.platform, email="root@grm.example"
        )
        self.tenant = make_company()
        self.tenant_user = make_user(self.tenant, email="alice@example.com")

    def test_platform_event_uses_platform_company_and_records_target(self):
        event = create_platform_audit_log(
            user=self.admin,
            action="company.create",
            entity_type="company",
            entity_id=self.tenant.id,
            target_company=self.tenant,
            new_values={"display_name": self.tenant.display_name},
        )
        self.assertEqual(event.company_id, self.platform.id)
        self.assertEqual(event.user_id, self.admin.id)
        self.assertEqual(event.new_values[TARGET_COMPANY_ID_KEY], self.tenant.id)
        self.assertEqual(
            event.new_values["display_name"], self.tenant.display_name
        )
        self.assertNotEqual(event.company_id, self.tenant.id)

    def test_target_company_id_parameter_is_recorded(self):
        event = create_platform_audit_log(
            user=self.admin,
            action="company.update",
            entity_type="company",
            entity_id=self.tenant.id,
            target_company_id=self.tenant.id,
        )
        self.assertEqual(event.new_values[TARGET_COMPANY_ID_KEY], self.tenant.id)

    def test_non_system_actor_is_rejected_and_no_row_written(self):
        with self.assertRaises(PlatformAuditError):
            create_platform_audit_log(
                user=self.tenant_user,
                action="company.create",
                entity_type="company",
                entity_id=self.tenant.id,
                target_company=self.tenant,
            )
        self.assertFalse(AuditLog.objects.filter(company=self.platform).exists())

    def test_platform_user_without_system_role_is_rejected(self):
        plain = make_user(self.platform, email="plain@grm.example")
        with self.assertRaises(PlatformAuditError):
            create_platform_audit_log(
                user=plain, action="x", entity_type="company", entity_id=1
            )

    def test_anonymous_actor_is_rejected(self):
        with self.assertRaises(PlatformAuditError):
            create_platform_audit_log(
                user=AnonymousUser(), action="x", entity_type="company", entity_id=1
            )

    def test_conflicting_target_arguments_are_rejected(self):
        with self.assertRaises(PlatformAuditError):
            create_platform_audit_log(
                user=self.admin,
                action="x",
                entity_type="company",
                entity_id=1,
                target_company=self.tenant,
                target_company_id=self.tenant.id,
            )

    def test_sensitive_values_remain_redacted(self):
        event = create_platform_audit_log(
            user=self.admin,
            action="user.create",
            entity_type="user",
            entity_id=1,
            target_company=self.tenant,
            new_values={"email": "x@example.com", "password": "hunter2"},
        )
        self.assertEqual(event.new_values["password"], "[REDACTED]")

    def test_request_id_is_preserved(self):
        request_id = uuid.uuid4()
        event = create_platform_audit_log(
            user=self.admin,
            action="company.create",
            entity_type="company",
            entity_id=self.tenant.id,
            request_id=request_id,
        )
        self.assertEqual(event.request_id, request_id)

    def test_audit_rows_remain_append_only(self):
        event = create_platform_audit_log(
            user=self.admin,
            action="company.create",
            entity_type="company",
            entity_id=self.tenant.id,
            target_company=self.tenant,
        )
        event.action = "tampered"
        with self.assertRaises((IntegrityError, ProgrammingError)):
            with transaction.atomic():
                event.save(update_fields=["action"])


class PlatformAuditVisibilityTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.platform = make_platform_company()
        self.admin = make_system_admin(
            company=self.platform, email="root@grm.example"
        )
        self.tenant = make_company()
        self.tenant_user = make_user(self.tenant, email="alice@example.com")

        auditor_role = Role.objects.create(
            name="Auditor", company=None, scope="tenant"
        )
        auditor_role.permissions.add(Permission.objects.get(code="audit_logs.read"))
        UserRole.objects.create(user=self.tenant_user, role=auditor_role)

        # One platform event and one ordinary tenant event.
        create_platform_audit_log(
            user=self.admin,
            action="company.create",
            entity_type="company",
            entity_id=self.tenant.id,
            target_company=self.tenant,
        )
        create_audit_log(
            company=self.tenant,
            user=self.tenant_user,
            action="client.create",
            entity_type="client",
            entity_id=1,
        )

    def test_tenant_audit_api_excludes_platform_events(self):
        self.client.force_authenticate(self.tenant_user)
        response = self.client.get(reverse("audit-log-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        rows = response.json()["results"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["company_id"], self.tenant.id)
        self.assertTrue(
            all(row["company_id"] == self.tenant.id for row in rows),
            "tenant audit reader must never see platform events",
        )
        self.assertNotIn(
            self.platform.id, {row["company_id"] for row in rows}
        )
