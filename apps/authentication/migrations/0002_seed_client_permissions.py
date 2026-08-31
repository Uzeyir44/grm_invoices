"""
Seeds the Permission catalog with the Client-management permission codes.

Permission is a fixed, application-defined catalog (the `permissions` table,
owned by apps.authentication). Making the Client API usable requires these
codes to exist, so assigning a Role guarantees the RBAC checks in
apps.clients.api.views resolve. This is data-only — no schema change.
"""

from django.db import migrations

CLIENT_PERMISSIONS = [
    ("clients.read", "View clients"),
    ("clients.create", "Create clients"),
    ("clients.update", "Update clients and their nested records"),
    ("clients.delete", "Soft-delete clients"),
]


def seed_client_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    for code, description in CLIENT_PERMISSIONS:
        Permission.objects.update_or_create(
            code=code, defaults={"description": description}
        )


def unseed_client_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    Permission.objects.filter(code__in=[code for code, _ in CLIENT_PERMISSIONS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_client_permissions, unseed_client_permissions),
    ]