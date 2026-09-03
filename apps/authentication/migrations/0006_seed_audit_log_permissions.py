"""
Seeds the Permission catalog with the Audit Logs read permission used by the
Step 5.3 read API.

Permission is a fixed, application-defined catalog (the `permissions` table,
owned by apps.authentication). The read endpoint requires this code to exist.
Data-only — no schema change. Idempotent via ``update_or_create`` so it is
safe for fresh database setup.
"""

from django.db import migrations

AUDIT_LOG_PERMISSIONS = [
    ("audit_logs.read", "Read audit logs"),
]


def seed_audit_log_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    for code, description in AUDIT_LOG_PERMISSIONS:
        Permission.objects.update_or_create(
            code=code, defaults={"description": description}
        )


def unseed_audit_log_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    Permission.objects.filter(
        code__in=[code for code, _ in AUDIT_LOG_PERMISSIONS]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0005_seed_generated_document_permissions"),
    ]

    operations = [
        migrations.RunPython(
            seed_audit_log_permissions,
            unseed_audit_log_permissions,
        ),
    ]