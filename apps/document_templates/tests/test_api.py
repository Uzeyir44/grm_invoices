import uuid

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
        self.invoice_type = DocumentType.objects.create(
            code="invoice", name="Invoice"
        )
        self.contract_type = DocumentType.objects.create(
            code="consulting_contract", name="Consulting Contract"
        )

    def grant(self, user, *codes):
        role = Role.objects.create(name=f"Role {uuid.uuid4().hex[:8]}", company=None)
        for code in codes:
            role.permissions.add(Permission.objects.get(code=code))
        UserRole.objects.create(user=user, role=role)

    def auth(self, user):
        self.client.force_authenticate(user=user)
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
