from django.urls import path

from apps.reference_data.api.views import (
    AddressTypeListView,
    BankListView,
    CurrencyListView,
    DocumentTypeListView,
    ExchangeRateListView,
    VatRateListView,
)

urlpatterns = [
    path(
        "address-types/",
        AddressTypeListView.as_view(),
        name="reference-address-type-list",
    ),
    path("banks/", BankListView.as_view(), name="reference-bank-list"),
    path("currencies/", CurrencyListView.as_view(), name="reference-currency-list"),
    path(
        "document-types/",
        DocumentTypeListView.as_view(),
        name="reference-document-type-list",
    ),
    path("vat-rates/", VatRateListView.as_view(), name="reference-vat-rate-list"),
    path(
        "exchange-rates/",
        ExchangeRateListView.as_view(),
        name="reference-exchange-rate-list",
    ),
]