"""
Read-only serializers for the Reference Data (Step 6.3) access layer.

Explicit field lists only — no model internals, related objects beyond compact
foreign-key identifiers, or write fields. All fields are read-only; reference
data can never be created/edited through these serializers.
"""

from rest_framework import serializers

from apps.reference_data.models import (
    AddressType,
    Bank,
    Currency,
    DocumentType,
    ExchangeRate,
    VatRate,
)


class AddressTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = AddressType
        fields = ["id", "code"]
        read_only_fields = fields


class BankSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bank
        fields = ["id", "name", "swift_code", "is_active"]
        read_only_fields = fields


class CurrencySerializer(serializers.ModelSerializer):
    class Meta:
        model = Currency
        fields = ["id", "code", "name", "minor_unit"]
        read_only_fields = fields


class DocumentTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentType
        fields = ["id", "code", "name"]
        read_only_fields = fields


class VatRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = VatRate
        fields = ["id", "name", "rate_percent", "valid_from", "valid_to"]
        read_only_fields = fields


class ExchangeRateSerializer(serializers.ModelSerializer):
    """Exchange rates expose only the currency pair as compact IDs."""

    from_currency_id = serializers.IntegerField(read_only=True)
    to_currency_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = ExchangeRate
        fields = ["id", "from_currency_id", "to_currency_id", "rate", "effective_at"]
        read_only_fields = fields