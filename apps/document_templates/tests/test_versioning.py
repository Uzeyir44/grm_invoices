"""
Focused tests for template-version activation concurrency/integrity.

Verifies the invariant "at most one active TemplateVersion per
DocumentTemplate":
  * sequential activation + reverse activation,
  * the database partial unique constraint rejects a second active version,
  * concurrent activation of different versions of the same template is
    serialized by the PostgreSQL row lock and never leaves more than one
    active version (exercises real DB concurrency, not sequential calls),
  * the service rejects a version belonging to another template.
"""

import uuid
from concurrent.futures import ThreadPoolExecutor

from django.db import IntegrityError, transaction
from django.test import TestCase, TransactionTestCase

from apps.authentication.tests.test_authentication import make_company
from apps.document_templates.models import DocumentTemplate, TemplateVersion
from apps.document_templates.services.versioning import activate_version
from apps.reference_data.models import DocumentType


class TemplateVersionFixtureMixin:
    def _make_template(self, company):
        document_type, _ = DocumentType.objects.get_or_create(
            code="invoice", defaults={"name": "Invoice"}
        )
        template = DocumentTemplate.objects.create(
            company=company, document_type=document_type, name="Invoice Template"
        )
        return template

    def _make_version(self, template, number, is_active=False):
        return TemplateVersion.objects.create(
            template=template,
            company=template.company,
            version_number=number,
            storage_path=f"v{number}_{uuid.uuid4().hex[:8]}",
            is_active=is_active,
        )

    def _active_versions(self, template):
        return list(
            template.versions.filter(is_active=True).values_list("id", flat=True)
        )


class ActivationSequentialTests(TestCase, TemplateVersionFixtureMixin):
    def setUp(self):
        self.template = self._make_template(make_company())
        self.v1 = self._make_version(self.template, 1, is_active=True)
        self.v2 = self._make_version(self.template, 2, is_active=False)

    def test_activate_switches_active_version(self):
        activate_version(self.template, self.v2)

        self.v1.refresh_from_db()
        self.v2.refresh_from_db()
        self.assertFalse(self.v1.is_active)
        self.assertTrue(self.v2.is_active)
        self.assertEqual(self._active_versions(self.template), [self.v2.id])

    def test_reverse_activation(self):
        activate_version(self.template, self.v2)
        activate_version(self.template, self.v1)

        self.v1.refresh_from_db()
        self.v2.refresh_from_db()
        self.assertTrue(self.v1.is_active)
        self.assertFalse(self.v2.is_active)
        self.assertEqual(self._active_versions(self.template), [self.v1.id])

    def test_reactivating_current_version_keeps_single_active(self):
        activate_version(self.template, self.v1)

        self.assertEqual(self._active_versions(self.template), [self.v1.id])

    def test_activate_version_from_other_template_is_rejected(self):
        other_template = DocumentTemplate.objects.create(
            company=self.template.company,
            document_type=self.template.document_type,
            name="Other Template",
        )
        foreign = self._make_version(other_template, 1, is_active=True)
        with self.assertRaises(ValueError):
            activate_version(self.template, foreign)


class ActivationConstraintTests(TestCase, TemplateVersionFixtureMixin):
    def test_database_rejects_second_active_version(self):
        template = self._make_template(make_company())
        self._make_version(template, 1, is_active=True)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self._make_version(template, 2, is_active=True)

        self.assertEqual(len(self._active_versions(template)), 1)


class ActivationConcurrencyTests(TransactionTestCase, TemplateVersionFixtureMixin):
    """
    Real concurrent activation: two threads activate different versions of
    the same template simultaneously. The template-row lock must serialize
    them so exactly one version ends up active.
    """

    def test_concurrent_activation_leaves_single_active_version(self):
        template = self._make_template(make_company())
        v1 = self._make_version(template, 1, is_active=True)
        v2 = self._make_version(template, 2, is_active=False)

        def activate(version_id):
            try:
                activate_version(template, TemplateVersion.objects.get(pk=version_id))
            finally:
                from django.db import connection

                connection.close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            list(executor.map(activate, (v1.id, v2.id)))

        active = self._active_versions(template)
        self.assertEqual(len(active), 1)
        self.assertIn(active[0], (v1.id, v2.id))