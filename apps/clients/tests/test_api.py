import uuid

from django.urls import reverse

from rest_framework import status
from rest_framework.test import APITestCase

from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.clients.models import (
    Client,
    ClientAddress,
    ClientBankAccount,
    ClientContact,
    ClientIndividual,
    ClientLegalEntity,
)
from apps.reference_data.models import AddressType, Bank, Currency

ALL_CLIENT_PERMISSIONS = (
    "clients.read",
    "clients.create",
    "clients.update",
    "clients.delete",
)


class ClientAPITestCase(APITestCase):
    def setUp(self):
        self.company_a = make_company()
        self.company_b = make_company()
        self.alice = make_user(self.company_a, email="alice@example.com")
        self.bob = make_user(self.company_a, email="bob@example.com")
        self.carol = make_user(self.company_b, email="carol@example.com")
        self.address_type = AddressType.objects.create(code="legal")
        self.currency = Currency.objects.create(code="AZN", name="Azerbaijani Manat")
        self.bank = Bank.objects.create(name="Test Bank")

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

    def legal_payload(self, **overrides):
        payload = {
            "client_type": "legal_entity",
            "legal_entity": {"legal_name": "Acme Ltd", "voen": "1234567890"},
        }
        payload.update(overrides)
        return payload

    def individual_payload(self, **overrides):
        payload = {
            "client_type": "individual",
            "individual": {"first_name": "Jane", "last_name": "Doe"},
        }
        payload.update(overrides)
        return payload

    def create_client(self, user, payload):
        self.auth(user)
        return self.client.post(reverse("client-list-create"), payload, format="json")

    def make_client_row(self, company, client_type=Client.ClientType.LEGAL_ENTITY):
        return Client.objects.create(company=company, client_type=client_type)

    def client_detail_url(self, client_id):
        return reverse("client-detail", kwargs={"pk": client_id})


class ClientAccessTests(ClientAPITestCase):
    def test_unauthenticated_list_is_rejected(self):
        response = self.client.get(reverse("client-list-create"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_authenticated_without_permission_is_denied(self):
        self.auth(self.alice)
        response = self.client.get(reverse("client-list-create"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_read_permission_allows_listing(self):
        self.grant(self.alice, "clients.read")
        self.auth(self.alice)
        response = self.client.get(reverse("client-list-create"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_create_requires_create_permission(self):
        self.auth(self.alice)
        denied = self.client.post(
            reverse("client-list-create"), self.legal_payload(), format="json"
        )
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)
        self.grant(self.alice, "clients.create")
        allowed = self.client.post(
            reverse("client-list-create"), self.legal_payload(), format="json"
        )
        self.assertEqual(allowed.status_code, status.HTTP_201_CREATED)

    def test_update_requires_update_permission(self):
        client = self.make_client_row(self.company_a)
        self.auth(self.bob)
        response = self.client.patch(
            self.client_detail_url(client.id),
            {"status": "inactive"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_delete_requires_delete_permission(self):
        client = self.make_client_row(self.company_a)
        self.auth(self.bob)
        response = self.client.delete(self.client_detail_url(client.id))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class ClientTenantIsolationTests(ClientAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *ALL_CLIENT_PERMISSIONS)
        self.grant(self.carol, *ALL_CLIENT_PERMISSIONS)
        self.client_a1 = self.make_client_row(self.company_a)
        self.client_a2 = self.make_client_row(self.company_a, Client.ClientType.INDIVIDUAL)
        self.client_b1 = self.make_client_row(self.company_b)

    def test_list_is_scoped_to_own_company(self):
        self.auth(self.alice)
        response = self.client.get(reverse("client-list-create"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row["id"] for row in response.json()}
        self.assertEqual(ids, {self.client_a1.id, self.client_a2.id})

        self.auth(self.carol)
        response = self.client.get(reverse("client-list-create"))
        self.assertEqual({row["id"] for row in response.json()}, {self.client_b1.id})

    def test_cannot_retrieve_other_company_client(self):
        self.auth(self.alice)
        response = self.client.get(self.client_detail_url(self.client_b1.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_update_other_company_client(self):
        self.auth(self.alice)
        response = self.client.patch(
            self.client_detail_url(self.client_b1.id),
            {"status": "inactive"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_delete_other_company_client(self):
        self.auth(self.alice)
        response = self.client.delete(self.client_detail_url(self.client_b1.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Client.objects.filter(pk=self.client_b1.id).exists())

    def test_cannot_access_own_client_of_other_company(self):
        self.auth(self.alice)
        response = self.client.get(self.client_detail_url(self.client_a1.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["company_id"], self.company_a.id)


class ClientCreationTests(ClientAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, "clients.create", "clients.read")

    def test_created_client_belongs_to_caller_company(self):
        response = self.create_client(self.alice, self.legal_payload())
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertEqual(data["company_id"], self.company_a.id)
        self.assertEqual(Client.objects.get(pk=data["id"]).company_id, self.company_a.id)

    def test_company_id_in_payload_is_ignored(self):
        payload = self.legal_payload(company_id=self.company_b.id)
        response = self.create_client(self.alice, payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["company_id"], self.company_a.id)
        client = Client.objects.get(pk=response.json()["id"])
        self.assertEqual(client.company_id, self.company_a.id)


class ClientTypeTests(ClientAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, "clients.create", "clients.read", "clients.update")

    def test_create_and_retrieve_individual(self):
        response = self.create_client(self.alice, self.individual_payload())
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertEqual(data["client_type"], "individual")
        self.assertEqual(data["individual"]["first_name"], "Jane")
        self.assertEqual(data["individual"]["last_name"], "Doe")
        self.assertTrue(
            ClientIndividual.objects.filter(client_id=data["id"]).exists()
        )

        self.auth(self.alice)
        detail = self.client.get(self.client_detail_url(data["id"]))
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.json()["individual"]["first_name"], "Jane")

    def test_update_individual_client(self):
        client_id = self.create_client(self.alice, self.individual_payload()).json()["id"]
        self.auth(self.alice)
        response = self.client.patch(
            self.client_detail_url(client_id),
            {"individual": {"middle_name": "Middle"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["individual"]["middle_name"], "Middle")

    def test_create_and_retrieve_legal_entity(self):
        response = self.create_client(self.alice, self.legal_payload())
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertEqual(data["client_type"], "legal_entity")
        self.assertEqual(data["legal_entity"]["legal_name"], "Acme Ltd")
        self.assertTrue(
            ClientLegalEntity.objects.filter(client_id=data["id"]).exists()
        )

    def test_update_legal_entity_client(self):
        client_id = self.create_client(self.alice, self.legal_payload()).json()["id"]
        self.auth(self.alice)
        response = self.client.patch(
            self.client_detail_url(client_id),
            {"legal_entity": {"trading_name": "Acme Trading"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["legal_entity"]["trading_name"], "Acme Trading")

    def test_individual_rejects_legal_entity_data(self):
        payload = {
            "client_type": "individual",
            "individual": {"first_name": "Jane", "last_name": "Doe"},
            "legal_entity": {"legal_name": "Acme", "voen": "55"},
        }
        response = self.create_client(self.alice, payload)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_legal_entity_rejects_individual_data(self):
        payload = {
            "client_type": "legal_entity",
            "legal_entity": {"legal_name": "Acme", "voen": "55"},
            "individual": {"first_name": "Jane"},
        }
        response = self.create_client(self.alice, payload)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_individual_requires_subtype_data(self):
        response = self.create_client(self.alice, {"client_type": "individual"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_legal_entity_requires_voen(self):
        payload = self.legal_payload(legal_entity={"legal_name": "Acme Ltd"})
        response = self.create_client(self.alice, payload)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_client_type_is_required(self):
        response = self.create_client(self.alice, {"status": "active"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_client_type_is_rejected(self):
        response = self.create_client(self.alice, {"client_type": "alien"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_client_type_cannot_be_changed(self):
        client_id = self.create_client(self.alice, self.legal_payload()).json()["id"]
        self.auth(self.alice)
        response = self.client.patch(
            self.client_detail_url(client_id),
            {"client_type": "individual"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ClientSoftDeleteTests(ClientAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *ALL_CLIENT_PERMISSIONS)
        self.client_a = self.create_client(self.alice, self.legal_payload()).json()

    def test_delete_soft_deletes_and_preserves_history(self):
        response = self.client.delete(self.client_detail_url(self.client_a["id"]))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        deleted = Client.objects.get(pk=self.client_a["id"])
        self.assertIsNotNone(deleted.deleted_at)
        self.assertTrue(
            ClientLegalEntity.objects.filter(client_id=deleted.id).exists()
        )

    def test_deleted_client_excluded_from_list(self):
        alive = self.create_client(self.alice, self.legal_payload(legal_entity={"legal_name": "Alive Co", "voen": "999"}))
        self.client.delete(self.client_detail_url(self.client_a["id"]))
        self.auth(self.alice)
        response = self.client.get(reverse("client-list-create"))
        ids = {row["id"] for row in response.json()}
        self.assertIn(alive.json()["id"], ids)
        self.assertNotIn(self.client_a["id"], ids)

    def test_deleted_client_detail_returns_404(self):
        self.client.delete(self.client_detail_url(self.client_a["id"]))
        self.auth(self.alice)
        response = self.client.get(self.client_detail_url(self.client_a["id"]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleted_client_nested_resources_not_manageable(self):
        self.client.delete(self.client_detail_url(self.client_a["id"]))
        self.auth(self.alice)
        address = self.client.post(
            reverse("client-address-list-create", kwargs={"pk": self.client_a["id"]}),
            {"address_type": self.address_type.id, "line1": "Main 1"},
            format="json",
        )
        self.assertEqual(address.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_and_delete_require_non_deleted_object(self):
        self.client.delete(self.client_detail_url(self.client_a["id"]))
        self.auth(self.alice)
        response = self.client.patch(
            self.client_detail_url(self.client_a["id"]),
            {"status": "inactive"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class ClientNestedResourceTests(ClientAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *ALL_CLIENT_PERMISSIONS)
        self.grant(self.carol, *ALL_CLIENT_PERMISSIONS)
        self.client_a = self.create_client(self.alice, self.legal_payload()).json()
        self.client_b = self.create_client(self.carol, self.legal_payload(legal_entity={"legal_name": "B Corp", "voen": "777"})).json()

    def address_payload(self, **overrides):
        payload = {"address_type": self.address_type.id, "line1": "Main St 1"}
        payload.update(overrides)
        return payload

    def bank_account_payload(self, **overrides):
        payload = {
            "bank": self.bank.id,
            "currency": self.currency.id,
            "iban": "AZ00TEST0000000000000000",
        }
        payload.update(overrides)
        return payload

    def test_create_and_list_address(self):
        self.auth(self.alice)
        response = self.client.post(
            reverse("client-address-list-create", kwargs={"pk": self.client_a["id"]}),
            self.address_payload(is_primary=True),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        response = self.client.get(
            reverse("client-address-list-create", kwargs={"pk": self.client_a["id"]})
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.json()), 1)

    def test_create_address_on_other_company_client_is_404(self):
        self.auth(self.alice)
        response = self.client.post(
            reverse("client-address-list-create", kwargs={"pk": self.client_b["id"]}),
            self.address_payload(),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_nested_cross_company_isolation(self):
        address = self.client.post(
            reverse("client-address-list-create", kwargs={"pk": self.client_b["id"]}),
            self.address_payload(),
            format="json",
        ).json()
        self.auth(self.alice)
        detail_url = reverse(
            "client-address-detail",
            kwargs={"pk": self.client_b["id"], "address_id": address["id"]},
        )
        self.assertEqual(
            self.client.get(detail_url).status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertEqual(
            self.client.patch(detail_url, {"line1": "x"}, format="json").status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.client.delete(detail_url).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_update_own_address_succeeds(self):
        self.auth(self.alice)
        address = self.client.post(
            reverse("client-address-list-create", kwargs={"pk": self.client_a["id"]}),
            self.address_payload(),
            format="json",
        ).json()
        detail_url = reverse(
            "client-address-detail",
            kwargs={"pk": self.client_a["id"], "address_id": address["id"]},
        )
        response = self.client.patch(detail_url, {"line1": "New St 2"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["line1"], "New St 2")

    def test_contact_crud(self):
        self.auth(self.alice)
        create_url = reverse("client-contact-list-create", kwargs={"pk": self.client_a["id"]})
        created = self.client.post(
            create_url, {"full_name": "A. Manager", "is_primary": True}, format="json"
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        detail_url = reverse(
            "client-contact-detail",
            kwargs={"pk": self.client_a["id"], "contact_id": created.json()["id"]},
        )
        updated = self.client.patch(detail_url, {"position": "CEO"}, format="json")
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        self.assertEqual(updated.json()["position"], "CEO")
        self.assertEqual(
            self.client.delete(detail_url).status_code, status.HTTP_204_NO_CONTENT
        )

    def test_bank_account_requires_currency_and_bank(self):
        self.auth(self.alice)
        url = reverse("client-bank-account-list-create", kwargs={"pk": self.client_a["id"]})
        response = self.client.post(
            url, {"iban": "AZ00TEST0000000000000000"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bank_account_crud(self):
        self.auth(self.alice)
        url = reverse("client-bank-account-list-create", kwargs={"pk": self.client_a["id"]})
        created = self.client.post(url, self.bank_account_payload(is_default=True), format="json")
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        detail_url = reverse(
            "client-bank-account-detail",
            kwargs={"pk": self.client_a["id"], "account_id": created.json()["id"]},
        )
        response = self.client.get(detail_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["currency_code"], "AZN")

    def test_bank_account_cross_company_isolation(self):
        account = self.client.post(
            reverse("client-bank-account-list-create", kwargs={"pk": self.client_b["id"]}),
            self.bank_account_payload(),
            format="json",
        ).json()
        self.auth(self.alice)
        detail_url = reverse(
            "client-bank-account-detail",
            kwargs={"pk": self.client_b["id"], "account_id": account["id"]},
        )
        self.assertEqual(self.client.get(detail_url).status_code, status.HTTP_404_NOT_FOUND)

    def test_only_one_primary_address_allowed(self):
        self.auth(self.alice)
        url = reverse("client-address-list-create", kwargs={"pk": self.client_a["id"]})
        first = self.client.post(url, self.address_payload(is_primary=True), format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        second = self.client.post(url, self.address_payload(is_primary=True), format="json")
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    def test_only_one_default_bank_account_allowed(self):
        self.auth(self.alice)
        url = reverse("client-bank-account-list-create", kwargs={"pk": self.client_a["id"]})
        first = self.client.post(url, self.bank_account_payload(is_default=True), format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        second = self.client.post(
            url,
            self.bank_account_payload(iban="AZ00TEST0000000000000001", is_default=True),
            format="json",
        )
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    def test_iban_unique_per_client(self):
        self.auth(self.alice)
        url = reverse("client-bank-account-list-create", kwargs={"pk": self.client_a["id"]})
        first = self.client.post(url, self.bank_account_payload(), format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        second = self.client.post(url, self.bank_account_payload(), format="json")
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)


class ClientValidationTests(ClientAPITestCase):
    def setUp(self):
        super().setUp()
        self.grant(self.alice, *ALL_CLIENT_PERMISSIONS)
        self.grant(self.carol, *ALL_CLIENT_PERMISSIONS)

    def test_duplicate_voen_rejected_within_company(self):
        first = self.create_client(self.alice, self.legal_payload())
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        duplicate = self.create_client(
            self.alice, self.legal_payload(legal_entity={"legal_name": "Other Ltd", "voen": "1234567890"})
        )
        self.assertEqual(duplicate.status_code, status.HTTP_400_BAD_REQUEST)

    def test_voen_unique_is_scoped_to_company(self):
        first = self.create_client(self.alice, self.legal_payload())
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        other_company = self.create_client(self.carol, self.legal_payload())
        self.assertEqual(other_company.status_code, status.HTTP_201_CREATED)

    def test_update_cannot_repoint_voen_of_other_replacing_duplicate(self):
        original = self.create_client(self.alice, self.legal_payload()).json()
        other = self.create_client(
            self.alice,
            self.legal_payload(legal_entity={"legal_name": "Other", "voen": "555000"}),
        ).json()
        self.auth(self.alice)
        response = self.client.patch(
            self.client_detail_url(original["id"]),
            {"legal_entity": {"voen": "555000"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)