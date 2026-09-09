"""
Seeds the canonical currency lookup records.

Currency is a small, fixed, global (non-tenant) ISO 4217 lookup identified by
its unique ``code``. The minimal set below is required to test the CRM
end-to-end: generated-document creation rejects a missing or unknown currency,
so an empty catalog makes the document workflow untestable. New currencies
are added later as plain data inserts. This is data-only; there is no schema
change.

Forward:   creates the records (idempotent via get_or_create on ``code`` —
           existing rows with the same code, including their names, are left
           untouched). IDs are database-generated (SmallAutoField); callers
           discover them through GET /api/reference-data/currencies/.
Reverse:   deletes only the records created here (matched by exact code),
           never unrelated currencies.
"""

from django.db import migrations

CURRENCIES = [
    ("AZN", "Manat", 2),
    ("USD", "US Dollar", 2),
    ("EUR", "Euro", 2),
]


def seed_currencies(apps, schema_editor):
    Currency = apps.get_model("reference_data", "Currency")
    for code, name, minor_unit in CURRENCIES:
        Currency.objects.get_or_create(
            code=code, defaults={"name": name, "minor_unit": minor_unit}
        )


def unseed_currencies(apps, schema_editor):
    Currency = apps.get_model("reference_data", "Currency")
    Currency.objects.filter(code__in=[code for code, _, _ in CURRENCIES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("reference_data", "0003_seed_document_types"),
    ]

    operations = [
        migrations.RunPython(seed_currencies, unseed_currencies),
    ]
