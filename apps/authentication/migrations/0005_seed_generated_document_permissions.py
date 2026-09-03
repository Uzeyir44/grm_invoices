"""
Seeds the Permission catalog with the generated-document permission codes used
by the Step 4.6 generation/download API.

Permission is a fixed, application-defined catalog (the `permissions` table,
owned by apps.authentication). Making the generation and download endpoints
usable requires these codes to exist. Data-only — no schema change.
"""

from django.db import migrations

GENERATED_DOCUMENT_PERMISSIONS = [
    (
        "generated_documents.read",
        "Read generated documents and download their files",
    ),
    (
        "generated_documents.generate",
        "Generate documents and convert them to PDF",
    ),
]


def seed_generated_document_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    for code, description in GENERATED_DOCUMENT_PERMISSIONS:
        Permission.objects.update_or_create(
            code=code, defaults={"description": description}
        )


def unseed_generated_document_permissions(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    Permission.objects.filter(
        code__in=[code for code, _ in GENERATED_DOCUMENT_PERMISSIONS]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0004_seed_document_template_version_permissions"),
    ]

    operations = [
        migrations.RunPython(
            seed_generated_document_permissions,
            unseed_generated_document_permissions,
        ),
    ]