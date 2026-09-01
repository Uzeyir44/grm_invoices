from django.db import models

from apps.companies.models import Company
from apps.reference_data.models import DocumentType
from apps.authentication.models import User


def template_file_upload_path(instance, filename):
    """
    Store each template's current file under a company-scoped, template-keyed
    path: templates/company_<id>/<template_id>.docx. The extension is ignored
    and always forced to .docx (the only supported format), so a malicious
    filename cannot smuggle a different extension into storage.
    """
    return f"templates/company_{instance.company_id}/{instance.id}.docx"


def template_version_upload_path(instance, filename):
    """
    Store a version's snapshot under a stable, history-preserving path:
    templates/company_<id>/<template_id>/v<version>_<random>.docx. The random
    suffix keeps the overwrite semantics of the template's single current file
    from ever clobbering a historical version.
    """
    import uuid

    return (
        f"templates/company_{instance.company_id}/{instance.template_id}/"
        f"v{instance.version_number}_{uuid.uuid4().hex}.docx"
    )


class DocumentTemplate(models.Model):
    """
    A company's template for a given document type (consulting contract,
    invoice, etc.). The actual template FILE lives in `file`, stored via
    Django's configured storage (FileSystemStorage in development, swappable
    to object storage later). The table also stores metadata (`name`,
    `is_active`, timestamps, soft delete via `deleted_at`).

    File / version history (TemplateVersion) is a later step; for now each
    template holds exactly one current file, and uploading a new one replaces
    it.

    NOT MODELED HERE (raw-SQL migration, deferred with the rest):
      - UNIQUE(id, company_id) — needed as a composite-FK target for
        TemplateVersion.
    """

    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey(
        Company,
        on_delete=models.PROTECT,  # ON DELETE RESTRICT — preserve template history
        related_name="document_templates",
        db_column="company_id",
    )
    document_type = models.ForeignKey(
        DocumentType, on_delete=models.PROTECT, db_column="document_type_id"
    )

    name = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)
    file = models.FileField(
        upload_to=template_file_upload_path,
        max_length=255,
        null=True,
        blank=True,
        help_text="The template's current .docx file.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "document_templates"
        indexes = [
            models.Index(
                fields=["company", "document_type", "is_active"],
                name="ix_tpl_company_type_active",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.company_id})"


class TemplateVersion(models.Model):
    """
    An immutable edition of a template's file. Old versions are never
    deleted or edited — see the RESTRICT reasoning below.

    `company` is a COPY of template.company (same pattern as the client
    subtype tables): exists to support a composite FK
    (template_id, company_id) -> document_templates(id, company_id) and an
    immutability trigger, both added via the deferred raw-SQL migration —
    this proves the copy is correct rather than trusting it stays in sync.

    `created_by` also needs a composite FK (created_by_id, company_id) ->
    users(id, company_id), same deferral, so a Company-A template version
    can never be attributed to a Company-B user.

    INVARIANT (architecture v3 §6, enforced later via trigger): rows in
    this table are INSERT-only. UPDATE/DELETE are forbidden through normal
    application operations once a row exists.
    """

    id = models.BigAutoField(primary_key=True)
    template = models.ForeignKey(
        DocumentTemplate,
        on_delete=models.PROTECT,  # ON DELETE RESTRICT — history must survive
        related_name="versions",
        db_column="template_id",
    )
    company = models.ForeignKey(
        Company, on_delete=models.PROTECT, db_column="company_id", related_name="+"
    )

    version_number = models.IntegerField()
    storage_path = models.TextField(
        help_text="e.g. /storage/templates/company_123/template_45/version_3.docx"
    )
    checksum = models.CharField(max_length=64, blank=True, null=True)

    file = models.FileField(
        upload_to=template_version_upload_path,
        max_length=255,
        null=True,
        blank=True,
        help_text="The immutable .docx snapshot stored for this version.",
    )
    is_active = models.BooleanField(
        default=False,
        help_text=(
            "True when this is the template's currently-active version. Only "
            "one version per template is active at a time. This is "
            "administrative state, not version content."
        ),
    )

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_template_versions",
        db_column="created_by_user_id",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "template_versions"
        constraints = [
            models.UniqueConstraint(
                fields=["template", "version_number"], name="uq_template_version_number"
            ),
        ]

    def __str__(self):
        return f"{self.template_id} v{self.version_number}"