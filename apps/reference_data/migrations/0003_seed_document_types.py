"""
Seeds the canonical document-type lookup records.

DocumentType is a small, fixed, global (non-tenant) lookup identified by its
unique ``code``. The canonical set below is required by the Document Templates
frontend: creating a template needs a ``document_type`` id taken from the
read-only reference-data catalog, and an empty catalog makes the template
workflow untestable end-to-end. New types are added later as plain data
inserts. This is data-only; there is no schema change.

Forward:   creates the records (idempotent via get_or_create on ``code`` —
           existing rows with the same code, including their names, are left
           untouched). IDs are database-generated (SmallAutoField); callers
           discover them through GET /api/reference-data/document-types/.
Reverse:   deletes only the records created here (matched by exact code),
           never unrelated document types.
"""

from django.db import migrations

DOCUMENT_TYPES = [
    ("consulting_contract", "Consulting Contract"),
    ("purchase_sale_contract", "Purchase/Sale Contract"),
    ("invoice", "Invoice"),
    ("handover_certificate", "Handover Certificate"),
]


def seed_document_types(apps, schema_editor):
    DocumentType = apps.get_model("reference_data", "DocumentType")
    for code, name in DOCUMENT_TYPES:
        DocumentType.objects.get_or_create(code=code, defaults={"name": name})


def unseed_document_types(apps, schema_editor):
    DocumentType = apps.get_model("reference_data", "DocumentType")
    DocumentType.objects.filter(
        code__in=[code for code, _ in DOCUMENT_TYPES]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("reference_data", "0002_seed_address_types"),
    ]

    operations = [
        migrations.RunPython(seed_document_types, unseed_document_types),
    ]
