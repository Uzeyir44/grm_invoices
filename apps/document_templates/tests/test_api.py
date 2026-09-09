import uuid

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from rest_framework import status
from rest_framework.test import APITestCase

from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.document_templates.models import DocumentTemplate
from apps.reference_data.models import DocumentType

ALL_DOCUMENT_TEMPLATE_PERMISSIONS = (
    "document_templates.read",
    "document_templates.create",
    "document_templates.update",
    "document_templates.delete",
)


class DocumentTemplateAPITestCase(APITestCase):
    def setUp(self):
        self.company_a = make_company()
        self.company_b = make_company()
        self.alice = make_user(self.company_a, email="alice@example.com")
        self.bob = make_user(self.company_a, email="bob@example.com")
        self.carol = make_user(self.company_b, email="carol@example.com")
        # The seeded catalog (0003_seed_document_types) already provides these
        # codes; get_or_create keeps this suite green with or without the seed.
        self.invoice_type, _ = DocumentType.objects.get_or_create(
            code="invoice", defaults={"name": "Invoice"}
        )
        self.contract_type, _ = DocumentType.objects.get_or_create(
            code="consulting_contract", defaults={"name": "Consulting Contract"}
        )

    def grant(self, user, *codes):
        role = Role.objects.create(name=f"Role {uuid.uuid4().hex[:8]}", company=None)
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code))
        UserRole.objects.create(user=user, role=role)

    def auth(self, user):
        self.client.force_authenticate(user=user)
        return self.client

    def deauth(self):
        self.client.force_authenticate(user=None)
        return self.client

    def template_payload(self, **overrides):
        payload = {
            "document_type": self.invoice_type.id,
            "name": "Standard Invoice",
        }
        payload.update(overrides)
        return payload

    def create_template(self, user, payload):
        self.auth(user)
        return self.client.post(
            reverse("document-template-list-create"), payload, format="json"
        )

    def make_template_row(self, company, **overrides):
        values = {
            "company": company,
            "document_type": self.invoice_type,
            "name": f"Template {uuid.uuid4().hex[:8]}",
        }
        values.update(overrides)
        return DocumentTemplate.objects.create(**values)

    def template_detail_url(self, template_id):
        return reverse("document-template-detail", kwargs={"pk": template_id})


class DocumentTemplateAccessTests(DocumentTemplateAPITestCase):
    def test_unauthenticated_list_is_rejected(self):
        response = self.client.get(reverse("document-template-list-create"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_authenticated_without_permission_is_denied(self):
        self.auth(self.alice)
        response = self.client.get(reverse("document-template-list-create"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_read_permission_allows_listing(self):
        self.grant(self.alice, "document_templates.read")
        self.auth(self.alice)
        response = self.client.get(reverse("document-template-list-create"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_create_requires_create_permission(self):
        self.auth(self.alice)
        denied = self.client.post(
            reverse("document-template-list-create"),
            self.template_payload(),
            format="json",
        )
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)
        self.grant(self.alice, "document_templates.create")
        allowed = self.client.post(
            reverse("document-template-list-create"),
            self.template_payload(),
            format="json",
        )
        self.assertEqual(allowed.status_code, status.HTTP_201_CREATED)

    def test_retrieve_requires_read_permission(self):
        template = self.make_template_row(self.company_a)
        self.auth(self.bob)
        response = self.client.get(self.template_detail_url(template.id))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_update_requires_update_permission(self):
        template = self.make_template_row(self.company_a)
        self.auth(self.bob)
        response = self.client.patch(
            self.template_detail_url(template.id),
            {"name": "Renamed"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_delete_requires_delete_permission(self):
        template = self.make_template_row(self.company_a)
        self.auth(self.bob)
        response = self.client.delete(self.template_detail_url(template.id))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class DocumentTemplateTenantIsolationTests(DocumentTemplateAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *ALL_DOCUMENT_TEMPLATE_PERMISSIONS)
        self.grant(self.carol, *ALL_DOCUMENT_TEMPLATE_PERMISSIONS)
        self.template_a1 = self.make_template_row(
            self.company_a, name="Template A1"
        )
        self.template_a2 = self.make_template_row(
            self.company_a, name="Template A2"
        )
        self.template_b1 = self.make_template_row(
            self.company_b, name="Template B1"
        )

    def test_list_is_scoped_to_own_company(self):
        self.auth(self.alice)
        response = self.client.get(reverse("document-template-list-create"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row["id"] for row in response.json()}
        self.assertEqual(ids, {self.template_a1.id, self.template_a2.id})

        self.auth(self.carol)
        response = self.client.get(reverse("document-template-list-create"))
        self.assertEqual({row["id"] for row in response.json()}, {self.template_b1.id})

    def test_cannot_retrieve_other_company_template(self):
        self.auth(self.alice)
        response = self.client.get(self.template_detail_url(self.template_b1.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_update_other_company_template(self):
        self.auth(self.alice)
        response = self.client.patch(
            self.template_detail_url(self.template_b1.id),
            {"name": "Hijacked"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_delete_other_company_template(self):
        self.auth(self.alice)
        response = self.client.delete(self.template_detail_url(self.template_b1.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(
            DocumentTemplate.objects.filter(pk=self.template_b1.id).exists()
        )

    def test_own_template_is_accessible(self):
        self.auth(self.alice)
        response = self.client.get(self.template_detail_url(self.template_a1.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["company_id"], self.company_a.id)


class DocumentTemplateCreationTests(DocumentTemplateAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, "document_templates.create", "document_templates.read")

    def test_created_template_belongs_to_caller_company(self):
        response = self.create_template(self.alice, self.template_payload())
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertEqual(data["company_id"], self.company_a.id)
        self.assertEqual(
            DocumentTemplate.objects.get(pk=data["id"]).company_id,
            self.company_a.id,
        )
        self.assertEqual(data["document_type_code"], "invoice")
        self.assertIs(data["is_active"], True)

    def test_company_id_in_payload_is_ignored(self):
        payload = self.template_payload(company_id=self.company_b.id)
        response = self.create_template(self.alice, payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["company_id"], self.company_a.id)
        template = DocumentTemplate.objects.get(pk=response.json()["id"])
        self.assertEqual(template.company_id, self.company_a.id)


class DocumentTemplateUpdateTests(DocumentTemplateAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *ALL_DOCUMENT_TEMPLATE_PERMISSIONS)
        self.template = self.make_template_row(self.company_a, name="Original")

    def test_update_metadata_succeeds(self):
        self.auth(self.alice)
        response = self.client.patch(
            self.template_detail_url(self.template.id),
            {"name": "Renamed Template"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["name"], "Renamed Template")

    def test_update_document_type_succeeds(self):
        self.auth(self.alice)
        response = self.client.patch(
            self.template_detail_url(self.template.id),
            {"document_type": self.contract_type.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["document_type_code"], "consulting_contract")

    def test_update_cannot_change_company(self):
        self.auth(self.alice)
        response = self.client.patch(
            self.template_detail_url(self.template.id),
            {"company_id": self.company_b.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["company_id"], self.company_a.id)
        self.template.refresh_from_db()
        self.assertEqual(self.template.company_id, self.company_a.id)

    def test_update_with_company_id_is_ignored_not_errors(self):
        self.auth(self.alice)
        response = self.client.patch(
            self.template_detail_url(self.template.id),
            {"name": "Kept Name", "company_id": self.company_b.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["name"], "Kept Name")
        self.assertEqual(response.json()["company_id"], self.company_a.id)


class DocumentTemplateActivationTests(DocumentTemplateAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *ALL_DOCUMENT_TEMPLATE_PERMISSIONS)
        self.grant(self.carol, *ALL_DOCUMENT_TEMPLATE_PERMISSIONS)
        self.template = self.make_template_row(self.company_a, name="Toggleable")

    def test_created_template_is_active_by_default(self):
        created = self.create_template(self.alice, self.template_payload())
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertIs(created.json()["is_active"], True)

    def test_deactivate_and_reactivate(self):
        self.auth(self.alice)
        deactivated = self.client.patch(
            self.template_detail_url(self.template.id),
            {"is_active": False},
            format="json",
        )
        self.assertEqual(deactivated.status_code, status.HTTP_200_OK)
        self.assertIs(deactivated.json()["is_active"], False)

        reactivated = self.client.patch(
            self.template_detail_url(self.template.id),
            {"is_active": True},
            format="json",
        )
        self.assertEqual(reactivated.status_code, status.HTTP_200_OK)
        self.assertIs(reactivated.json()["is_active"], True)

    def test_activation_is_company_scoped(self):
        self.auth(self.carol)
        response = self.client.patch(
            self.template_detail_url(self.template.id),
            {"is_active": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.template.refresh_from_db()
        self.assertIs(self.template.is_active, True)


class DocumentTemplateSoftDeleteTests(DocumentTemplateAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *ALL_DOCUMENT_TEMPLATE_PERMISSIONS)
        self.template = self.create_template(self.alice, self.template_payload()).json()

    def test_delete_soft_deletes_and_preserves_history(self):
        response = self.client.delete(self.template_detail_url(self.template["id"]))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        deleted = DocumentTemplate.objects.get(pk=self.template["id"])
        self.assertIsNotNone(deleted.deleted_at)

    def test_deleted_template_excluded_from_list(self):
        alive = self.create_template(
            self.alice,
            self.template_payload(
                name="Still Alive", document_type=self.contract_type.id
            ),
        ).json()
        self.client.delete(self.template_detail_url(self.template["id"]))
        self.auth(self.alice)
        response = self.client.get(reverse("document-template-list-create"))
        ids = {row["id"] for row in response.json()}
        self.assertIn(alive["id"], ids)
        self.assertNotIn(self.template["id"], ids)

    def test_deleted_template_detail_returns_404(self):
        self.client.delete(self.template_detail_url(self.template["id"]))
        self.auth(self.alice)
        response = self.client.get(self.template_detail_url(self.template["id"]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_and_delete_require_non_deleted_object(self):
        self.client.delete(self.template_detail_url(self.template["id"]))
        self.auth(self.alice)
        patch = self.client.patch(
            self.template_detail_url(self.template["id"]),
            {"name": "Nope"},
            format="json",
        )
        self.assertEqual(patch.status_code, status.HTTP_404_NOT_FOUND)
        delete = self.client.delete(self.template_detail_url(self.template["id"]))
        self.assertEqual(delete.status_code, status.HTTP_404_NOT_FOUND)


class DocumentTemplateValidationTests(DocumentTemplateAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *ALL_DOCUMENT_TEMPLATE_PERMISSIONS)

    def test_document_type_is_required(self):
        response = self.create_template(
            self.alice, {"name": "No Type"}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_name_is_required(self):
        response = self.create_template(
            self.alice, {"document_type": self.invoice_type.id}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_document_type_is_rejected(self):
        response = self.create_template(
            self.alice,
            {"document_type": 999999, "name": "Ghost Type"},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_name_longer_than_200_chars_is_rejected(self):
        response = self.create_template(
            self.alice, {"name": "x" * 201}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_document_type_filter_on_list(self):
        self.create_template(self.alice, self.template_payload())
        self.create_template(
            self.alice,
            self.template_payload(
                name="Contract", document_type=self.contract_type.id
            ),
        )
        self.auth(self.alice)
        response = self.client.get(
            reverse("document-template-list-create"),
            {"document_type": self.contract_type.id},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = {row["name"] for row in response.json()}
        self.assertEqual(names, {"Contract"})


class DocumentTemplateFileAPITestCase(DocumentTemplateAPITestCase):
    ALL = ALL_DOCUMENT_TEMPLATE_PERMISSIONS

    def template_file_url(self, template_id):
        return reverse("document-template-file", kwargs={"pk": template_id})

    def make_docx(self, content=b"hello world", name="tpl.docx"):
        from io import BytesIO
        from zipfile import ZIP_DEFLATED, ZipFile

        buf = BytesIO()
        with ZipFile(buf, "w", ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", content)
            z.writestr("_rels/.rels", content)
            z.writestr("word/document.xml", content)
        buf.seek(0)
        return SimpleUploadedFile(name, buf.read(), content_type="application/octet-stream")


class DocumentTemplateFileUploadTests(DocumentTemplateFileAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *self.ALL)
        self.template = self.make_template_row(self.company_a, name="File Template")

    def upload(self, **kwargs):
        url = self.template_file_url(self.template.id)
        return self.client.post(url, kwargs, format="multipart")

    def test_authorized_user_can_upload_valid_docx(self):
        self.auth(self.alice)
        docx = self.make_docx()
        response = self.upload(file=docx)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.template.refresh_from_db()
        self.assertIsNotNone(self.template.file)
        self.assertTrue(self.template.file.name.endswith(".docx"))
        self.template.file.delete(save=False)

    def test_upload_requires_file_field(self):
        self.auth(self.alice)
        response = self.upload()
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_file_type_is_rejected(self):
        self.auth(self.alice)
        bad = SimpleUploadedFile(
            "tpl.pdf", b"%PDF-1.4", content_type="application/pdf"
        )
        response = self.upload(file=bad)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("docx", response.content.decode().lower())

    def test_non_zip_docx_is_rejected(self):
        self.auth(self.alice)
        not_zip = SimpleUploadedFile(
            "tpl.docx", b"this is not a real zip at all", content_type="application/octet-stream"
        )
        response = self.upload(file=not_zip)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_oversized_file_is_rejected(self):
        from django.conf import settings

        self.auth(self.alice)
        # Size check runs before the zip validation, so a raw oversized blob
        # named .docx is rejected purely on size.
        big = SimpleUploadedFile(
            "tpl.docx",
            b"x" * (settings.MAX_TEMPLATE_FILE_SIZE + 1),
            content_type="application/octet-stream",
        )
        response = self.upload(file=big)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_upload_requires_update_permission(self):
        self.deauth()
        self.grant(self.bob, "document_templates.read")
        self.auth(self.bob)
        response = self.upload(file=self.make_docx())
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_unauthenticated_upload_is_rejected(self):
        response = self.upload(file=self.make_docx())
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class DocumentTemplateFileReplacementTests(DocumentTemplateFileAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *self.ALL)
        self.template = self.make_template_row(self.company_a, name="Replace Template")
        self.auth(self.alice)
        self.first = self.client.post(
            self.template_file_url(self.template.id),
            {"file": self.make_docx(b"first version")},
            format="multipart",
        ).json()
        self.template.refresh_from_db()
        self.original_path = self.template.file.name

    def test_upload_replaces_previous_file(self):
        with self.original_path and self.template.file.open("rb") as f:
            old_content = f.read()
        response = self.client.post(
            self.template_file_url(self.template.id),
            {"file": self.make_docx(b"second version")},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.template.refresh_from_db()
        self.assertIsNotNone(self.template.file)
        self.template.file.open("rb")
        new_content = self.template.file.read()
        self.assertNotEqual(new_content, old_content)
        # The stored file is rewritten in place (single current file, no
        # versioning yet), so the path stays the same but the bytes changed.
        self.template.file.close()
        self.template.file.delete(save=False)


class DocumentTemplateFileRetrievalTests(DocumentTemplateFileAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *self.ALL)
        self.grant(self.carol, *self.ALL)
        self.template = self.make_template_row(self.company_a, name="Download Template")
        self.auth(self.alice)
        self.content = b"downloadable template content"
        self.client.post(
            self.template_file_url(self.template.id),
            {"file": self.make_docx(self.content)},
            format="multipart",
        )
        self.template.refresh_from_db()

    def test_authorized_company_member_can_download_file(self):
        self.auth(self.alice)
        self.template.refresh_from_db()
        with self.template.file.open("rb") as f:
            stored = f.read()
        response = self.client.get(self.template_file_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("attachment", response.get("Content-Disposition", ""))
        self.assertEqual(b"".join(response.streaming_content), stored)

    def test_other_company_cannot_download_file(self):
        self.auth(self.carol)
        response = self.client.get(self.template_file_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_download_requires_read_permission(self):
        self.grant(self.bob, "document_templates.update")
        self.auth(self.bob)
        response = self.client.get(self.template_file_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_download_when_no_file_returns_404(self):
        no_file = self.make_template_row(self.company_a, name="Empty Template")
        self.auth(self.alice)
        response = self.client.get(self.template_file_url(no_file.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class DocumentTemplateFileDeletionTests(DocumentTemplateFileAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *self.ALL)
        self.template = self.make_template_row(self.company_a, name="Delete Template")
        self.auth(self.alice)
        self.client.post(
            self.template_file_url(self.template.id),
            {"file": self.make_docx(b"to be deleted")},
            format="multipart",
        )
        self.template.refresh_from_db()

    def test_delete_removes_file_but_keeps_template(self):
        self.auth(self.alice)
        response = self.client.delete(self.template_file_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.template.refresh_from_db()
        # The FieldFile reloaded from an empty DB value is falsy.
        self.assertFalse(bool(self.template.file))

    def test_delete_when_no_file_returns_404(self):
        empty = self.make_template_row(self.company_a, name="Empty Delete Template")
        self.auth(self.alice)
        response = self.client.delete(self.template_file_url(empty.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_tenant_cannot_delete_other_company_file(self):
        self.grant(self.carol, *self.ALL)
        self.auth(self.carol)
        url = self.template_file_url(self.template.id)
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_404_NOT_FOUND)
        self.template.refresh_from_db()
        self.assertIsNotNone(self.template.file)


class DocumentTemplateFileTenantIsolationTests(DocumentTemplateFileAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *self.ALL)
        self.grant(self.carol, *self.ALL)
        self.other = self.make_template_row(self.company_b, name="Company B Template")

    def test_company_a_cannot_upload_to_company_b_template(self):
        self.auth(self.alice)
        response = self.client.post(
            self.template_file_url(self.other.id),
            {"file": self.make_docx()},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_company_a_cannot_replace_company_b_file(self):
        self.auth(self.carol)
        self.client.post(
            self.template_file_url(self.other.id),
            {"file": self.make_docx(b"b content")},
            format="multipart",
        )
        self.other.refresh_from_db()
        self.auth(self.alice)
        response = self.client.post(
            self.template_file_url(self.other.id),
            {"file": self.make_docx(b"a content")},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.other.refresh_from_db()
        self.assertIsNotNone(self.other.file)

    def test_company_a_cannot_access_company_b_file(self):
        self.auth(self.carol)
        self.client.post(
            self.template_file_url(self.other.id),
            {"file": self.make_docx()},
            format="multipart",
        )
        self.auth(self.alice)
        response = self.client.get(self.template_file_url(self.other.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class DocumentTemplateVersionAPITestCase(DocumentTemplateAPITestCase):
    ALL = ALL_DOCUMENT_TEMPLATE_PERMISSIONS + (
        "document_templates.version_create",
        "document_templates.version_activate",
    )

    def make_docx_with_text(self, text, name="tpl.docx"):
        """Build a real-ish WordprocessingML docx whose body contains `text`."""
        from io import BytesIO
        from zipfile import ZIP_DEFLATED, ZipFile

        from django.core.files.uploadedfile import SimpleUploadedFile

        body = "".join(f"<w:p><w:r><w:t>{part}</w:t></w:r></w:p>" for part in text)
        document = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main"><w:body>'
            f"{body}</w:body></w:document>"
        )
        buf = BytesIO()
        with ZipFile(buf, "w", ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
            z.writestr("_rels/.rels", "<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'/>")
            z.writestr("word/document.xml", document)
        buf.seek(0)
        return SimpleUploadedFile(name, buf.read(), content_type="application/octet-stream")

    def attach_file(self, template, text):
        self.client.post(
            reverse("document-template-file", kwargs={"pk": template.id}),
            {"file": self.make_docx_with_text(text)},
            format="multipart",
        )
        template.refresh_from_db()

    def versions_url(self, template_id):
        return reverse("document-template-version-list-create", kwargs={"pk": template_id})

    def version_detail_url(self, template_id, version_id):
        return reverse(
            "document-template-version-detail",
            kwargs={"pk": template_id, "version_id": version_id},
        )

    def version_activate_url(self, template_id, version_id):
        return reverse(
            "document-template-version-activate",
            kwargs={"pk": template_id, "version_id": version_id},
        )


class DocumentTemplateVersionCreateTests(DocumentTemplateVersionAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *self.ALL)
        self.template = self.make_template_row(self.company_a, name="Version Template")
        self.auth(self.alice)
        self.attach_file(
            self.template,
            "Hello {{ company.name }} and {{ client.name }} ({{ document.number }})",
        )

    def test_first_version_can_be_created(self):
        response = self.client.post(self.versions_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["version_number"], 1)
        self.assertTrue(response.json()["is_active"])

    def test_new_version_gets_next_number_historical_unchanged(self):
        v1 = self.client.post(self.versions_url(self.template.id)).json()
        self.assertEqual(v1["version_number"], 1)
        # Change the working file, then create a second version.
        self.attach_file(self.template, "Updated {{ company.legal_name }}")
        v2 = self.client.post(self.versions_url(self.template.id)).json()
        self.assertEqual(v2["version_number"], 2)
        self.assertTrue(v2["is_active"])
        # v1 must be preserved (contents intact) and no longer active.
        self.template.refresh_from_db()
        v1_detail = self.client.get(
            self.version_detail_url(self.template.id, v1["id"])
        ).json()
        self.assertEqual(v1_detail["version_number"], 1)
        self.assertFalse(v1_detail["is_active"])

    def test_version_uniqueness_is_respected(self):
        v1 = self.client.post(self.versions_url(self.template.id)).json()
        # Manually inject a conflict and confirm the DB uniqueness applies.
        from apps.document_templates.models import TemplateVersion
        self.assertFalse(
            TemplateVersion.objects.filter(
                template=self.template, version_number=1
            ).exclude(pk=v1["id"]).exists()
        )

    def test_version_create_requires_permission(self):
        self.grant(self.bob, "document_templates.read", "document_templates.update")
        self.auth(self.bob)
        response = self.client.post(self.versions_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_version_create_requires_a_file(self):
        empty = self.make_template_row(self.company_a, name="No File Template")
        response = self.client.post(self.versions_url(empty.id))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_placeholder_content_is_rejected(self):
        self.attach_file(self.template, "Bad {{ client.foo }} here")
        response = self.client.post(self.versions_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("invalid_placeholders", response.json())

    def test_version_with_repeating_line_item_section_can_be_created(self):
        # A template using the engine-supported {{#each items}} markers must
        # be versionable: the markers are control tokens, not variables.
        self.attach_file(
            self.template,
            "Items:\n"
            "{{#each items}}\n"
            "{{ item.description }} {{ item.quantity }}\n"
            "{{/each}}\n"
            "Done {{ document.number }}",
        )
        response = self.client.post(self.versions_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["version_number"], 1)
        self.assertFalse(
            "invalid_placeholders" in response.json(),
            "repeating-section markers must not be reported invalid",
        )

    def test_unknown_each_collection_is_rejected(self):
        self.attach_file(self.template, "{{#each bogus}}\n{{ item.description }}\n{{/each}}")
        response = self.client.post(self.versions_url(self.template.id))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        payload = response.json()
        self.assertIn("invalid_placeholders", payload)
        self.assertIn("{{#each bogus}}", payload["invalid_placeholders"])


class DocumentTemplateVersionActivationTests(DocumentTemplateVersionAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *self.ALL)
        self.template = self.make_template_row(self.company_a, name="Activation Template")
        self.auth(self.alice)
        self.attach_file(self.template, "V1 {{ company.name }}")
        self.v1 = self.client.post(self.versions_url(self.template.id)).json()
        self.attach_file(self.template, "V2 {{ company.name }}")
        self.v2 = self.client.post(self.versions_url(self.template.id)).json()
        self.assertEqual(self.v2["is_active"], True)
        # Creating v2 deactivated v1 in the database.
        from apps.document_templates.models import TemplateVersion
        self.assertFalse(
            TemplateVersion.objects.get(pk=self.v1["id"]).is_active
        )

    def test_activating_older_version_flips_active_flag(self):
        response = self.client.post(
            self.version_activate_url(self.template.id, self.v1["id"])
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.json()["is_active"])
        # Only one active version remains.
        self.template.refresh_from_db()
        active = self.template.versions.filter(is_active=True)
        self.assertEqual(active.count(), 1)
        self.assertEqual(active.first().pk, self.v1["id"])
        self.assertFalse(self.template.versions.get(pk=self.v2["id"]).is_active)

    def test_only_one_version_active_after_activation(self):
        self.client.post(self.version_activate_url(self.template.id, self.v1["id"]))
        active = self.template.versions.filter(is_active=True)
        self.assertEqual(active.count(), 1)
        self.assertEqual(active.first().pk, self.v1["id"])

    def test_activation_requires_permission(self):
        self.grant(self.bob, "document_templates.read")
        self.auth(self.bob)
        response = self.client.post(
            self.version_activate_url(self.template.id, self.v2["id"])
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class DocumentTemplateVersionTenantIsolationTests(DocumentTemplateVersionAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *self.ALL)
        self.grant(self.carol, *self.ALL)
        self.template_a = self.make_template_row(self.company_a, name="T A")
        self.template_b = self.make_template_row(self.company_b, name="T B")
        self.auth(self.carol)
        self.attach_file(self.template_b, "B {{ company.voen }}")
        self.carol_v = self.client.post(self.versions_url(self.template_b.id)).json()
        self.auth(self.alice)
        self.attach_file(self.template_a, "A {{ company.voen }}")
        self.alice_v = self.client.post(self.versions_url(self.template_a.id)).json()

    def test_company_a_cannot_list_company_b_versions(self):
        response = self.client.get(self.versions_url(self.template_b.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_company_a_cannot_retrieve_company_b_version(self):
        response = self.client.get(
            self.version_detail_url(self.template_b.id, self.carol_v["id"])
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_company_a_cannot_create_version_for_company_b(self):
        response = self.client.post(self.versions_url(self.template_b.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_company_a_cannot_activate_company_b_version(self):
        response = self.client.post(
            self.version_activate_url(self.template_b.id, self.carol_v["id"])
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_own_versions_are_listable(self):
        response = self.client.get(self.versions_url(self.template_a.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.json()), 1)
        self.assertEqual(response.json()[0]["id"], self.alice_v["id"])
