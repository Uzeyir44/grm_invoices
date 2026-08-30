from django.db import connection, models

from apps.companies.models import Company


class CompanyDocumentCounter(models.Model):
    """
    One row per company, atomically incremented to hand out document
    numbers (architecture v4 §5) — deliberately NOT a per-company Postgres
    SEQUENCE object, since that doesn't scale cleanly to hundreds/thousands
    of tenants each needing their own sequence.

    `on_delete=CASCADE`: this is pure operational state with no historical
    or legal significance of its own (unlike clients/documents/audit logs),
    so it follows the same reasoning as CompanySettings/CompanyBranding
    rather than the PROTECT used on business-critical company children.
    """

    company = models.OneToOneField(
        Company,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name="document_counter",
        db_column="company_id",
    )
    last_number = models.BigIntegerField(default=0)

    class Meta:
        db_table = "company_document_counters"

    def __str__(self):
        return f"Counter for {self.company_id}: {self.last_number}"

    @classmethod
    def next_number(cls, company_id):
        """
        Atomically returns the next document number for a company.

        Deliberately a single UPSERT ... RETURNING statement, not a
        read-then-write pair: an UPDATE followed by a separate GET (or a
        get_or_create() followed by a save()) leaves a window where a
        second concurrent call can interleave between the two statements
        and read/return a number that's already been handed to someone
        else. A single statement has no such window — Postgres resolves
        the insert-or-increment and the read of the new value atomically
        under one row lock.

        Must be called inside the same transaction as the document
        creation it's numbering, so a failure afterward rolls the
        increment back too (architecture v3 §5).
        """
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO company_document_counters (company_id, last_number)
                VALUES (%s, 1)
                ON CONFLICT (company_id)
                DO UPDATE SET last_number = company_document_counters.last_number + 1
                RETURNING last_number
                """,
                [company_id],
            )
            (next_value,) = cursor.fetchone()
        return next_value