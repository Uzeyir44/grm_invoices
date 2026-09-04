"""
Tests for template-file URL exposure / direct media access.

The template and template-version serializers must not advertise publicly
usable ``/media/...`` storage URLs, and Django itself must not expose
``MEDIA_ROOT`` through a public route. Template files are only reachable
through the authenticated, tenant-scoped download endpoint.

Covers:
  * serializer responses exposing only safe metadata / the authenticated
    download endpoint (never a /media/ storage URL);
  * authenticated, unauthenticated, and cross-company download behavior;
  * the absence of a public /media/ route in this repository.
"""

import tempfile
import uuid
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse

from rest_framework import status
from rest_framework.test import APITestCase

from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.document_templates.models import DocumentTemplate
from apps.reference_data.models import DocumentType

TEMP_MEDIA = tempfile.mkdtemp(prefix="grm_tpl_url_tests_")

ALL_PERMS = (
    "document_templates.read",
    "document_templates.create",
    "document_templates.update",
    "document_templates.delete",
    "document_templates.version_create",
    "document_templates.version_activate",
)


@override_settings(MEDIA_ROOT=TEMP_MEDIA)
class TemplateFileUrlSecurityTestCase(APITestCase):
    def setUp(self):
        self.company_a = make_company()
        self.company_b = make_company()
        self.alice = make_user(self.company_a, email="alice@example.com")
        self.carol = make_user(self.company_b, email="carol@example.com")
        self.document_type = DocumentType.objects.create(code="invoice", name="Invoice")
        self.grant(self.alice, *ALL_PERMS)
        self.grant(self.carol, *ALL_PERMS)
        self.auth(self.alice)

        self.template = DocumentTemplate.objects.create(
            company=self.company_a,
            document_type=self.document_type,
            name="Private Template",
        )
        self.uploaded_bytes = self.upload_template_file(
            self.template, "Header {{ company.name }} {{ client.name }}"
        )
        self.template.refresh_from_db()
        self.stored_name = self.template.file.name
        self.version = self.client.post(
            reverse(
                "document-template-version-list-create",
                kwargs={"pk": self.template.id},
            ),
            {},
            format="json",
        ).json()

    def grant(self, user, *codes):
        role = Role.objects.create(name=f"R{uuid.uuid4().hex[:8]}", company=None)
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code))
        UserRole.objects.create(user=user, role=role)

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def _docx_bytes(self, text):
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
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
            )
            z.writestr(
                "_rels/.rels",
                "<Relationships xmlns='http://schemas.openxmlformats.org/"
                "package/2006/relationships'/>",
            )
            z.writestr("word/document.xml", document)
        return buf.getvalue()

    def upload_template_file(self, template, text):
        data = self._docx_bytes(text)
        upload = SimpleUploadedFile(
            "tpl.docx", data, content_type="application/octet-stream"
        )
        response = self.client.post(
            reverse("document-template-file", kwargs={"pk": template.id}),
            {"file": upload},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return data

    def template_detail_url(self, template_id):
        return reverse("document-template-detail", kwargs={"pk": template_id})

    def file_url(self, template_id):
        return reverse("document-template-file", kwargs={"pk": template_id})

    def versions_url(self, template_id):
        return reverse(
            "document-template-version-list-create", kwargs={"pk": template_id}
        )

    def test_template_serializer_does_not_expose_public_media_url(self):
        response = self.client.get(self.template_detail_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertNotIn("/media/", str(payload))
        # The `file` field points at the authenticated download endpoint — not
        # a public storage URL.
        self.assertEqual(
            payload["file"], f"/api/document-templates/{self.template.id}/file/"
        )
        self.assertIsNotNone(payload["file_name"])

    def test_version_serializer_does_not_expose_public_media_url(self):
        response = self.client.get(self.versions_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertNotIn("/media/", str(payload))
        version = payload[0]
        self.assertNotIn("file", version)
        self.assertIs(version["has_file"], True)
        self.assertIsNotNone(version["file_name"])

    def test_authenticated_download_returns_file(self):
        response = self.client.get(self.file_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("attachment", response.get("Content-Disposition", ""))
        self.assertEqual(b"".join(response.streaming_content), self.uploaded_bytes)

    def test_unauthenticated_download_is_rejected(self):
        self.client.force_authenticate(user=None)
        response = self.client.get(self.file_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_cross_company_download_is_rejected(self):
        self.auth(self.carol)
        response = self.client.get(self.file_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_no_public_media_route_in_django(self):
        # Django does not serve MEDIA_ROOT (no static() route); a raw
        # /media/... storage path must resolve to 404, never to the file.
        self.auth(self.alice)
        response = self.client.get(f"/media/{self.stored_name}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)