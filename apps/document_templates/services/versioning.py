"""
Version-management business logic for document templates.

Kept out of the views so the same logic can be reused by the future document
generation service. Version rows are treated as history: their contents
(storage_path / checksum / file) are never mutated once created. The only
administrative change allowed after creation is flipping ``is_active`` —
that is the "which version is current" pointer, not version content. The DB
already locks ``template_versions.company_id`` (immutable-company trigger)
and enforces ``UNIQUE(template, version_number)``.
"""

import hashlib
import uuid

from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Max

from apps.document_templates.models import DocumentTemplate, TemplateVersion


@transaction.atomic
def create_version(template, uploaded_file, created_by=None):
    """
    Snapshot ``uploaded_file`` as a new immutable TemplateVersion of
    ``template``.

    ``uploaded_file`` is read fully into memory so the version's snapshot is
    independent of the source handle (avoids holding a file lock on
    Windows), then written back to versioned storage before the DB row is
    saved.

    The next version number is computed as (highest existing + 1), protected
    against race conditions by the DB ``UNIQUE(template, version_number)``
    constraint. The new version becomes the template's only active version.

    The parent ``DocumentTemplate`` row is locked (``SELECT ... FOR UPDATE``)
    before the active-version pointer is changed, so concurrent creation and
    activation operations for the same template are serialized and can never
    leave more than one active version (backstopped by the
    ``uq_template_version_single_active`` partial unique constraint).

    Returns the created TemplateVersion.
    """
    # Serialize version-management operations for this template: the lock is
    # held until this transaction commits, so a concurrent create/activate on
    # the same template cannot interleave its deactivate/activate sequence.
    template = DocumentTemplate.objects.select_for_update().get(pk=template.pk)

    next_number = (
        template.versions.aggregate(m=Max("version_number"))["m"] or 0
    ) + 1

    # Read fully into memory so we never keep the caller's file handle open.
    content = uploaded_file.read()
    checksum = hashlib.sha256(content).hexdigest()

    version = TemplateVersion(
        template=template,
        company=template.company,
        version_number=next_number,
        checksum=checksum,
        created_by=created_by,
    )
    version.storage_path = (
        f"templates/company_{template.company_id}/{template.id}/"
        f"v{next_number}_{uuid.uuid4().hex}.docx"
    )
    version.file.save(
        version.storage_path, ContentFile(content), save=False
    )

    # Atomically clear any other active version and mark this one active.
    TemplateVersion.objects.filter(template=template, is_active=True).update(
        is_active=False
    )
    version.is_active = True
    version.save()
    return version


def activate_version(template, version):
    """
    Make ``version`` the template's single active version. Historical
    versions are preserved (their contents are never touched); only the
    ``is_active`` flag changes.

    Concurrency-safe: the parent ``DocumentTemplate`` row is locked
    (``SELECT ... FOR UPDATE``) so two concurrent activations for different
    versions of the same template are serialized. The previous active
    version(s) are deactivated first, then the requested version is
    activated, so the ``uq_template_version_single_active`` partial unique
    constraint is never transiently violated and never ends up broken — the
    invariant "at most one active version per template" is guaranteed even
    under concurrent requests.
    """
    with transaction.atomic():
        # Serialize activation for this template (held until commit below).
        locked_template = DocumentTemplate.objects.select_for_update().get(
            pk=template.pk
        )
        if version.template_id != locked_template.id:
            raise ValueError(
                "TemplateVersion does not belong to the given DocumentTemplate."
            )

        # Deactivate existing active version(s) first, then activate the
        # requested one. Ordering matters: with the partial unique constraint
        # on is_active=True, activating BEFORE deactivating would transiently
        # violate it.
        TemplateVersion.objects.filter(
            template=locked_template, is_active=True
        ).update(is_active=False)
        version.is_active = True
        version.save(update_fields=["is_active"])
    return version
