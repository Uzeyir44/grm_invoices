"""
Step 6.3 — read-only Reference Data access layer.

These catalogs are shared/global application data (no ``company`` ownership —
see the models), so no tenant scoping is (or should be) applied; any
authenticated user holding ``reference_data.read`` may read the shared catalog.
The layer is strictly GET-only, returns deterministic server-side ordering, and
never fabricates catalog records — currently unseeded catalogs return an empty
list.
"""

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.authentication.api.permissions import IsCompanyMember, permission_required
from apps.reference_data.models import (
    AddressType,
    Bank,
    Currency,
    DocumentType,
    ExchangeRate,
    VatRate,
)
from apps.reference_data.api.serializers import (
    AddressTypeSerializer,
    BankSerializer,
    CurrencySerializer,
    DocumentTypeSerializer,
    ExchangeRateSerializer,
    VatRateSerializer,
)


class ReferenceDataListView(APIView):
    """
    Base read-only catalog list view. Subclasses provide a model, serializer
    and a deterministic ordering. Only ``GET`` is defined; the other HTTP
    methods are rejected by DRF with ``405 Method Not Allowed``.
    """

    permission_classes = [IsCompanyMember, permission_required("reference_data.read")]
    serializer_class = None
    model = None
    order_by = ("id",)

    def get(self, request):
        queryset = self.model.objects.all().order_by(*self.order_by)
        return Response(self.serializer_class(queryset, many=True).data)


class AddressTypeListView(ReferenceDataListView):
    serializer_class = AddressTypeSerializer
    model = AddressType
    order_by = ("code",)


class BankListView(ReferenceDataListView):
    serializer_class = BankSerializer
    model = Bank
    order_by = ("name",)


class CurrencyListView(ReferenceDataListView):
    serializer_class = CurrencySerializer
    model = Currency
    order_by = ("code",)


class DocumentTypeListView(ReferenceDataListView):
    serializer_class = DocumentTypeSerializer
    model = DocumentType
    order_by = ("code",)


class VatRateListView(ReferenceDataListView):
    serializer_class = VatRateSerializer
    model = VatRate
    order_by = ("name", "valid_from")


class ExchangeRateListView(ReferenceDataListView):
    serializer_class = ExchangeRateSerializer
    model = ExchangeRate
    order_by = ("effective_at", "id")