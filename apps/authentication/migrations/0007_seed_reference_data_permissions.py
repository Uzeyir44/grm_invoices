"""
Seeds the Permission catalog with the Reference Data read permission used by
the Step 6.3 read-only access layer.

Permission is a fixed, application-defined catalog (the `permissions` table,
owned by apps.authentication). Following the project's RBAC convention every
read surface is gated by an explicit permission code. Data-only — no schema
change. Idempotent via ``update_or_create``.
"""

from django.db import migrations

REFERENCE_DATA_PERMISSIONS = [
    ("reference_data.read", "Read reference/catalog data"),
]


def seed_reference_data_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    for code, description in REFERENCE_DATA_PERMISSIONS:
        Permission.objects.update_or_create(
            code=code, defaults={"description": description}
        )


def unseed_reference_data_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    Permission.objects.filter(
        code__in=[code for code, _ in REFERENCE_DATA_PERMISSIONS]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0006_seed_audit_log_permissions"),
    ]

    operations = [
        migrations.RunPython(
            seed_reference_data_permissions,
            unseed_reference_data_permissions,
        ),
    ]