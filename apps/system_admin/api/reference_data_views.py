"""
System Admin reference-data administration API.

Reference data is global (not tenant-owned), so these endpoints are the only
catalog-mutating surface and are gated by ``system.reference.manage``. CRUD is
model-specific:

* Currency / DocumentType / AddressType / VatRate — create, update, delete
  (delete is refused by the database ``PROTECT`` FK when referenced, surfaced as
  a 400).
* Bank — create, update, activate/deactivate (no delete; ``is_active`` is the
  existing lifecycle concept and client bank accounts ``PROTECT`` banks).
* ExchangeRate — read-only (a shared feed, not an admin-maintained catalog).

Every mutation writes a platform audit event via ``create_platform_audit_log``;
reference data is global, so no ``target_company_id`` is recorded.
"""

from django.db import IntegrityError
from django.db.models import ProtectedError
from django.shortcuts import get_object_or_404

from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit_logs.services import diff_snapshots, request_metadata
from apps.reference_data.models import (
    AddressType,
    Bank,
    Currency,
    DocumentType,
    ExchangeRate,
    VatRate,
)
from apps.system_admin.api.reference_data_serializers import (
    AdminAddressTypeSerializer,
    AdminBankSerializer,
    AdminCurrencySerializer,
    AdminDocumentTypeSerializer,
    AdminExchangeRateSerializer,
    AdminVatRateSerializer,
)
from apps.system_admin.audit import create_platform_audit_log
from apps.system_admin.authentication import SystemAdminJWTAuthentication
from apps.system_admin.constants import REFERENCE_MANAGE_PERMISSION
from apps.system_admin.permissions import system_permission_required


class AdminReferenceDataMixin:
    """
    Shared admin boundary + audit hooks for reference-data views.

    ``perform_create`` / ``perform_update`` / ``perform_destroy`` are provided
    for the DRF generic views that use them; unused ones are simply not called.
    """

    authentication_classes = [SystemAdminJWTAuthentication]
    permission_classes = [system_permission_required(REFERENCE_MANAGE_PERMISSION)]
    entity_type = None

    def handle_exception(self, exc):
        if isinstance(exc, ProtectedError):
            return Response(
                {"detail": "This record is in use and cannot be deleted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if isinstance(exc, IntegrityError):
            return Response(
                {"detail": "The submitted data conflicts with existing records."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().handle_exception(exc)

    def _audit(self, action, entity_id, previous_values=None, new_values=None):
        meta = request_metadata(self.request)
        create_platform_audit_log(
            user=self.request.user,
            action=action,
            entity_type=self.entity_type,
            entity_id=entity_id,
            previous_values=previous_values,
            new_values=new_values,
            ip_address=meta["ip_address"],
            user_agent=meta["user_agent"],
        )

    def perform_create(self, serializer):
        instance = serializer.save()
        self._audit("reference_data.create", instance.pk, new_values=serializer.data)

    def perform_update(self, serializer):
        before = self.get_serializer(serializer.instance).data
        instance = serializer.save()
        after = self.get_serializer(instance).data
        previous, new = diff_snapshots(before, after)
        if previous or new:
            self._audit("reference_data.update", instance.pk, previous, new)

    def perform_destroy(self, instance):
        entity_id = instance.pk
        snapshot = self.get_serializer(instance).data
        instance.delete()
        self._audit("reference_data.delete", entity_id, previous_values=snapshot)


# --------------------------------------------------------------------------
# Currencies
# --------------------------------------------------------------------------
class AdminCurrencyListCreateView(
    AdminReferenceDataMixin, generics.ListCreateAPIView
):
    queryset = Currency.objects.all().order_by("code", "id")
    serializer_class = AdminCurrencySerializer
    entity_type = "currency"


class AdminCurrencyDetailView(
    AdminReferenceDataMixin, generics.RetrieveUpdateDestroyAPIView
):
    queryset = Currency.objects.all()
    serializer_class = AdminCurrencySerializer
    entity_type = "currency"


# --------------------------------------------------------------------------
# Document types
# --------------------------------------------------------------------------
class AdminDocumentTypeListCreateView(
    AdminReferenceDataMixin, generics.ListCreateAPIView
):
    queryset = DocumentType.objects.all().order_by("code", "id")
    serializer_class = AdminDocumentTypeSerializer
    entity_type = "document_type"


class AdminDocumentTypeDetailView(
    AdminReferenceDataMixin, generics.RetrieveUpdateDestroyAPIView
):
    queryset = DocumentType.objects.all()
    serializer_class = AdminDocumentTypeSerializer
    entity_type = "document_type"


# --------------------------------------------------------------------------
# Address types
# --------------------------------------------------------------------------
class AdminAddressTypeListCreateView(
    AdminReferenceDataMixin, generics.ListCreateAPIView
):
    queryset = AddressType.objects.all().order_by("code", "id")
    serializer_class = AdminAddressTypeSerializer
    entity_type = "address_type"


class AdminAddressTypeDetailView(
    AdminReferenceDataMixin, generics.RetrieveUpdateDestroyAPIView
):
    queryset = AddressType.objects.all()
    serializer_class = AdminAddressTypeSerializer
    entity_type = "address_type"


# --------------------------------------------------------------------------
# VAT rates
# --------------------------------------------------------------------------
class AdminVatRateListCreateView(
    AdminReferenceDataMixin, generics.ListCreateAPIView
):
    queryset = VatRate.objects.all().order_by("name", "valid_from", "id")
    serializer_class = AdminVatRateSerializer
    entity_type = "vat_rate"


class AdminVatRateDetailView(
    AdminReferenceDataMixin, generics.RetrieveUpdateDestroyAPIView
):
    queryset = VatRate.objects.all()
    serializer_class = AdminVatRateSerializer
    entity_type = "vat_rate"


# --------------------------------------------------------------------------
# Banks (create/update + activate/deactivate; no delete)
# --------------------------------------------------------------------------
class AdminBankListCreateView(
    AdminReferenceDataMixin, generics.ListCreateAPIView
):
    queryset = Bank.objects.all().order_by("name", "id")
    serializer_class = AdminBankSerializer
    entity_type = "bank"


class AdminBankDetailView(
    AdminReferenceDataMixin, generics.RetrieveUpdateAPIView
):
    queryset = Bank.objects.all()
    serializer_class = AdminBankSerializer
    entity_type = "bank"


class AdminBankLifecycleView(AdminReferenceDataMixin, APIView):
    entity_type = "bank"
    target_active = None
    audit_action = None

    def post(self, request, pk):
        bank = get_object_or_404(Bank, pk=pk)
        if bank.is_active != self.target_active:
            previous = bank.is_active
            bank.is_active = self.target_active
            bank.save(update_fields=["is_active"])
            self._audit(
                self.audit_action,
                bank.pk,
                previous_values={"is_active": previous},
                new_values={"is_active": bank.is_active},
            )
        return Response(AdminBankSerializer(bank).data)


class AdminBankActivateView(AdminBankLifecycleView):
    target_active = True
    audit_action = "reference_data.activate"


class AdminBankDeactivateView(AdminBankLifecycleView):
    target_active = False
    audit_action = "reference_data.deactivate"


# --------------------------------------------------------------------------
# Exchange rates (read-only feed)
# --------------------------------------------------------------------------
class AdminExchangeRateListView(
    AdminReferenceDataMixin, generics.ListAPIView
):
    queryset = ExchangeRate.objects.all().order_by("effective_at", "id")
    serializer_class = AdminExchangeRateSerializer
    entity_type = "exchange_rate"
