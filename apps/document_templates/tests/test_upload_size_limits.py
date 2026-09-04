"""
Focused tests for the document-template upload size limit.

Verifies the real boundary over the actual upload endpoint: files below and
exactly at ``MAX_TEMPLATE_FILE_SIZE`` are accepted and stored, files above it
are rejected with 400 before any storage write occurs, and the existing
replacement/storage-integrity flow is unaffected.
"""

import shutil
import tempfile
from io import BytesIO
from unittest import mock
from zipfile import ZIP_DEFLATED, ZipFile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from rest_framework import status

from apps.document_templates.tests.test_api import (
    ALL_DOCUMENT_TEMPLATE_PERMISSIONS,
    DocumentTemplateFileAPITestCase,
)

TEMP_MEDIA = tempfile.mkdtemp(prefix="grm_tpl_limits_tests_")

FILE_LIMIT = 2048


@override_settings(MEDIA_ROOT=TEMP_MEDIA, MAX_TEMPLATE_FILE_SIZE=FILE_LIMIT)
class TemplateUploadSizeLimitTests(DocumentTemplateFileAPITestCase):
    ALL = ALL_DOCUMENT_TEMPLATE_PERMISSIONS

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TEMP_MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        self.grant(self.alice, *self.ALL)
        self.template = self.make_template_row(self.company_a, name="Size Limit")
        self.auth(self.alice)

    def _raw_docx(self, comment_len=0):
        buf = BytesIO()
        with ZipFile(buf, "w", ZIP_DEFLATED) as z:
            z.writestr(
                "[Content_Types].xml",
                b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
            )
            z.writestr(
                "_rels/.rels",
                b"<Relationships xmlns='http://schemas.openxmlformats.org/"
                b"package/2006/relationships'/>",
            )
            z.writestr("word/document.xml", b"x" * 64)
            z.comment = b"c" * comment_len
        return buf.getvalue()

    def _upload_of_size(self, target):
        """A valid .docx whose total stored size is exactly ``target`` bytes."""
        base = self._raw_docx()
        self.assertGreaterEqual(target, len(base))
        data = self._raw_docx(comment_len=target - len(base))
        self.assertEqual(len(data), target)
        return SimpleUploadedFile(
            "tpl.docx", data, content_type="application/octet-stream"
        )

    def upload(self, upload):
        return self.client.post(
            self.template_file_url(self.template.id),
            {"file": upload},
            format="multipart",
        )

    def test_file_below_limit_is_accepted_and_stored(self):
        response = self.upload(self._upload_of_size(FILE_LIMIT - 100))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.template.refresh_from_db()
        self.assertTrue(self.template.file)
        self.template.file.delete(save=False)

    def test_file_exactly_at_limit_is_accepted_and_stored(self):
        response = self.upload(self._upload_of_size(FILE_LIMIT))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.template.refresh_from_db()
        self.assertTrue(self.template.file)
        self.template.file.delete(save=False)

    def test_file_above_limit_is_rejected_before_storage(self):
        with mock.patch(
            "apps.document_templates.api.views.default_storage.save"
        ) as storage_save:
            response = self.upload(self._upload_of_size(FILE_LIMIT + 1))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        storage_save.assert_not_called()
        self.template.refresh_from_db()
        self.assertFalse(bool(self.template.file))

    def test_large_file_does_not_enter_replacement_storage(self):
        # Pre-existing file must survive an oversized replacement attempt.
        first = self.upload(self._upload_of_size(FILE_LIMIT - 100))
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.template.refresh_from_db()
        original_name = self.template.file.name

        with mock.patch(
            "apps.document_templates.api.views.default_storage.save"
        ) as storage_save:
            response = self.upload(self._upload_of_size(FILE_LIMIT + 1))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        storage_save.assert_not_called()
        self.template.refresh_from_db()
        # DB reference and stored file are untouched.
        self.assertEqual(self.template.file.name, original_name)
        self.template.file.delete(save=False)