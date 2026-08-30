from django.db import models

from companies.models import Company
from reference_data.models import DocumentType
from authentication.models import User


class DocumentTemplate(models.Model):
    """
    A company's template for a given document type (consulting contract,
    invoice, etc.). The actual template FILE lives on disk/object storage —
    this table only stores metadata; see TemplateVersion.storage_path.

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

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "document_templates"
        indexes = [
            models.Index(
                fields=["company", "document_type", "is_active"],
                name="ix_templates_company_type_active",
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