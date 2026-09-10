from django.db import models
from django.db.models import Q

from apps.companies.models import Company
from apps.reference_data.models import AddressType, Bank, Currency


class Client(models.Model):
    """
    Base/shared client row. Legal entities and individuals extend this via
    a 1:1 subtype table rather than one wide table with nullable columns.

    NOT MODELED HERE (added via a raw-SQL migration once all client tables
    exist):
      - UNIQUE(id, company_id) — needed as the target of composite FKs from
        the subtype tables. Django has no native composite-FK support.
      - The subtype-exclusivity triggers (client_type must match exactly
        one of client_legal_entities / client_individuals, enforced in
        both directions — architecture v2 §2 and v3 §3).
    """

    class ClientType(models.TextChoices):
        LEGAL_ENTITY = "legal_entity", "Legal Entity"
        INDIVIDUAL = "individual", "Individual"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        ARCHIVED = "archived", "Archived"

    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey(
        Company,
        on_delete=models.PROTECT,  # ON DELETE RESTRICT — force soft-delete instead
        related_name="clients",
        db_column="company_id",
    )
    client_type = models.CharField(max_length=20, choices=ClientType.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "clients"
        indexes = [
            models.Index(fields=["company", "status"], name="ix_clients_company_status"),
            models.Index(fields=["company", "client_type"], name="ix_clients_company_type"),
        ]

    def __str__(self):
        return f"Client {self.id} ({self.client_type})"

    def get_display_name(self):
        """
        Human-readable label for this client: the legal name, or the
        individual's full name (first + middle + last). ``None`` when the
        subtype row is missing.
        """
        try:
            if self.client_type == Client.ClientType.INDIVIDUAL:
                individual = self.individual
                return (
                    " ".join(
                        part
                        for part in (
                            individual.first_name,
                            individual.middle_name,
                            individual.last_name,
                        )
                        if part
                    )
                    or None
                )
            legal_entity = self.legal_entity
            return legal_entity.legal_name if legal_entity else None
        except (ClientIndividual.DoesNotExist, ClientLegalEntity.DoesNotExist):
            return None


class ClientLegalEntity(models.Model):
    """
    1:1 extension of Client, used when client_type = legal_entity.

    `company` is a COPY of client.company — exists only so a composite FK
    (client_id, company_id) -> clients(id, company_id) can be added via raw
    SQL, proving the copy actually matches rather than trusting it stays in
    sync. Also gets an immutability trigger (set once at insert, never
    changed) — both deferred to the follow-up migration, same as on Client.
    """

    client = models.OneToOneField(
        Client,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name="legal_entity",
        db_column="client_id",
    )
    company = models.ForeignKey(
        Company, on_delete=models.PROTECT, db_column="company_id", related_name="+"
    )

    legal_name = models.CharField(max_length=255)
    trading_name = models.CharField(max_length=255, blank=True, null=True)
    voen = models.CharField(max_length=20)
    registration_number = models.CharField(max_length=50, blank=True, null=True)
    registration_date = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "client_legal_entities"
        constraints = [
            models.UniqueConstraint(fields=["company", "voen"], name="uq_legal_entity_company_voen"),
        ]

    def __str__(self):
        return self.legal_name


class ClientIndividual(models.Model):
    """
    1:1 extension of Client, used when client_type = individual.

    `identification_number` is never stored as plaintext (architecture v4
    §5): an application-encrypted value plus a keyed-HMAC hash for
    exact-match lookup, instead of one plain column.
    """

    client = models.OneToOneField(
        Client,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name="individual",
        db_column="client_id",
    )
    company = models.ForeignKey(
        Company, on_delete=models.PROTECT, db_column="company_id", related_name="+"
    )

    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    middle_name = models.CharField(max_length=100, blank=True, null=True)

    identification_number_encrypted = models.BinaryField(
        null=True, blank=True, help_text="Encrypted at the application layer before storage."
    )
    identification_number_hash = models.BinaryField(
        null=True,
        blank=True,
        help_text="Keyed HMAC (not plain SHA-256) — used for exact-match lookup only.",
    )

    date_of_birth = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "client_individuals"
        constraints = [
            models.UniqueConstraint(
                fields=["company", "identification_number_hash"],
                condition=Q(identification_number_hash__isnull=False),
                name="uq_individual_company_id_hash",
            ),
        ]

    def __str__(self):
        return f"{self.first_name} {self.last_name}"


class ClientAddress(models.Model):
    """
    `company` is included purely to support RLS directly (architecture v4
    §2) — no composite FK needed here, since this table only ever
    references `clients` (a single tenant-owned parent), so a plain FK on
    `client` already makes cross-tenant reference impossible.
    """

    id = models.BigAutoField(primary_key=True)
    client = models.ForeignKey(
        Client, on_delete=models.CASCADE, related_name="addresses", db_column="client_id"
    )
    company = models.ForeignKey(
        Company, on_delete=models.PROTECT, db_column="company_id", related_name="+"
    )
    address_type = models.ForeignKey(
        AddressType, on_delete=models.PROTECT, db_column="address_type_id"
    )

    line1 = models.CharField(max_length=255)
    line2 = models.CharField(max_length=255, blank=True, null=True)
    city = models.CharField(max_length=100, blank=True, null=True)
    region = models.CharField(max_length=100, blank=True, null=True)
    postal_code = models.CharField(max_length=20, blank=True, null=True)
    country_code = models.CharField(max_length=2, default="AZ")
    is_primary = models.BooleanField(default=False)

    class Meta:
        db_table = "client_addresses"
        constraints = [
            models.UniqueConstraint(
                fields=["client"], condition=Q(is_primary=True), name="uq_client_addr_one_primary"
            ),
        ]
        indexes = [models.Index(fields=["client"], name="ix_client_addresses_client")]


class ClientContact(models.Model):
    id = models.BigAutoField(primary_key=True)
    client = models.ForeignKey(
        Client, on_delete=models.CASCADE, related_name="contacts", db_column="client_id"
    )
    company = models.ForeignKey(
        Company, on_delete=models.PROTECT, db_column="company_id", related_name="+"
    )

    full_name = models.CharField(max_length=200)
    position = models.CharField(max_length=100, blank=True, null=True)
    phone = models.CharField(max_length=30, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    is_primary = models.BooleanField(default=False)

    class Meta:
        db_table = "client_contacts"
        constraints = [
            models.UniqueConstraint(
                fields=["client"], condition=Q(is_primary=True), name="uq_client_contact_one_primary"
            ),
        ]
        indexes = [models.Index(fields=["client"], name="ix_client_contacts_client")]

    def __str__(self):
        return self.full_name


class ClientBankAccount(models.Model):
    id = models.BigAutoField(primary_key=True)
    client = models.ForeignKey(
        Client, on_delete=models.CASCADE, related_name="bank_accounts", db_column="client_id"
    )
    company = models.ForeignKey(
        Company, on_delete=models.PROTECT, db_column="company_id", related_name="+"
    )
    bank = models.ForeignKey(
        Bank, on_delete=models.PROTECT, db_column="bank_id", null=True, blank=True
    )
    currency = models.ForeignKey(Currency, on_delete=models.PROTECT, db_column="currency_id")

    iban = models.CharField(max_length=34)
    swift_bic = models.CharField(max_length=11, blank=True, null=True)
    is_default = models.BooleanField(default=False)

    class Meta:
        db_table = "client_bank_accounts"
        constraints = [
            models.UniqueConstraint(fields=["client", "iban"], name="uq_bank_account_client_iban"),
            models.UniqueConstraint(
                fields=["client"], condition=Q(is_default=True), name="uq_bank_account_one_default"
            ),
        ]

    def __str__(self):
        return f"{self.iban} ({self.client_id})"