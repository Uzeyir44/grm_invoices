from io import BytesIO
from zipfile import BadZipFile, ZipFile

from django.conf import settings

from rest_framework import serializers

from apps.document_templates.models import DocumentTemplate

MAX_TEMPLATE_FILE_SIZE = getattr(settings, "MAX_TEMPLATE_FILE_SIZE", 5 * 1024 * 1024)
ALLOWED_TEMPLATE_EXTENSIONS = {".docx"}
OOXML_MEMBERS = {"[Content_Types].xml", "word/document.xml"}


class DocumentTemplateSerializer(serializers.ModelSerializer):
    """
    Metadata serializer for a company's document template.

    ``company`` is never writable through the API: the owning company is
    always taken from the authenticated user (request.user.company), never
    from the payload. ``company_id`` is exposed read-only so clients can see
    which company a row belongs to (same pattern as the Client serializer).

    ``file`` is exposed read-only (a stored-file URL); uploading/replacing
    the file goes through the dedicated file endpoint. Version management
    (TemplateVersion) is deliberately not exposed here — it belongs to a
    later step of the feature.
    """

    company_id = serializers.IntegerField(read_only=True)
    document_type_code = serializers.CharField(
        source="document_type.code", read_only=True
    )
    file_name = serializers.SerializerMethodField()

    class Meta:
        model = DocumentTemplate
        fields = [
            "id",
            "company_id",
            "document_type",
            "document_type_code",
            "name",
            "is_active",
            "file",
            "file_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_file_name(self, obj):
        return obj.file.name if obj.file else None


class DocumentTemplateFileSerializer(serializers.Serializer):
    """
    Multipart validation/upload serializer for a template's .docx file.

    The uploaded object is stored as ``template.file`` via Django's standard
    storage (FileSystemStorage in development). Validation is deliberately
    light — no DOCX/placeholder parsing — but it does: require a file,
    require the fixed .docx extension, enforce the size limit, and confirm
    the upload is actually a ZIP archive exposing the OOXML/Word members that
    every real .docx contains (a cheap sanity check, not a full parser).
    """

    file = serializers.FileField(write_only=True)

    def validate_file(self, value):
        if value is None:
            raise serializers.ValidationError("A file is required.")
        if not value.name.lower().endswith(".docx"):
            raise serializers.ValidationError(
                "Only .docx template files are supported."
            )
        if value.size is None or value.size > MAX_TEMPLATE_FILE_SIZE:
            raise serializers.ValidationError(
                f"The file must be at most {MAX_TEMPLATE_FILE_SIZE} bytes."
            )
        try:
            with ZipFile(BytesIO(value.read())):
                pass
        except BadZipFile as exc:
            raise serializers.ValidationError(
                "The uploaded file is not a valid .docx (Word) file."
            ) from exc
        finally:
            value.seek(0)
        return value
