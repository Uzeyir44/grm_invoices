"""
Create the reserved global, system-scoped ``System Admin`` role and attach the
system permission catalog to it.

This is the structural System Admin identity (docs/architecture/
ADR-system-admin.md, Decision 4): ``company = NULL`` (global) and
``scope = "system"``. It is data-only. Idempotent via ``get_or_create``.
Reverse deletes the role (its RolePermission rows cascade; assigned UserRole
rows are PROTECT and will block deletion, which is the safe outcome).
"""

from django.db import migrations

SYSTEM_ADMIN_ROLE_NAME = "System Admin"

SYSTEM_PERMISSION_CODES = [
    "system.companies.manage",
    "system.users.manage",
    "system.roles.manage",
    "system.reference.manage",
    "system.audit.read",
    "system.backups.manage",
    "system.settings.manage",
]


def seed_system_admin_role(apps, schema_editor):
    Role = apps.get_model("authentication", "Role")
    Permission = apps.get_model("authentication", "Permission")
    RolePermission = apps.get_model("authentication", "RolePermission")

    role, _ = Role.objects.get_or_create(
        name=SYSTEM_ADMIN_ROLE_NAME,
        company=None,
        defaults={"scope": "system"},
    )
    if role.scope != "system":
        role.scope = "system"
        role.save(update_fields=["scope"])

    permissions = Permission.objects.filter(
        code__in=SYSTEM_PERMISSION_CODES, scope="system"
    )
    for permission in permissions:
        RolePermission.objects.get_or_create(role=role, permission=permission)


def unseed_system_admin_role(apps, schema_editor):
    Role = apps.get_model("authentication", "Role")
    Role.objects.filter(
        name=SYSTEM_ADMIN_ROLE_NAME, company__isnull=True, scope="system"
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0009_seed_system_permissions"),
        # The scope-match trigger must exist before role-permission rows are
        # inserted, so the seed is validated by the same database rule that
        # protects runtime data.
        ("database", "0004_scoped_rbac_constraints"),
    ]

    operations = [
        migrations.RunPython(seed_system_admin_role, unseed_system_admin_role),
    ]
