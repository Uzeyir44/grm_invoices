"""
Seed the initial System permission catalog.

System permissions are structurally separated from tenant permissions by
``Permission.scope == "system"`` (see docs/architecture/ADR-system-admin.md,
Decision 3). This is data-only; no schema change. Idempotent via
``update_or_create``. Reverse deletes only the exact system codes seeded here.
"""

from django.db import migrations

SYSTEM_PERMISSIONS = [
    ("system.companies.manage", "Manage companies"),
    ("system.users.manage", "Manage users across companies"),
    ("system.roles.manage", "Manage roles and permissions"),
    ("system.reference.manage", "Manage reference data"),
    ("system.audit.read", "Read system-wide audit logs"),
    ("system.backups.manage", "Manage backups"),
    ("system.settings.manage", "Manage platform settings"),
]


def seed_system_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    for code, description in SYSTEM_PERMISSIONS:
        Permission.objects.update_or_create(
            code=code,
            defaults={"description": description, "scope": "system"},
        )


def unseed_system_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    Permission.objects.filter(
        code__in=[code for code, _ in SYSTEM_PERMISSIONS]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0008_permission_scope_role_scope_and_more"),
    ]

    operations = [
        migrations.RunPython(seed_system_permissions, unseed_system_permissions),
    ]
