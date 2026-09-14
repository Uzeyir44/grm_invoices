"""
Writable serializers for System Admin reference-data administration.

Reference data is global application data (never tenant-owned), so no
``company_id`` is exposed anywhere. Validation mirrors the existing model and
database constraints:

* ``Currency.code`` / ``DocumentType.code`` / ``AddressType.code`` are unique
  (``UniqueValidator`` from the model field).
* ``VatRate`` uses half-open date ranges and blocks overlapping periods for the
  same name — validated here for a clear field error; the PostgreSQL
  ``ExclusionConstraint`` remains the authoritative backstop.
* ``Bank.is_active`` is read-only here; activation is a dedicated operation.
"""

import datetime

from rest_framework import serializers

from apps.reference_data.models import (
    AddressType,
    Bank,
    Currency,
    DocumentType,
    ExchangeRate,
    VatRate,
)


class AdminCurrencySerializer(serializers.ModelSerializer):
    class Meta:
        model = Currency
        fields = ["id", "code", "name", "minor_unit"]

    def validate_minor_unit(self, value):
        if value is not None and (value < 0 or value > 4):
            raise serializers.ValidationError(
                "Minor unit must be between 0 and 4 decimal places."
            )
        return value


class AdminDocumentTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentType
        fields = ["id", "code", "name"]


class AdminAddressTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = AddressType
        fields = ["id", "code"]


class AdminVatRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = VatRate
        fields = ["id", "name", "rate_percent", "valid_from", "valid_to"]

    def validate_rate_percent(self, value):
        if value is not None and (value < 0 or value > 100):
            raise serializers.ValidationError(
                "VAT rate must be between 0 and 100 percent."
            )
        return value

    def validate(self, attrs):
        name = attrs.get("name")
        valid_from = attrs.get("valid_from")
        valid_to = attrs.get("valid_to")

        if self.instance is not None:
            if name is None:
                name = self.instance.name
            if valid_from is None:
                valid_from = self.instance.valid_from
            if valid_to is None:
                valid_to = self.instance.valid_to

        if valid_from is not None and valid_to is not None:
            if valid_to <= valid_from:
                raise serializers.ValidationError(
                    {"valid_to": "valid_to must be after valid_from (half-open range)."}
                )

        if name and valid_from is not None:
            queryset = VatRate.objects.filter(name=name)
            if self.instance is not None:
                queryset = queryset.exclude(pk=self.instance.pk)
            new_to = valid_to or datetime.date.max
            for other in queryset:
                other_to = other.valid_to or datetime.date.max
                # Half-open overlap: [from, to) intersects [other_from, other_to).
                if valid_from < other_to and other.valid_from < new_to:
                    raise serializers.ValidationError(
                        {
                            "valid_from": (
                                "A VAT rate with this name already covers an "
                                "overlapping period."
                            )
                        }
                    )
        return attrs


class AdminBankSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bank
        fields = ["id", "name", "swift_code", "is_active"]
        read_only_fields = ["id", "is_active"]


class AdminExchangeRateSerializer(serializers.ModelSerializer):
    """Read-only: exchange rates are a shared feed, not an admin catalog."""

    from_currency_id = serializers.IntegerField(read_only=True)
    to_currency_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = ExchangeRate
        fields = ["id", "from_currency_id", "to_currency_id", "rate", "effective_at"]
        read_only_fields = fields
