"""
Seeds the Permission catalog with the Document-Template version-management
permission codes.

Permission is a fixed, application-defined catalog (the `permissions` table,
owned by apps.authentication). Making the version endpoints usable requires
these codes to exist. Data-only — no schema change.
"""

from django.db import migrations

VERSION_PERMISSIONS = [
    ("document_templates.version_create", "Create document template versions"),
    ("document_templates.version_activate", "Activate a document template version"),
]


def seed_version_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    for code, description in VERSION_PERMISSIONS:
        Permission.objects.update_or_create(
            code=code, defaults={"description": description}
        )


def unseed_version_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    Permission.objects.filter(
        code__in=[code for code, _ in VERSION_PERMISSIONS]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0003_seed_document_template_permissions"),
    ]

    operations = [
        migrations.RunPython(
            seed_version_permissions,
            unseed_version_permissions,
        ),
    ]
