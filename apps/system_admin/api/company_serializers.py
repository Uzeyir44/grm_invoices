"""
Serializers for System Admin company management.

Read fields expose only administratively relevant Company data (never secrets
or internal lifecycle state beyond ``status``/``is_platform``). Writable
serializers deliberately restrict the editable surface: ``id``, ``status``,
``is_platform``, ``deleted_at`` and the timestamps are never writable — status
changes go through the dedicated activate/deactivate operations, and
``is_platform`` is immutable by design.
"""

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.companies.models import Company

#: The administratively editable Company fields (PATCH / provision).
COMPANY_INPUT_FIELDS = [
    "legal_name",
    "display_name",
    "voen",
    "registration_number",
    "default_language",
    "default_timezone",
]


class AdminCompanySerializer(serializers.ModelSerializer):
    """Read-only representation of a company for the Admin UI."""

    class Meta:
        model = Company
        fields = [
            "id",
            "legal_name",
            "display_name",
            "voen",
            "registration_number",
            "status",
            "default_language",
            "default_timezone",
            "is_platform",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class AdminCompanyUpdateSerializer(serializers.ModelSerializer):
    """
    Partial update of the administratively editable Company fields.

    ``status`` and ``is_platform`` are intentionally absent, so a client cannot
    change lifecycle or platform identity through PATCH (those are handled by
    the dedicated lifecycle endpoints / are immutable).
    """

    class Meta:
        model = Company
        fields = COMPANY_INPUT_FIELDS

    def validate_voen(self, value):
        if value:
            queryset = Company.objects.filter(voen=value, deleted_at__isnull=True)
            if self.instance is not None:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError(
                    "A company with this VOEN already exists."
                )
        return value


class AdminCompanyProvisionSerializer(serializers.Serializer):
    """
    Company provisioning input: the new company's details plus its initial
    administrator's credentials.

    Only fields actually required by the existing models are collected. The
    initial password is write-only and validated with the project's configured
    password validators; it is never echoed back, logged, or audited.
    """

    legal_name = serializers.CharField(max_length=255)
    display_name = serializers.CharField(max_length=255)
    voen = serializers.CharField(
        max_length=20, required=False, allow_blank=True, allow_null=True
    )
    registration_number = serializers.CharField(
        max_length=50, required=False, allow_blank=True, allow_null=True
    )
    default_language = serializers.CharField(
        max_length=2, required=False, default="az"
    )
    default_timezone = serializers.CharField(
        max_length=64, required=False, default="Asia/Baku"
    )

    admin_email = serializers.EmailField()
    admin_first_name = serializers.CharField(
        max_length=100, required=False, allow_blank=True, default=""
    )
    admin_last_name = serializers.CharField(
        max_length=100, required=False, allow_blank=True, default=""
    )
    # ``trim_whitespace=False`` preserves the exact password the admin chose.
    admin_password = serializers.CharField(
        write_only=True, trim_whitespace=False
    )

    def validate_voen(self, value):
        if value and Company.objects.filter(
            voen=value, deleted_at__isnull=True
        ).exists():
            raise serializers.ValidationError(
                "A company with this VOEN already exists."
            )
        return value

    def validate_admin_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value
