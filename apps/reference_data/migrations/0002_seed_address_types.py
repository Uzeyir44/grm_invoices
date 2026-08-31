"""
Seeds the canonical address-type lookup records.

AddressType is a small, fixed lookup identified by its unique ``code``. The
canonical set (legal / business / residential) is the one documented by the
model docstring and the database architecture — new types are added later as
plain data inserts. This is data-only; there is no schema change.

Forward:   creates the records (idempotent via get_or_create on ``code``).
Reverse:   deletes only the records created here, never unrelated types.
"""

from django.db import migrations

ADDRESS_TYPES = [
    "legal",
    "business",
    "residential",
]


def seed_address_types(apps, schema_editor):
    AddressType = apps.get_model("reference_data", "AddressType")
    for code in ADDRESS_TYPES:
        AddressType.objects.get_or_create(code=code)


def unseed_address_types(apps, schema_editor):
    AddressType = apps.get_model("reference_data", "AddressType")
    AddressType.objects.filter(code__in=ADDRESS_TYPES).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("reference_data", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_address_types, unseed_address_types),
    ]