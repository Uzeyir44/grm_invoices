from rest_framework import serializers

from apps.document_templates.models import DocumentTemplate


class DocumentTemplateSerializer(serializers.ModelSerializer):
    """
    Metadata serializer for a company's document template.

    ``company`` is never writable through the API: the owning company is
    always taken from the authenticated user (request.user.company), never
    from the payload. ``company_id`` is exposed read-only so clients can see
    which company a row belongs to (same pattern as the Client serializer).

    Version management (TemplateVersion) is deliberately not exposed here —
    it belongs to a later step of the feature.
    """

    company_id = serializers.IntegerField(read_only=True)
    document_type_code = serializers.CharField(
        source="document_type.code", read_only=True
    )

    class Meta:
        model = DocumentTemplate
        fields = [
            "id",
            "company_id",
            "document_type",
            "document_type_code",
            "name",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
