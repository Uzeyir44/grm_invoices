"""
Seeds the Permission catalog with the Document-Template management
permission codes.

Permission is a fixed, application-defined catalog (the `permissions` table,
owned by apps.authentication). Making the Document Template API usable
requires these codes to exist, so assigning a Role guarantees the RBAC
checks in apps.document_templates.api.views resolve. This is data-only —
no schema change.
"""

from django.db import migrations

DOCUMENT_TEMPLATE_PERMISSIONS = [
    ("document_templates.read", "View document templates"),
    ("document_templates.create", "Create document templates"),
    ("document_templates.update", "Update document templates"),
    ("document_templates.delete", "Soft-delete document templates"),
]


def seed_document_template_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    for code, description in DOCUMENT_TEMPLATE_PERMISSIONS:
        Permission.objects.update_or_create(
            code=code, defaults={"description": description}
        )


def unseed_document_template_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    Permission.objects.filter(
        code__in=[code for code, _ in DOCUMENT_TEMPLATE_PERMISSIONS]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0002_seed_client_permissions"),
    ]

    operations = [
        migrations.RunPython(
            seed_document_template_permissions,
            unseed_document_template_permissions,
        ),
    ]
