from rest_framework import serializers

from apps.clients.models import (
    Client,
    ClientAddress,
    ClientBankAccount,
    ClientContact,
    ClientIndividual,
    ClientLegalEntity,
)


class ClientIndividualSerializer(serializers.ModelSerializer):
    """
    Fields of the individual subtype.

    identification_number_encrypted / _hash are deliberately NOT exposed:
    the identification number is stored application-encrypted (plus a keyed
    HMAC lookup hash) per the architecture, and that encryption layer is not
    part of this step.
    """

    class Meta:
        model = ClientIndividual
        fields = ["first_name", "last_name", "middle_name", "date_of_birth"]


class ClientLegalEntitySerializer(serializers.ModelSerializer):
    class Meta:
        model = ClientLegalEntity
        fields = [
            "legal_name",
            "trading_name",
            "voen",
            "registration_number",
            "registration_date",
        ]


class ClientAddressSerializer(serializers.ModelSerializer):
    address_type_code = serializers.CharField(source="address_type.code", read_only=True)

    class Meta:
        model = ClientAddress
        fields = [
            "id",
            "address_type",
            "address_type_code",
            "line1",
            "line2",
            "city",
            "region",
            "postal_code",
            "country_code",
            "is_primary",
        ]

    def validate(self, attrs):
        client = self.context.get("client")
        if client is not None and attrs.get("is_primary"):
            queryset = ClientAddress.objects.filter(
                client_id=client.id, is_primary=True
            )
            if self.instance is not None:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError(
                    {"is_primary": "This client already has a primary address."}
                )
        return attrs


class ClientContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClientContact
        fields = [
            "id",
            "full_name",
            "position",
            "phone",
            "email",
            "is_primary",
        ]

    def validate(self, attrs):
        client = self.context.get("client")
        if client is not None and attrs.get("is_primary"):
            queryset = ClientContact.objects.filter(client_id=client.id, is_primary=True)
            if self.instance is not None:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError(
                    {"is_primary": "This client already has a primary contact."}
                )
        return attrs


class ClientBankAccountSerializer(serializers.ModelSerializer):
    bank_name = serializers.CharField(source="bank.name", read_only=True)
    currency_code = serializers.CharField(source="currency.code", read_only=True)

    class Meta:
        model = ClientBankAccount
        fields = [
            "id",
            "bank",
            "bank_name",
            "currency",
            "currency_code",
            "iban",
            "swift_bic",
            "is_default",
        ]

    def validate(self, attrs):
        client = self.context.get("client")
        if client is None:
            return attrs
        if attrs.get("is_default"):
            queryset = ClientBankAccount.objects.filter(
                client_id=client.id, is_default=True
            )
            if self.instance is not None:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError(
                    {"is_default": "This client already has a default bank account."}
                )
        iban = attrs.get("iban")
        if iban:
            queryset = ClientBankAccount.objects.filter(client_id=client.id, iban=iban)
            if self.instance is not None:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError(
                    {"iban": "This IBAN is already in use for this client."}
                )
        return attrs


class ClientSummarySerializer(serializers.ModelSerializer):
    company_id = serializers.IntegerField(read_only=True)
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = ["id", "client_type", "status", "display_name", "company_id"]

    def get_display_name(self, obj):
        return obj.get_display_name() or ""


class ClientSerializer(serializers.ModelSerializer):
    """
    The client together with its subtype data. Subtype data is validated
    against ``client_type`` and written together with the client row; the
    company is always taken from the authenticated user, never from the
    payload. Nested addresses/contacts/bank accounts are exposed read-only
    here and managed through their own tenant-scoped endpoints.
    """

    company_id = serializers.IntegerField(read_only=True)
    individual = ClientIndividualSerializer(required=False, allow_null=True)
    legal_entity = ClientLegalEntitySerializer(required=False, allow_null=True)
    addresses = ClientAddressSerializer(many=True, read_only=True)
    contacts = ClientContactSerializer(many=True, read_only=True)
    bank_accounts = ClientBankAccountSerializer(many=True, read_only=True)

    class Meta:
        model = Client
        fields = [
            "id",
            "client_type",
            "status",
            "company_id",
            "individual",
            "legal_entity",
            "addresses",
            "contacts",
            "bank_accounts",
            "created_at",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.partial:
            self.fields["individual"].partial = True
            self.fields["legal_entity"].partial = True

    def _company_from_context(self):
        company = self.context.get("company")
        if company is not None:
            return company
        request = self.context.get("request")
        if request is not None and getattr(request, "user", None):
            return request.user.company
        return None

    def _validate_voen_uniqueness(self, attrs, instance):
        legal_entity = attrs.get("legal_entity")
        if not legal_entity or not legal_entity.get("voen"):
            return
        company = self._company_from_context()
        if company is None:
            return
        queryset = ClientLegalEntity.objects.filter(company=company, voen=legal_entity["voen"])
        if instance is not None:
            queryset = queryset.exclude(client_id=instance.id)
        if queryset.exists():
            raise serializers.ValidationError(
                {
                    "legal_entity": {
                        "voen": "A legal entity with this VOEN already exists in your company."
                    }
                }
            )

    def validate(self, attrs):
        instance = self.instance
        requested_type = attrs.get("client_type")

        if instance is not None:
            if requested_type and requested_type != instance.client_type:
                raise serializers.ValidationError(
                    {"client_type": "A client's type cannot be changed."}
                )
            if (
                attrs.get("individual") is not None
                and instance.client_type != Client.ClientType.INDIVIDUAL
            ):
                raise serializers.ValidationError(
                    {"individual": "This client is not an individual."}
                )
            if (
                attrs.get("legal_entity") is not None
                and instance.client_type != Client.ClientType.LEGAL_ENTITY
            ):
                raise serializers.ValidationError(
                    {"legal_entity": "This client is not a legal entity."}
                )
            self._validate_voen_uniqueness(attrs, instance)
            return attrs

        if not requested_type:
            raise serializers.ValidationError({"client_type": "client_type is required."})
        if requested_type == Client.ClientType.INDIVIDUAL:
            if attrs.get("legal_entity") is not None:
                raise serializers.ValidationError(
                    {"legal_entity": "Individual clients cannot have legal-entity data."}
                )
            if attrs.get("individual") is None:
                raise serializers.ValidationError(
                    {"individual": "Individual client data is required."}
                )
        elif requested_type == Client.ClientType.LEGAL_ENTITY:
            if attrs.get("individual") is not None:
                raise serializers.ValidationError(
                    {"individual": "Legal-entity clients cannot have individual data."}
                )
            if attrs.get("legal_entity") is None:
                raise serializers.ValidationError(
                    {"legal_entity": "Legal-entity data is required."}
                )
        else:
            raise serializers.ValidationError(
                {"client_type": "client_type must be 'individual' or 'legal_entity'."}
            )

        self._validate_voen_uniqueness(attrs, None)
        return attrs

    def create(self, validated_data):
        individual = validated_data.pop("individual", None)
        legal_entity = validated_data.pop("legal_entity", None)
        company = validated_data.pop("company", None) or self._company_from_context()
        client = Client.objects.create(company=company, **validated_data)
        if individual is not None:
            ClientIndividual.objects.create(
                client=client, company=client.company, **individual
            )
        if legal_entity is not None:
            ClientLegalEntity.objects.create(
                client=client, company=client.company, **legal_entity
            )
        return client

    def update(self, instance, validated_data):
        individual = validated_data.pop("individual", None)
        legal_entity = validated_data.pop("legal_entity", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        company = instance.company
        if individual is not None:
            ClientIndividual.objects.update_or_create(
                client=instance, defaults={**individual, "company": company}
            )
        if legal_entity is not None:
            ClientLegalEntity.objects.update_or_create(
                client=instance, defaults={**legal_entity, "company": company}
            )
        return instance