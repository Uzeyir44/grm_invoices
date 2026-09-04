"""
Serializers for the Step 4.6 generation API and secure download endpoints.

Read-only by design for the read surface; the create serializer (document
creation + numbering) accepts only reference ids and line-item inputs — never
tenant data (company always comes from the authenticated user) and never
storage paths.
"""

from decimal import Decimal

from django.conf import settings

from rest_framework import serializers

from apps.generated_documents.models import GeneratedDocument, GeneratedDocumentVersion


class GeneratedDocumentSerializer(serializers.ModelSerializer):
    """Metadata of a generated document (its logical identity)."""

    company_id = serializers.IntegerField(read_only=True)
    document_type_code = serializers.CharField(
        source="document_type.code", read_only=True
    )
    client_id = serializers.IntegerField(read_only=True)
    template_id = serializers.IntegerField(read_only=True)
    created_by_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = GeneratedDocument
        fields = [
            "id",
            "company_id",
            "document_type",
            "document_type_code",
            "client_id",
            "template_id",
            "document_number",
            "status",
            "created_by_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class GeneratedDocumentVersionSerializer(serializers.ModelSerializer):
    """
    Read-only snapshot of a generated version.

    ``storage`` reports file availability as booleans (``{"docx": …, "pdf": …}``)
    so the response clearly identifies what exists without leaking any storage
    path or other internal detail.
    """

    company_id = serializers.IntegerField(read_only=True)
    generated_document_id = serializers.IntegerField(read_only=True)
    template_version_id = serializers.IntegerField(read_only=True)
    currency_id = serializers.IntegerField(read_only=True)
    generated_by_id = serializers.IntegerField(read_only=True)
    storage = serializers.SerializerMethodField()

    class Meta:
        model = GeneratedDocumentVersion
        fields = [
            "id",
            "generated_document_id",
            "company_id",
            "version_number",
            "template_version_id",
            "currency_id",
            "exchange_rate_used",
            "vat_rate_used_percent",
            "generation_metadata",
            "storage",
            "generated_by_id",
            "created_at",
        ]
        read_only_fields = fields

    def get_storage(self, obj):
        return {
            "docx": bool(obj.storage_path_docx),
            "pdf": bool(obj.storage_path_pdf),
        }


class GeneratedDocumentGenerateSerializer(serializers.Serializer):
    """
    Optional inputs for the generate endpoint.

    Only the shared :class:`Currency` reference is accepted here: a first
    version has no line items from which the generator could derive a
    currency, so the client may supply one. No tenant data is ever accepted
    from the body (company comes from the authenticated user).
    """

    currency_id = serializers.IntegerField(required=False, allow_null=True)


class GeneratedDocumentLineItemInputSerializer(serializers.Serializer):
    """Validated line-item input for the initial version of a new document."""

    description = serializers.CharField()
    quantity = serializers.DecimalField(max_digits=14, decimal_places=4)
    unit = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, max_length=30
    )
    unit_price = serializers.DecimalField(max_digits=18, decimal_places=4)
    discount_percent = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        required=False,
        default=Decimal("0"),
    )
    vat_rate_percent = serializers.DecimalField(max_digits=5, decimal_places=2)


class GeneratedDocumentCreateSerializer(serializers.Serializer):
    """
    Input for document creation (POST /api/generated-documents/).

    Only reference ids and optional line-item inputs are accepted. The company
    is always the authenticated user's company (a body ``company_id`` is
    ignored); the client is resolved tenant-scoped by the view (cross-company
    client → 404). The initial version's currency is provided via
    ``currency_id`` (V1 requirement), and line items — when supplied — are
    validated field-by-field here.

    Line items are limited to ``settings.MAX_DOCUMENT_LINE_ITEMS`` so an
    unbounded request cannot reach document generation; oversized requests are
    rejected with 400 before any expensive processing.
    """

    client_id = serializers.IntegerField()
    document_type_id = serializers.IntegerField()
    currency_id = serializers.IntegerField(required=False, allow_null=True)
    items = GeneratedDocumentLineItemInputSerializer(
        many=True, required=False, allow_empty=True
    )

    def validate_items(self, value):
        max_items = getattr(settings, "MAX_DOCUMENT_LINE_ITEMS", 500)
        if len(value) > max_items:
            raise serializers.ValidationError(
                f"At most {max_items} line items are allowed per document."
            )
        return value