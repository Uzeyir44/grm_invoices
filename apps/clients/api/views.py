from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.authentication.api.permissions import IsCompanyMember, permission_required
from apps.authentication.tenant import get_tenant_object_or_404, tenant_queryset
from apps.audit_logs.services import (
    create_audit_log,
    diff_snapshots,
    request_metadata,
)
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


def _client_snapshot(client):
    """
    Small meaningful business snapshot of a client for audit events: type,
    status, display name and the primary contact's email/phone. No internal
    ORM state, no subtype identifiers of a sensitive nature.
    """
    if client is None:
        return None
    name = None
    if client.client_type == Client.ClientType.LEGAL_ENTITY:
        legal = getattr(client, "legal_entity", None)
        name = legal.legal_name if legal is not None else None
    else:
        individual = getattr(client, "individual", None)
        if individual is not None:
            name = (
                " ".join(
                    p
                    for p in (
                        individual.first_name,
                        individual.middle_name,
                        individual.last_name,
                    )
                    if p
                )
                or None
            )
    contact = client.contacts.filter(is_primary=True).first()
    return {
        "client_type": client.client_type,
        "status": client.status,
        "name": name,
        "email": contact.email if contact else None,
        "phone": contact.phone if contact else None,
    }


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
        # The whole logical create (base Client row + subtype + audit event)
        # runs in one transaction: a subtype or audit failure rolls back the
        # base Client row so no partial client can remain.
        with transaction.atomic():
            serializer.save(company=request.user.company)
            client = serializer.instance
            meta = request_metadata(request)
            create_audit_log(
                company=client.company,
                user=request.user,
                action="create",
                entity_type="client",
                entity_id=client.id,
                previous_values=None,
                new_values=_client_snapshot(client),
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
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
        # Snapshot from a separate fetch so accessing the OneToOne subtype on
        # the fetched ``client`` (which caches on that instance) does not make
        # the serializer below return stale values.
        before = _client_snapshot(
            Client.objects.select_related("legal_entity", "individual").get(
                pk=client.pk
            )
        )
        serializer = ClientSerializer(
            client,
            data=request.data,
            partial=True,
            context={"request": request, "company": request.user.company},
        )
        serializer.is_valid(raise_exception=True)
        # The whole logical update (base Client row + subtype + audit event)
        # runs in one transaction: a subtype or audit failure rolls back the
        # base Client change so no partial update can remain.
        with transaction.atomic():
            serializer.save()
            after = _client_snapshot(
                Client.objects.get(pk=serializer.instance.pk)
            )
            previous, new = diff_snapshots(before, after)
            if previous or new:
                meta = request_metadata(request)
                create_audit_log(
                    company=client.company,
                    user=request.user,
                    action="update",
                    entity_type="client",
                    entity_id=client.id,
                    previous_values=previous,
                    new_values=new,
                    ip_address=meta["ip_address"],
                    user_agent=meta["user_agent"],
                )
        return Response(
            ClientSerializer(
                serializer.instance,
                context={"request": request, "company": request.user.company},
            ).data
        )

    def delete(self, request, pk):
        client = client_object_or_404(request, pk)
        before = _client_snapshot(client)
        client.deleted_at = timezone.now()
        client.save(update_fields=["deleted_at"])
        meta = request_metadata(request)
        create_audit_log(
            company=client.company,
            user=request.user,
            action="deactivate",
            entity_type="client",
            entity_id=client.id,
            previous_values=before,
            new_values=None,
            ip_address=meta["ip_address"],
            user_agent=meta["user_agent"],
        )
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