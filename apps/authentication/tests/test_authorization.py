"""
Authorization & tenant-isolation tests for the reusable authorization
foundation (apps.authentication.tenant / .rbac / api.permissions).

The small client views defined below are TEST-ONLY fixtures: they exist to
exercise the tenant/RBAC primitives over a real tenant-owned model
(apps.clients.Client). They are intentionally NOT part of the production
URLconf — a full Client API is a separate, later step.
"""

from django.db import ProgrammingError, transaction
from django.http import Http404

from rest_framework import status
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, APITestCase, force_authenticate
from rest_framework.views import APIView

from apps.authentication.api.permissions import (
    IsCompanyMember,
    IsSameCompanyObject,
    permission_required,
)
from apps.authentication.models import Permission, Role, UserRole
from apps.authentication.rbac import permission_codes_for, user_has_permission
from apps.authentication.tenant import (
    belongs_to_company,
    get_tenant_object_or_404,
    tenant_queryset,
)
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.clients.models import Client
from apps.companies.models import Company

CLIENT_PAYLOAD_FIELDS = ("id", "company_id", "client_type", "status")


def client_payload(client):
    return {field: getattr(client, field) for field in CLIENT_PAYLOAD_FIELDS}


class ClientListCreateView(APIView):
    """Test-only: list/create tenant-scoped clients via the foundation helpers."""

    permission_classes = [IsCompanyMember]

    def get(self, request):
        clients = tenant_queryset(Client, request.user.company)
        return Response([client_payload(c) for c in clients])

    def post(self, request):
        company = request.user.company
        client = Client.objects.create(
            company=company,
            client_type=request.data.get(
                "client_type", Client.ClientType.LEGAL_ENTITY
            ),
        )
        return Response(client_payload(client), status=status.HTTP_201_CREATED)


class ClientDetailView(APIView):
    """Test-only: object-level read/update/delete with tenant scoping."""

    permission_classes = [IsCompanyMember]

    def get(self, request, pk):
        client = get_tenant_object_or_404(Client, request.user.company, pk=pk)
        return Response(client_payload(client))

    def patch(self, request, pk):
        client = get_tenant_object_or_404(Client, request.user.company, pk=pk)
        new_status = request.data.get("status")
        if new_status:
            client.status = new_status
            client.save(update_fields=["status"])
        return Response(client_payload(client))

    def delete(self, request, pk):
        client = get_tenant_object_or_404(Client, request.user.company, pk=pk)
        client.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProtectedEchoView(APIView):
    """Test-only: a single RBAC-protected endpoint."""

    permission_classes = [permission_required("clients.read")]

    def get(self, request):
        return Response({"ok": True, "company_id": request.user.company_id})


def make_reader_role(name, company=None, *codes):
    role = Role.objects.create(name=name, company=company)
    for code in codes:
        permission, _ = Permission.objects.get_or_create(
            code=code, defaults={"description": code}
        )
        role.permissions.add(permission)
    return role


class AuthorizationTestCase(APITestCase):
    def setUp(self):
        self.company_a = make_company()
        self.company_b = make_company()
        self.alice = make_user(self.company_a, email="alice@example.com")
        self.carol = make_user(self.company_b, email="carol@example.com")
        self.client_a1 = Client.objects.create(
            company=self.company_a, client_type=Client.ClientType.LEGAL_ENTITY
        )
        self.client_a2 = Client.objects.create(
            company=self.company_a, client_type=Client.ClientType.INDIVIDUAL
        )
        self.client_b1 = Client.objects.create(
            company=self.company_b, client_type=Client.ClientType.LEGAL_ENTITY
        )


class TenantHelpersTests(AuthorizationTestCase):
    def test_tenant_queryset_returns_only_own_company_rows(self):
        self.assertEqual(
            {c.id for c in tenant_queryset(Client, self.company_a)},
            {self.client_a1.id, self.client_a2.id},
        )
        self.assertEqual(
            {c.id for c in tenant_queryset(Client, self.company_b)},
            {self.client_b1.id},
        )

    def test_get_tenant_object_or_404_returns_own_object(self):
        client = get_tenant_object_or_404(
            Client, self.company_a, pk=self.client_a1.id
        )
        self.assertEqual(client.id, self.client_a1.id)

    def test_get_tenant_object_or_404_404_for_other_company(self):
        with self.assertRaises(Http404):
            get_tenant_object_or_404(Client, self.company_a, pk=self.client_b1.id)

    def test_get_tenant_object_or_404_404_for_missing_object(self):
        with self.assertRaises(Http404):
            get_tenant_object_or_404(Client, self.company_a, pk=999999)

    def test_get_tenant_object_or_404_ignores_lookup_company_id(self):
        with self.assertRaises(Http404):
            get_tenant_object_or_404(
                Client, self.company_a, pk=self.client_b1.id, company_id=self.company_b.id
            )

    def test_belongs_to_company(self):
        self.assertTrue(belongs_to_company(self.company_a, self.client_a1))
        self.assertFalse(belongs_to_company(self.company_a, self.client_b1))
        self.assertTrue(belongs_to_company(self.company_b, self.client_b1))


class TenantIsolationViewTests(AuthorizationTestCase):
    def setUp(self):
        super().setUp()
        self.factory = APIRequestFactory()
        self.list_view = ClientListCreateView.as_view()
        self.detail_view = ClientDetailView.as_view()

    def call(self, view, user, method, path="/", pk=None, data=None):
        kwargs = path.replace("/", "")
        request = getattr(self.factory, method)(f"/{kwargs}", data=data or {}, format="json")
        force_authenticate(request, user=user)
        if pk is not None:
            return view(request, pk=pk)
        return view(request)

    def test_request_user_company_is_authoritative(self):
        response = self.call(self.list_view, self.alice, "get")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            all(row["company_id"] == self.company_a.id for row in response.data)
        )
        self.assertEqual({row["id"] for row in response.data},
                         {self.client_a1.id, self.client_a2.id})

    def test_read_isolation_other_company_returns_404(self):
        response = self.call(self.detail_view, self.alice, "get", pk=self.client_b1.id)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_read_isolation_own_company_returns_object(self):
        response = self.call(self.detail_view, self.alice, "get", pk=self.client_a1.id)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["company_id"], self.company_a.id)

    def test_cross_company_404_indistinguishable_from_missing(self):
        cross = self.call(self.detail_view, self.alice, "get", pk=self.client_b1.id)
        missing = self.call(self.detail_view, self.alice, "get", pk=999999)
        self.assertEqual(cross.status_code, missing.status_code)
        self.assertEqual(cross.status_code, status.HTTP_404_NOT_FOUND)

    def test_create_assigns_authenticated_company(self):
        response = self.call(
            self.list_view, self.alice, "post", data={"client_type": "legal_entity"}
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created = Client.objects.get(pk=response.data["id"])
        self.assertEqual(created.company_id, self.company_a.id)

    def test_create_ignores_client_supplied_company_id(self):
        response = self.call(
            self.list_view,
            self.alice,
            "post",
            data={"client_type": "legal_entity", "company_id": self.company_b.id},
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["company_id"], self.company_a.id)
        created = Client.objects.get(pk=response.data["id"])
        self.assertEqual(created.company_id, self.company_a.id)

    def test_update_own_object_succeeds(self):
        response = self.call(
            self.detail_view,
            self.alice,
            "patch",
            pk=self.client_a1.id,
            data={"status": "inactive"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "inactive")

    def test_update_other_company_object_returns_404(self):
        response = self.call(
            self.detail_view,
            self.alice,
            "patch",
            pk=self.client_b1.id,
            data={"status": "inactive"},
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_cannot_change_company(self):
        response = self.call(
            self.detail_view,
            self.alice,
            "patch",
            pk=self.client_a1.id,
            data={"company_id": self.company_b.id, "status": "active"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["company_id"], self.company_a.id)
        self.client_a1.refresh_from_db()
        self.assertEqual(self.client_a1.company_id, self.company_a.id)

    def test_delete_own_object_succeeds(self):
        response = self.call(self.detail_view, self.alice, "delete", pk=self.client_a2.id)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Client.objects.filter(pk=self.client_a2.id).exists())

    def test_delete_other_company_object_returns_404(self):
        response = self.call(self.detail_view, self.alice, "delete", pk=self.client_b1.id)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Client.objects.filter(pk=self.client_b1.id).exists())

    def test_unauthenticated_requests_are_rejected(self):
        request = self.factory.get("/clients")
        response = self.list_view(request)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class RbacTests(AuthorizationTestCase):
    def setUp(self):
        super().setUp()
        self.factory = APIRequestFactory()
        self.echo_view = ProtectedEchoView.as_view()

    def call_echo(self, user=None):
        request = self.factory.get("/protected")
        if user is not None:
            force_authenticate(request, user=user)
        return self.echo_view(request)

    def test_rbac_denies_without_permission(self):
        response = self.call_echo(self.alice)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_rbac_denies_unauthenticated(self):
        response = self.call_echo()
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_rbac_allows_global_role_in_any_company(self):
        make_reader_role("Global Reader", None, "clients.read")
        UserRole.objects.create(user=self.alice, role=Role.objects.get(name="Global Reader"))
        response = self.call_echo(self.alice)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["company_id"], self.company_a.id)

    def test_permission_codes_include_global_role(self):
        make_reader_role("Global Reader", None, "clients.read")
        UserRole.objects.create(user=self.alice, role=Role.objects.get(name="Global Reader"))
        self.assertTrue(user_has_permission(self.alice, "clients.read"))
        self.assertIn("clients.read", permission_codes_for(self.alice))
        self.assertTrue(user_has_permission(self.alice, "clients.read"))

    def test_company_specific_role_grants_within_own_company(self):
        make_reader_role("A Reader", self.company_a, "clients.read")
        UserRole.objects.create(user=self.alice, role=Role.objects.get(name="A Reader"))
        response = self.call_echo(self.alice)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_company_specific_role_does_not_leak_to_other_company(self):
        make_reader_role("A Reader", self.company_a, "clients.read")
        UserRole.objects.create(user=self.alice, role=Role.objects.get(name="A Reader"))
        self.assertFalse(user_has_permission(self.carol, "clients.read"))
        self.assertNotIn("clients.read", permission_codes_for(self.carol))
        response = self.call_echo(self.carol)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_cannot_assign_cross_company_role(self):
        role_a = make_reader_role("A Reader", self.company_a, "clients.read")
        with self.assertRaises(ProgrammingError):
            with transaction.atomic():
                UserRole.objects.create(user=self.carol, role=role_a)
        self.assertFalse(user_has_permission(self.carol, "clients.read"))


class ObjectLevelPermissionTests(AuthorizationTestCase):
    def setUp(self):
        super().setUp()
        self.factory = APIRequestFactory()
        self.permission = IsSameCompanyObject()

    def request_for(self, user):
        request = self.factory.get("/")
        request.user = user
        return request

    def test_object_permission_allows_own_company(self):
        self.assertTrue(
            self.permission.has_object_permission(
                self.request_for(self.alice), None, self.client_a1
            )
        )

    def test_object_permission_denies_other_company(self):
        self.assertFalse(
            self.permission.has_object_permission(
                self.request_for(self.alice), None, self.client_b1
            )
        )

    def test_object_permission_denies_unauthenticated(self):
        request = self.factory.get("/")
        self.assertFalse(
            self.permission.has_object_permission(request, None, self.client_a1)
        )


class IsCompanyMemberTests(AuthorizationTestCase):
    def setUp(self):
        super().setUp()
        self.factory = APIRequestFactory()
        self.permission = IsCompanyMember()

    def request_for(self, user):
        request = self.factory.get("/")
        request.user = user
        return request

    def test_allows_active_company_member(self):
        self.assertTrue(self.permission.has_permission(self.request_for(self.alice), None))

    def test_denies_suspended_company_member(self):
        self.company_a.status = Company.Status.SUSPENDED
        self.company_a.save(update_fields=["status"])
        self.assertFalse(self.permission.has_permission(self.request_for(self.alice), None))

    def test_denies_unauthenticated(self):
        request = self.factory.get("/")
        self.assertFalse(self.permission.has_permission(request, None))

    def test_denies_inactive_user(self):
        self.alice.is_active = False
        self.alice.save(update_fields=["is_active"])
        self.assertFalse(self.permission.has_permission(self.request_for(self.alice), None))

    def test_permission_required_factory_returns_permission_subclass(self):
        cls = permission_required("anything.some")
        self.assertTrue(issubclass(cls, BasePermission))
        self.assertTrue(callable(cls().has_permission))