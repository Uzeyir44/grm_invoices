from django.urls import path

from apps.clients.api.views import (
    ClientAddressDetailView,
    ClientAddressListCreateView,
    ClientBankAccountDetailView,
    ClientBankAccountListCreateView,
    ClientContactDetailView,
    ClientContactListCreateView,
    ClientDetailView,
    ClientListCreateView,
)

urlpatterns = [
    path("", ClientListCreateView.as_view(), name="client-list-create"),
    path("<int:pk>/", ClientDetailView.as_view(), name="client-detail"),
    path(
        "<int:pk>/addresses/",
        ClientAddressListCreateView.as_view(),
        name="client-address-list-create",
    ),
    path(
        "<int:pk>/addresses/<int:address_id>/",
        ClientAddressDetailView.as_view(),
        name="client-address-detail",
    ),
    path(
        "<int:pk>/contacts/",
        ClientContactListCreateView.as_view(),
        name="client-contact-list-create",
    ),
    path(
        "<int:pk>/contacts/<int:contact_id>/",
        ClientContactDetailView.as_view(),
        name="client-contact-detail",
    ),
    path(
        "<int:pk>/bank-accounts/",
        ClientBankAccountListCreateView.as_view(),
        name="client-bank-account-list-create",
    ),
    path(
        "<int:pk>/bank-accounts/<int:account_id>/",
        ClientBankAccountDetailView.as_view(),
        name="client-bank-account-detail",
    ),
]