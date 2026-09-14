from django.db import models
from django.db.models import Q


class Company(models.Model):
    """
    The tenant itself. Root of every tenant-owned table in the schema.
    Physical deletion is never performed through normal app operations —
    use `status`/`deleted_at` to deactivate. See architecture v3 §5.6.
    """

    class Status(models.TextChoices):
        TRIAL = "trial", "Trial"
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"
        CANCELLED = "cancelled", "Cancelled"

    id = models.BigAutoField(primary_key=True)

    legal_name = models.CharField(max_length=255)
    display_name = models.CharField(max_length=255)

    voen = models.CharField(
        max_length=20,
        blank=True,
        null=True,
        help_text="Azerbaijani Tax Identification Number.",
    )
    registration_number = models.CharField(max_length=50, blank=True, null=True)

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.TRIAL
    )

    default_language = models.CharField(max_length=2, default="az")
    default_timezone = models.CharField(max_length=64, default="Asia/Baku")

    # Marks the single reserved internal "GRM Platform" company that is the
    # account home for System Admin users (see
    # docs/architecture/ADR-system-admin.md, Decision 2). It is NOT a tenant
    # context; the platform company holds no tenant business data. The flag
    # exists so provisioning is idempotent and so the database can require that
    # system roles are only assigned to platform-company users. Authorization
    # never keys off this flag alone.
    is_platform = models.BooleanField(
        default=False,
        help_text="Reserved internal platform company for System Admins.",
    )

    # default_currency_id intentionally omitted until the `currencies`
    # reference-data model exists — added via a follow-up migration then.

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "companies"
        constraints = [
            # VOEN is unique among currently-active (non-soft-deleted) companies only.
            models.UniqueConstraint(
                fields=["voen"],
                condition=Q(voen__isnull=False, deleted_at__isnull=True),
                name="uq_companies_voen_active",
            ),
            # At most one platform company may ever exist.
            models.UniqueConstraint(
                fields=["is_platform"],
                condition=Q(is_platform=True),
                name="uq_companies_single_platform",
            ),
        ]
        indexes = [
            models.Index(
                fields=["status"],
                name="ix_companies_status_active",
                condition=Q(deleted_at__isnull=True),
            ),
        ]

    def __str__(self):
        return self.display_name


class CompanySettings(models.Model):
    """
    Strict 1:1 with Company. Kept as its own table so the core Company
    row stays small and settings can grow independently.
    """

    company = models.OneToOneField(
        Company,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name="settings",
        db_column="company_id",
    )

    document_numbering_format = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="e.g. INV-{YYYY}-{seq}",
    )

    # default_vat_rate FK omitted for the same reason as Company.default_currency_id —
    # vat_rates doesn't exist as a model yet.

    settings_json = models.JSONField(
        default=dict,
        blank=True,
        help_text="Bounded use only: genuinely unstructured, low-query-value preferences.",
    )

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "company_settings"

    def __str__(self):
        return f"Settings for {self.company_id}"


class CompanyBranding(models.Model):
    """
    Strict 1:1 with Company. Used by generated documents and the UI.
    """

    company = models.OneToOneField(
        Company,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name="branding",
        db_column="company_id",
    )

    logo_storage_path = models.TextField(blank=True, null=True)
    primary_color = models.CharField(max_length=7, blank=True, null=True)
    secondary_color = models.CharField(max_length=7, blank=True, null=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "company_branding"
        constraints = [
            models.CheckConstraint(
                check=Q(primary_color__regex=r"^#[0-9A-Fa-f]{6}$")
                | Q(primary_color__isnull=True),
                name="ck_company_branding_primary_color_hex",
            ),
            models.CheckConstraint(
                check=Q(secondary_color__regex=r"^#[0-9A-Fa-f]{6}$")
                | Q(secondary_color__isnull=True),
                name="ck_company_branding_secondary_color_hex",
            ),
        ]

    def __str__(self):
        return f"Branding for {self.company_id}"