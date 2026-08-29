from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import RangeOperators
from django.db import models
from django.db.models import F
from django.db.models.expressions import RawSQL


class Currency(models.Model):
    """
    Reusable reference data — deliberately NOT tenant-owned (no `company`
    column). ISO 4217 currencies.
    """

    id = models.SmallAutoField(primary_key=True)
    code = models.CharField(max_length=3, unique=True, help_text="ISO 4217, e.g. AZN, USD")
    name = models.CharField(max_length=50)
    minor_unit = models.SmallIntegerField(default=2, help_text="Decimal places, e.g. 2")

    class Meta:
        db_table = "currencies"

    def __str__(self):
        return self.code


class VatRate(models.Model):
    """
    Reusable reference data, not hardcoded into business tables. Overlapping
    validity periods for the same rate `name` are blocked at the database
    level using a half-open date range: `valid_to` means "the first date
    this rate no longer applies" (architecture v3 §4) — NOT the last day
    it's still valid. Adjacent, back-to-back periods sharing a boundary
    date are correctly treated as non-overlapping under this semantic.

    IMPORTANT: the exclusion constraint below requires the `btree_gist`
    Postgres extension. That must be enabled via a migration operation
    (`django.contrib.postgres.operations.BtreeGistExtension`) — it cannot
    be expressed in models.py alone.
    """

    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=50, help_text="e.g. 'Standard AZ VAT'")
    rate_percent = models.DecimalField(max_digits=5, decimal_places=2)
    valid_from = models.DateField()
    valid_to = models.DateField(
        null=True,
        blank=True,
        help_text="NULL = still in effect. Half-open: this date itself is NOT covered.",
    )

    class Meta:
        db_table = "vat_rates"
        constraints = [
            ExclusionConstraint(
                name="no_overlapping_vat_periods",
                expressions=[
                    (F("name"), RangeOperators.EQUAL),
                    (
                        RawSQL(
                            "daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)')",
                            (),
                        ),
                        RangeOperators.OVERLAPS,
                    ),
                ],
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.rate_percent}%)"


class ExchangeRate(models.Model):
    """
    Shared/global reference feed (architecture v4 §4) — deliberately NOT
    tenant-owned. The rate actually used on a document is snapshotted onto
    that document's version at generation time; this table only reflects
    current/historical market rates, not per-tenant history.
    """

    id = models.BigAutoField(primary_key=True)
    from_currency = models.ForeignKey(
        Currency,
        on_delete=models.PROTECT,
        related_name="rates_from",
        db_column="from_currency_id",
    )
    to_currency = models.ForeignKey(
        Currency,
        on_delete=models.PROTECT,
        related_name="rates_to",
        db_column="to_currency_id",
    )
    rate = models.DecimalField(max_digits=18, decimal_places=8)
    effective_at = models.DateTimeField()

    class Meta:
        db_table = "exchange_rates"
        indexes = [
            models.Index(
                fields=["from_currency", "to_currency", "effective_at"],
                name="ix_exchange_rates_pair_time",
            ),
        ]

    def __str__(self):
        return f"{self.from_currency_id}->{self.to_currency_id} @ {self.effective_at}"


class AddressType(models.Model):
    """
    Small fixed lookup (legal / business / residential / ...). New types
    are a data insert, not a schema change.
    """

    id = models.SmallAutoField(primary_key=True)
    code = models.CharField(max_length=30, unique=True)

    class Meta:
        db_table = "address_types"

    def __str__(self):
        return self.code


class DocumentType(models.Model):
    """
    consulting_contract / purchase_sale_contract / invoice /
    handover_certificate / ... Used by both templates and generated
    documents so new document types don't require a schema change.
    """

    id = models.SmallAutoField(primary_key=True)
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)

    class Meta:
        db_table = "document_types"

    def __str__(self):
        return self.code


class Bank(models.Model):
    """
    Maintained bank directory (architecture v4 §3) — replaces free-text
    `bank_name` on client bank accounts to avoid the same bank being
    entered as several different string variants.
    """

    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=150)
    swift_code = models.CharField(max_length=11, blank=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "banks"

    def __str__(self):
        return self.name