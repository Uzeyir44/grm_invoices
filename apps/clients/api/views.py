from django.db import IntegrityError
from django.db.models import Q
from django.utils import timezone

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.authentication.api.permissions import IsCompanyMember, permission_required
from apps.authentication.tenant import get_tenant_object_or_404, tenant_queryset
from apps.clients.api.serializers import (
    ClientAddressSerializer,
    ClientBankAccountSerializer,
    ClientContactSerializer,
    ClientSerializer,
    ClientSummarySerializer,
)
from apps.clients.models import (
    Client,
    ClientAddress,
    ClientBankAccount,
    ClientContact,
)


class MethodPermissionAPIView(APIView):
    """
    Base view that requires a company member and, per HTTP method, a specific
    RBAC permission code through the existing permission_required(...) factory.
    """

    permission_classes = [IsCompanyMember]
    method_permissions = {}

    def get_permissions(self):
        permissions = super().get_permissions()
        code = self.method_permissions.get(self.request.method)
        if code:
            permissions.append(permission_required(code)())
        return permissions

    def handle_exception(self, exc):
        if isinstance(exc, IntegrityError):
            # The DB is the final integrity layer; surface constraint
            # conflicts as client errors rather than 500s.
            return Response(
                {"detail": "The submitted data conflicts with existing client records."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().handle_exception(exc)


def client_object_or_404(request, pk):
    """Tenant-scoped, non-soft-deleted client lookup (Rule D)."""
    return get_tenant_object_or_404(
        Client, request.user.company, pk=pk, deleted_at__isnull=True
    )


def child_queryset(request, model, client):
    """Child rows of ``client`` scoped to the caller's company."""
    return tenant_queryset(model, request.user.company).filter(client_id=client.id)


class ClientListCreateView(MethodPermissionAPIView):
    method_permissions = {"GET": "clients.read", "POST": "clients.create"}

    def get(self, request):
        queryset = tenant_queryset(Client, request.user.company).filter(
            deleted_at__isnull=True
        )
        client_type = request.query_params.get("client_type")
        if client_type:
            queryset = queryset.filter(client_type=client_type)
        client_status = request.query_params.get("status")
        if client_status:
            queryset = queryset.filter(status=client_status)
        search = (request.query_params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(legal_entity__legal_name__icontains=search)
                | Q(individual__first_name__icontains=search)
                | Q(individual__last_name__icontains=search)
            )
        serializer = ClientSummarySerializer(queryset, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = ClientSerializer(
            data=request.data,
            context={"request": request, "company": request.user.company},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(company=request.user.company)
        return Response(
            ClientSerializer(
                serializer.instance,
                context={"request": request, "company": request.user.company},
            ).data,
            status=status.HTTP_201_CREATED,
        )


class ClientDetailView(MethodPermissionAPIView):
    method_permissions = {
        "GET": "clients.read",
        "PATCH": "clients.update",
        "DELETE": "clients.delete",
    }

    def get(self, request, pk):
        client = client_object_or_404(request, pk)
        serializer = ClientSerializer(
            client, context={"request": request, "company": request.user.company}
        )
        return Response(serializer.data)

    def patch(self, request, pk):
        client = client_object_or_404(request, pk)
        serializer = ClientSerializer(
            client,
            data=request.data,
            partial=True,
            context={"request": request, "company": request.user.company},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            ClientSerializer(
                serializer.instance,
                context={"request": request, "company": request.user.company},
            ).data
        )

    def delete(self, request, pk):
        client = client_object_or_404(request, pk)
        client.deleted_at = timezone.now()
        client.save(update_fields=["deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClientNestedListCreateView(MethodPermissionAPIView):
    """
    Base for client-child collections (addresses/contacts/bank accounts).
    Both the parent client and the child rows are tenant-scoped; child rows
    are additionally bound to the parent client.
    """

    model = None
    serializer_class = None
    method_permissions = {"GET": "clients.read", "POST": "clients.update"}

    def get(self, request, pk):
        client = client_object_or_404(request, pk)
        serializer = self.serializer_class(
            child_queryset(request, self.model, client), many=True
        )
        return Response(serializer.data)

    def post(self, request, pk):
        client = client_object_or_404(request, pk)
        serializer = self.serializer_class(
            data=request.data, context={"request": request, "client": client}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(client=client, company=client.company)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ClientAddressListCreateView(ClientNestedListCreateView):
    model = ClientAddress
    serializer_class = ClientAddressSerializer


class ClientContactListCreateView(ClientNestedListCreateView):
    model = ClientContact
    serializer_class = ClientContactSerializer


class ClientBankAccountListCreateView(ClientNestedListCreateView):
    model = ClientBankAccount
    serializer_class = ClientBankAccountSerializer


class ClientNestedDetailView(MethodPermissionAPIView):
    """
    Base for single child objects. The child must belong to the caller's
    company AND to the parent client; anything else resolves to 404.
    """

    model = None
    serializer_class = None
    child_kwarg = "child_id"
    method_permissions = {
        "GET": "clients.read",
        "PATCH": "clients.update",
        "DELETE": "clients.update",
    }

    def _child(self, request, pk, child_id):
        client = client_object_or_404(request, pk)
        child = get_tenant_object_or_404(
            self.model, request.user.company, pk=child_id, client_id=client.id
        )
        return child, client

    def get(self, request, pk, **kwargs):
        child, _client = self._child(request, pk, kwargs[self.child_kwarg])
        return Response(self.serializer_class(child).data)

    def patch(self, request, pk, **kwargs):
        child, client = self._child(request, pk, kwargs[self.child_kwarg])
        serializer = self.serializer_class(
            child,
            data=request.data,
            partial=True,
            context={"request": request, "client": client},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk, **kwargs):
        child, _client = self._child(request, pk, kwargs[self.child_kwarg])
        child.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClientAddressDetailView(ClientNestedDetailView):
    model = ClientAddress
    serializer_class = ClientAddressSerializer
    child_kwarg = "address_id"


class ClientContactDetailView(ClientNestedDetailView):
    model = ClientContact
    serializer_class = ClientContactSerializer
    child_kwarg = "contact_id"


class ClientBankAccountDetailView(ClientNestedDetailView):
    model = ClientBankAccount
    serializer_class = ClientBankAccountSerializer
    child_kwarg = "account_id"