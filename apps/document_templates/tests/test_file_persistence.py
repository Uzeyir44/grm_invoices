"""
Focused tests for template-file persistence / storage integrity.

Covers:
  * template file replacement — the new file is stored first, the database is
    updated, and only then is the old file removed (including storage-failure
    and database-failure rollback);
  * TemplateVersion file persistence — a version file written before the DB
    row must be cleaned up when the database transaction rolls back, and a
    storage failure must leave no row and no file.

Uses a temporary MEDIA_ROOT (same convention as the generated-documents
tests) so storage assertions exercise the real FileSystemStorage without
touching the repository media directory. Only the specific failure point is
mocked.
"""

import os
import tempfile
import uuid
from io import BytesIO
from unittest import mock
from zipfile import ZIP_DEFLATED, ZipFile

from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.test import override_settings
from django.urls import reverse

from rest_framework import status
from rest_framework.test import APITestCase

from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.document_templates.models import DocumentTemplate, TemplateVersion
from apps.reference_data.models import DocumentType

TEMP_MEDIA = tempfile.mkdtemp(prefix="grm_tpl_file_tests_")

ALL_PERMS = (
    "document_templates.read",
    "document_templates.create",
    "document_templates.update",
    "document_templates.delete",
    "document_templates.version_create",
    "document_templates.version_activate",
)


@override_settings(MEDIA_ROOT=TEMP_MEDIA)
class TemplateFilePersistenceTestCase(APITestCase):
    def setUp(self):
        self.company = make_company()
        self.user = make_user(self.company, email="alice@example.com")
        self.document_type, _ = DocumentType.objects.get_or_create(
            code="invoice", defaults={"name": "Invoice"}
        )
        self.grant(self.user, *ALL_PERMS)
        self.auth(self.user)
        self.template = DocumentTemplate.objects.create(
            company=self.company,
            document_type=self.document_type,
            name=f"Template {uuid.uuid4().hex[:8]}",
        )

    def grant(self, user, *codes):
        role = Role.objects.create(name=f"R{uuid.uuid4().hex[:8]}", company=None)
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code))
        UserRole.objects.create(user=user, role=role)

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def file_url(self):
        return reverse("document-template-file", kwargs={"pk": self.template.id})

    def _docx(self, text):
        document = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main"><w:body>'
            f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>"
            "</w:body></w:document>"
        )
        buf = BytesIO()
        with ZipFile(buf, "w", ZIP_DEFLATED) as z:
            z.writestr(
                "[Content_Types].xml",
                '<Types xmlns="http://schemas.openxmlformats.org/'
                'package/2006/content-types"/>',
            )
            z.writestr(
                "_rels/.rels",
                "<Relationships xmlns='http://schemas.openxmlformats.org/"
                "package/2006/relationships'/>",
            )
            z.writestr("word/document.xml", document)
        buf.seek(0)
        return SimpleUploadedFile(
            "tpl.docx", buf.read(), content_type="application/octet-stream"
        )

    def upload(self, content):
        return self.client.post(
            self.file_url(), {"file": self._docx(content)}, format="multipart"
        )

    def stored(self, name):
        return bool(name) and default_storage.exists(name)

    def current_dir_files(self):
        """Basenames of the template's stored current-file files."""
        path = f"templates/company_{self.company.id}/{self.template.id}/current"
        _dirs, files = default_storage.listdir(path)
        return set(files)

    def version_dir_files(self):
        """Basenames of stored TemplateVersion snapshot files."""
        path = f"templates/company_{self.company.id}/{self.template.id}"
        _dirs, files = default_storage.listdir(path)
        return set(files)


class TemplateFileReplacementPersistenceTests(TemplateFilePersistenceTestCase):
    def setUp(self):
        super().setUp()
        response = self.upload(b"original bytes")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.template.refresh_from_db()
        self.old_name = self.template.file.name

    def test_successful_replacement_swaps_file_and_removes_old(self):
        self.assertTrue(self.stored(self.old_name))

        response = self.upload(b"replacement bytes")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        self.template.refresh_from_db()
        new_name = self.template.file.name
        self.assertNotEqual(new_name, self.old_name)
        # DB points at the new file; new file stored; old file removed.
        self.assertTrue(self.stored(new_name))
        self.assertFalse(self.stored(self.old_name))
        self.assertEqual(self.current_dir_files(), {os.path.basename(new_name)})

    def test_storage_failure_keeps_old_file_and_database_reference(self):
        with mock.patch(
            "apps.document_templates.api.views.default_storage.save",
            side_effect=OSError("disk full"),
        ):
            self.client.raise_request_exception = False
            response = self.upload(b"replacement bytes")

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.template.refresh_from_db()
        self.assertEqual(self.template.file.name, self.old_name)
        self.assertTrue(self.stored(self.old_name))
        # Nothing new was written to storage.
        self.assertEqual(self.current_dir_files(), {os.path.basename(self.old_name)})

    def test_database_failure_after_new_file_is_stored_keeps_old_and_cleans_new(self):
        with mock.patch.object(
            DocumentTemplate, "save", side_effect=IntegrityError("boom")
        ):
            response = self.upload(b"replacement bytes")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.template.refresh_from_db()
        self.assertEqual(self.template.file.name, self.old_name)
        # The old file is untouched and the freshly written replacement file
        # did not remain as an orphan.
        self.assertTrue(self.stored(self.old_name))
        self.assertEqual(self.current_dir_files(), {os.path.basename(self.old_name)})


class TemplateFileDeletionPersistenceTests(TemplateFilePersistenceTestCase):
    def setUp(self):
        super().setUp()
        response = self.upload(b"to be removed")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.template.refresh_from_db()
        self.old_name = self.template.file.name

    def test_delete_clears_database_then_removes_file(self):
        self.assertTrue(self.stored(self.old_name))
        response = self.client.delete(self.file_url())
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.template.refresh_from_db()
        self.assertFalse(bool(self.template.file))
        self.assertFalse(self.stored(self.old_name))


class TemplateVersionFilePersistenceTests(TemplateFilePersistenceTestCase):
    def setUp(self):
        super().setUp()
        response = self.upload(b"template current file")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.template.refresh_from_db()

    def versions_url(self):
        return reverse(
            "document-template-version-list-create", kwargs={"pk": self.template.id}
        )

    def create_version(self):
        return self.client.post(self.versions_url(), {}, format="json")

    def test_successful_version_create_stores_row_and_file(self):
        response = self.create_version()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        version = TemplateVersion.objects.get(pk=response.json()["id"])
        self.assertEqual(version.version_number, 1)
        self.assertTrue(version.storage_path.endswith(".docx"))
        self.assertTrue(self.stored(version.file.name))
        # Exactly the committed snapshot file; the current file lives under a
        # separate 'current/' subdirectory and is not listed here.
        self.assertEqual(len(self.version_dir_files()), 1)

    def test_version_db_rollback_cleans_up_written_file(self):
        # The version file is written to storage, then the DB row save is
        # forced to fail; the transaction rolls back and the file is removed.
        with mock.patch.object(
            TemplateVersion, "save", side_effect=IntegrityError("boom")
        ):
            response = self.create_version()

        # The base view maps DB integrity conflicts to 400.
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            TemplateVersion.objects.filter(template=self.template).exists()
        )
        # No orphaned snapshot file remains in storage.
        self.assertEqual(self.version_dir_files(), set())

    def test_version_storage_failure_leaves_no_row_and_no_file(self):
        with mock.patch(
            "apps.document_templates.services.versioning.default_storage.save",
            side_effect=OSError("disk full"),
        ):
            self.client.raise_request_exception = False
            response = self.create_version()

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertFalse(
            TemplateVersion.objects.filter(template=self.template).exists()
        )
        self.assertEqual(self.version_dir_files(), set())