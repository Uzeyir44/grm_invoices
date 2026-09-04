from io import BytesIO
from zipfile import BadZipFile, ZipFile

from django.conf import settings
from django.urls import reverse

from rest_framework import serializers

from apps.document_templates.models import DocumentTemplate, TemplateVersion

DEFAULT_MAX_TEMPLATE_FILE_SIZE = 5 * 1024 * 1024
ALLOWED_TEMPLATE_EXTENSIONS = {".docx"}
OOXML_MEMBERS = {"[Content_Types].xml", "word/document.xml"}


class DocumentTemplateSerializer(serializers.ModelSerializer):
    """
    Metadata serializer for a company's document template.

    ``company`` is never writable through the API: the owning company is
    always taken from the authenticated user (request.user.company), never
    from the payload. ``company_id`` is exposed read-only so clients can see
    which company a row belongs to (same pattern as the Client serializer).

    ``file`` reports the **authenticated** download endpoint (the dedicated
    file endpoint, never a raw storage URL), so a template's private file can
    never be fetched by guessing a public ``/media/...`` path. Uploading /
    replacing the file also goes through the dedicated file endpoint. Version
    management (TemplateVersion) is deliberately not exposed here — it belongs
    to a later step of the feature.
    """

    company_id = serializers.IntegerField(read_only=True)
    document_type_code = serializers.CharField(
        source="document_type.code", read_only=True
    )
    file = serializers.SerializerMethodField()
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

    def get_file(self, obj):
        if not obj.file:
            return None
        # The authenticated, tenant-scoped download endpoint — not a public
        # storage URL. Serving media directly is a deployment concern that must
        # remain disabled; the API layer never advertises a /media/ path.
        return reverse("document-template-file", kwargs={"pk": obj.pk})

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
        # Limit read from settings per request so it stays consistent with
        # the configured environment (and is testable via override_settings).
        max_size = getattr(
            settings, "MAX_TEMPLATE_FILE_SIZE", DEFAULT_MAX_TEMPLATE_FILE_SIZE
        )
        if value.size is None or value.size > max_size:
            raise serializers.ValidationError(
                f"The file must be at most {max_size} bytes."
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


class TemplateVersionSerializer(serializers.ModelSerializer):
    """
    Read-only representation of an immutable TemplateVersion snapshot.

    ``storage_path`` and the raw file URL are deliberately not exposed: file
    availability is reported as a boolean (``has_file``) plus the storage
    ``file_name`` metadata, never as a publicly usable ``/media/...`` URL.
    ``company`` descends from the template and is never client-settable.
    """

    company_id = serializers.IntegerField(read_only=True)
    file_name = serializers.SerializerMethodField()
    has_file = serializers.SerializerMethodField()

    class Meta:
        model = TemplateVersion
        fields = [
            "id",
            "template_id",
            "company_id",
            "version_number",
            "is_active",
            "file_name",
            "has_file",
            "checksum",
            "created_by_id",
            "created_at",
        ]
        read_only_fields = fields

    def get_file_name(self, obj):
        return obj.file.name if obj.file else None

    def get_has_file(self, obj):
        return bool(obj.file)
