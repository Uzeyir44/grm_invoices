"""
Serializers for the Step 4.6 generation API and secure download endpoints.

Read-only by design: the API is an adapter around the existing generation
services, not a CRUD surface. Storage paths are deliberately never exposed —
availability is surfaced as booleans and the files are only reachable through
the authenticated download endpoints.
"""

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