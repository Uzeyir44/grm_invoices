from django.db import models

from apps.clients.models import Client
from apps.companies.models import Company
from apps.reference_data.models import Currency, DocumentType
from apps.document_templates.models import DocumentTemplate, TemplateVersion
from apps.authentication.models import User


class GeneratedDocument(models.Model):
    """
    The logical document identity (a "folder", not its contents) — number,
    client, company, current status. What was actually generated lives in
    GeneratedDocumentVersion; this table never holds anything that could
    legitimately differ between versions (architecture v2 §3.1).

    NOT MODELED HERE (deferred raw-SQL migration):
      - UNIQUE(id, company_id) — composite-FK target for
        GeneratedDocumentVersion.
      - Composite FK (client_id, company_id) -> clients(id, company_id).
      - Composite FK (template_id, company_id) -> document_templates(id, company_id).
      - Composite FK (created_by_id, company_id) -> users(id, company_id).
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        GENERATED = "generated", "Generated"
        SENT = "sent", "Sent"
        VOID = "void", "Void"

    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey(
        Company,
        on_delete=models.PROTECT,  # ON DELETE RESTRICT — legal/financial retention
        related_name="generated_documents",
        db_column="company_id",
    )
    client = models.ForeignKey(
        Client,
        on_delete=models.PROTECT,  # RESTRICT — deleting a client must not touch its documents
        related_name="generated_documents",
        db_column="client_id",
        null=True,
        blank=True,
    )
    document_type = models.ForeignKey(
        DocumentType, on_delete=models.PROTECT, db_column="document_type_id"
    )
    template = models.ForeignKey(
        DocumentTemplate,
        on_delete=models.PROTECT,  # RESTRICT
        related_name="generated_documents",
        db_column="template_id",
    )

    document_number = models.CharField(max_length=50)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_documents",
        db_column="created_by_user_id",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "generated_documents"
        constraints = [
            models.UniqueConstraint(
                fields=["company", "document_number"], name="uq_gendoc_company_number"
            ),
        ]
        indexes = [
            models.Index(fields=["company", "status"], name="ix_gendocs_company_status"),
            models.Index(fields=["company", "client"], name="ix_gendocs_company_client"),
        ]

    def __str__(self):
        return self.document_number


class GeneratedDocumentVersion(models.Model):
    """
    An immutable snapshot of a generated document. Line items belong HERE,
    not to GeneratedDocument directly — editing a document means creating a
    new version, never mutating an existing one's contents.

    `company` (added in architecture v3) is a COPY of
    generated_document.company, existing purely to support composite FKs
    proving this version's document and template version both belong to
    the same company as this row — closing the exact gap where a
    Company-A document could otherwise reference a Company-B template
    version.

    NOT MODELED HERE (deferred raw-SQL migration):
      - UNIQUE(id, company_id) — composite-FK target for DocumentLineItem.
      - Composite FK (generated_document_id, company_id) ->
        generated_documents(id, company_id).
      - Composite FK (template_version_id, company_id) ->
        template_versions(id, company_id).
      - Composite FK (generated_by_id, company_id) -> users(id, company_id).
      - Immutability trigger: INSERT allowed, UPDATE/DELETE forbidden once
        a row exists (architecture v3 §6).
    """

    id = models.BigAutoField(primary_key=True)
    generated_document = models.ForeignKey(
        GeneratedDocument,
        on_delete=models.PROTECT,  # RESTRICT — historical preservation
        related_name="versions",
        db_column="generated_document_id",
    )
    company = models.ForeignKey(
        Company, on_delete=models.PROTECT, db_column="company_id", related_name="+"
    )

    version_number = models.IntegerField()
    template_version = models.ForeignKey(
        TemplateVersion,
        on_delete=models.PROTECT,  # RESTRICT — reconstruction depends on this reference
        related_name="generated_document_versions",
        db_column="template_version_id",
    )

    currency = models.ForeignKey(Currency, on_delete=models.PROTECT, db_column="currency_id")
    exchange_rate_used = models.DecimalField(
        max_digits=18, decimal_places=8, null=True, blank=True
    )
    vat_rate_used_percent = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True
    )

    generation_snapshot = models.JSONField(
        help_text=(
            "Full point-in-time rendering input (company/client/document/"
            "template/template_variables) — see architecture v4 §1. Must "
            "cover every value that affects rendered output."
        )
    )
    generation_metadata = models.JSONField(
        null=True,
        blank=True,
        help_text="Genuinely incidental technical data only (engine version, "
        "render duration) — never a first-class relationship.",
    )

    storage_path_docx = models.TextField(null=True, blank=True)
    storage_path_pdf = models.TextField(null=True, blank=True)

    generated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="generated_document_versions",
        db_column="generated_by_user_id",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "generated_document_versions"
        constraints = [
            models.UniqueConstraint(
                fields=["generated_document", "version_number"],
                name="uq_gdv_document_version_number",
            ),
        ]

    def __str__(self):
        return f"{self.generated_document_id} v{self.version_number}"


class DocumentLineItem(models.Model):
    """
    Belongs to a specific VERSION, not to the document directly — this is
    what makes "Version 1: 10 hours, Version 2: 20 hours" reconstructable
    (architecture v2 §3.3).

    `company` (added in v3) is a copy of
    generated_document_version.company, for the same composite-FK reason
    as everywhere else in this chain.

    NOT MODELED HERE (deferred raw-SQL migration):
      - Composite FK (generated_document_version_id, company_id) ->
        generated_document_versions(id, company_id).
      - Immutability trigger: INSERT-only, same as the version it belongs to.

    Application-level rule (not DB-enforced, architecture v4 §5.8): for v1,
    a line item's currency should match its parent version's currency —
    the column stays flexible for future genuine multi-currency line items,
    but nothing should exercise that yet.
    """

    id = models.BigAutoField(primary_key=True)
    generated_document_version = models.ForeignKey(
        GeneratedDocumentVersion,
        on_delete=models.CASCADE,  # owned entirely by its version, which is itself RESTRICT-protected
        related_name="line_items",
        db_column="generated_document_version_id",
    )
    company = models.ForeignKey(
        Company, on_delete=models.PROTECT, db_column="company_id", related_name="+"
    )

    line_number = models.IntegerField()
    description = models.TextField()
    quantity = models.DecimalField(max_digits=14, decimal_places=4)
    unit = models.CharField(max_length=30, blank=True, null=True)
    unit_price = models.DecimalField(max_digits=18, decimal_places=4)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    vat_rate_percent = models.DecimalField(max_digits=5, decimal_places=2)
    currency = models.ForeignKey(Currency, on_delete=models.PROTECT, db_column="currency_id")

    subtotal = models.DecimalField(max_digits=18, decimal_places=4)
    vat_amount = models.DecimalField(max_digits=18, decimal_places=4)
    total = models.DecimalField(max_digits=18, decimal_places=4)

    class Meta:
        db_table = "document_line_items"
        constraints = [
            models.UniqueConstraint(
                fields=["generated_document_version", "line_number"],
                name="uq_line_item_version_number",
            ),
        ]

    def __str__(self):
        return f"{self.description} ({self.generated_document_version_id})"