"""
Complete DOCX generation service (Step 4.4 of document generation).

Orchestrates the Steps 4.1–4.3 pieces into one end-to-end flow:

    GeneratedDocument
        -> selected TemplateVersion (active)
        -> Step 4.1 context builder (company/client/document/items)
        -> Step 4.2/4.3 placeholder engine (placeholders + repeating items)
        -> rendered DOCX bytes
        -> GeneratedDocumentVersion persisted (file + metadata)

The service is deliberately independent of HTTP/DRF: it takes a
``GeneratedDocument`` (and a few optional rendering parameters) and returns
the created :class:`GeneratedDocumentVersion`. It records exactly which
template version produced the artifact for reproducibility, keeps the stored
template untouched, and never overwrites a previous generated version —
regenerating the same document creates version #2, #3, ... and all versions
remain retrievable.

The generated document output is **DOCX only**. PDF generation, a generation
API and download endpoints are separate later steps.

Storage / schema notes
----------------------
``GeneratedDocumentVersion`` stores its output as a storage *path* only
(``storage_path_docx``) — it has no ``file`` FileField. The rendered bytes are
therefore persisted through Django's configured default storage and the
returned relative path is recorded on the version. The schema is unchanged:
this step requires NO migration.

Security / tenant safety
------------------------
* No ``eval``/``exec`` — placeholder replacement stays inside the Step 4.2
  engine and only resolves the approved variable catalog.
* The authoritative tenant remains ``generated_document.company``. The
  selected ``TemplateVersion`` must belong to the document's template *and*
  company; the Step 4.1 context builder re-checks company/client/document
  consistency. Cross-tenant combinations fail with a clear error.
* Filenames are derived from the document number/version and sanitized; the
  document number is never used verbatim as a filesystem path.

Failure behavior
----------------
If placeholder validation fails (``UnknownPlaceholderError``,
``MissingRequiredValueError``), the generation context cannot be built
(``GenerationContextError``), or no active template version exists, no
``GeneratedDocumentVersion`` is created, no file is persisted, and the
document status is left unchanged. The relevant exception propagates.

Failure behavior is implemented without a full DB round-trip per selector,
so no misleading "successful" version is ever recorded.
"""

import re
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Max

from apps.generated_documents.models import GeneratedDocument, GeneratedDocumentVersion
from apps.generated_documents.services.context import build_generation_context
from apps.generated_documents.services.placeholder_engine import render_document


class GenerationError(Exception):
    """
    Orchestration-level error in the complete DOCX generation flow
    (missing template/version/file, tenant mismatch, version mismatch,
    unresolvable currency, ...).
    """


def select_template_version(generated_document):
    """
    Select the TemplateVersion used to render ``generated_document``.

    Business rule (existing architecture): the template's single **active**
    version is the one used for generation; a document never selects its own
    template version. Returns ``None`` if the template has no active version.
    """
    template = generated_document.template
    if template is None:
        return None
    return (
        template.versions.filter(is_active=True)
        .order_by("-version_number")
        .first()
    )


def next_version_number(generated_document):
    """Next safe ``version_number`` for a document (highest existing + 1)."""
    latest = (
        GeneratedDocumentVersion.objects.filter(
            generated_document=generated_document
        ).aggregate(m=Max("version_number"))["m"]
    )
    return (latest or 0) + 1


def _generate_context(generated_document):
    """
    Step 4.1: build the controlled generation context.

    ``version`` is intentionally left unset so the context builder pulls line
    items from the document's latest existing version (empty on first run).
    """
    return build_generation_context(document=generated_document)


def _render_docx(template_version, context):
    """
    Step 4.2/4.3: render the template file through the placeholder engine.

    Returns the rendered DOCX as bytes. The stored template file is only read,
    never modified. Placeholder/validation errors propagate before anything is
    persisted.
    """
    template_file = template_version.file
    if not template_file:
        raise GenerationError(
            f"TemplateVersion {template_version.id} has no file to render."
        )
    try:
        template_file.open("rb")
        template_bytes = template_file.read()
    finally:
        try:
            template_file.close()
        except (AttributeError, OSError):
            pass

    output = BytesIO()
    render_document(BytesIO(template_bytes), output, context)
    return output.getvalue()


def _resolve_currency(generated_document, currency):
    """
    Determine the version-level currency.

    Uses the explicit ``currency`` argument when given; otherwise derives it
    from the first line item of the document's latest existing version (the
    source of the ``items`` being rendered). Fails loudly if neither source
    provides one (the model requires a currency).
    """
    if currency is not None:
        return currency
    source_version = generated_document.versions.order_by("-version_number").first()
    if source_version is not None:
        first_item = source_version.line_items.order_by("line_number").first()
        if first_item is not None and first_item.currency_id:
            return first_item.currency
    raise GenerationError(
        "A currency is required for the generated version: pass `currency`, or "
        "give the document's source version at least one line item with a "
        "currency."
    )


def _generated_storage_path(generated_document, version_number):
    """
    Deterministic, safe storage path for a generated DOCX.

    Only the document number and version number are used, and the number is
    sanitized so no path-traversal or unsafe characters can reach the
    filesystem.
    """
    safe_number = re.sub(r"[^A-Za-z0-9_-]+", "_", generated_document.document_number)
    if not safe_number:
        safe_number = f"doc_{generated_document.id}"
    return (
        f"generated/company_{generated_document.company_id}/doc_{generated_document.id}/"
        f"v{version_number}/{safe_number}-v{version_number}.docx"
    )


def _assert_template_version_matches_document(template_version, generated_document):
    """
    Defense-in-depth tenant/template check before persisting a version.

    The authoritative tenant is ``generated_document.company``; the selected
    ``TemplateVersion`` (a snapshot of the document's template) must belong to
    that company. The Step 4.1 context builder independently re-checks the
    company/client/document consistency.
    """
    if template_version.template_id != generated_document.template_id:
        raise GenerationError(
            "TemplateVersion does not belong to the document's template "
            "(template mismatch)."
        )
    if template_version.company_id != generated_document.company_id:
        raise GenerationError(
            "TemplateVersion does not belong to the document's company "
            "(tenant mismatch)."
        )


def _json_safe(value):
    """
    Convert the generation context into a JSON-serializable structure so it
    can be stored verbatim in ``generation_snapshot`` (the DB JSON adapter does
    not serialize ``Decimal``/``date`` directly). Mirrors DjangoJSONEncoder.
    """
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def generate_document(
    generated_document,
    *,
    currency=None,
    exchange_rate_used=None,
    vat_rate_used_percent=None,
    generated_by=None,
):
    """
    Generate and persist a complete DOCX for ``generated_document``.

    Args:
        generated_document: the ``GeneratedDocument`` to render.
        currency: optional ``Currency`` for the generated version. When omitted
            it is derived from the first line item of the document's latest
            existing version.
        exchange_rate_used / vat_rate_used_percent: optional snapshots recorded
            on the generated version.
        generated_by: optional ``User`` recorded as the generator.

    Returns:
        The created :class:`GeneratedDocumentVersion`.

    Raises:
        GenerationContextError: the document lacks required data (e.g. no
            client) or a tenant mismatch is detected by the Step 4.1 builder.
        UnknownPlaceholderError / MissingRequiredValueError /
        PlaceholderEngineError: the template failed placeholder validation.
        GenerationError: no active template version / template file, template
            mismatch, or no resoluable currency. Nothing is persisted.

    On success, if the document status was ``draft`` it is advanced to
    ``generated``. Regenerating the same document always creates a NEW version
    and never overwrites a previous one.
    """
    if generated_document is None:
        raise GenerationError("A GeneratedDocument is required.")

    template_version = select_template_version(generated_document)
    if template_version is None:
        raise GenerationError(
            "The document's template has no active TemplateVersion to render from."
        )
    _assert_template_version_matches_document(template_version, generated_document)

    context = _generate_context(generated_document)
    rendered_bytes = _render_docx(template_version, context)

    with transaction.atomic():
        locked_document = (
            GeneratedDocument.objects.select_for_update().get(pk=generated_document.pk)
        )
        version_number = next_version_number(locked_document)
        resolved_currency = _resolve_currency(locked_document, currency)

        storage_path = _generated_storage_path(locked_document, version_number)
        # A path with this version number can only exist as an orphan from a
        # previous failed attempt (version numbers are never reused), so remove
        # it before saving to keep the recorded path deterministic.
        default_storage.delete(storage_path)
        stored_name = default_storage.save(storage_path, ContentFile(rendered_bytes))

        version = GeneratedDocumentVersion(
            generated_document=locked_document,
            company=locked_document.company,
            version_number=version_number,
            template_version=template_version,
            currency=resolved_currency,
            exchange_rate_used=exchange_rate_used,
            vat_rate_used_percent=vat_rate_used_percent,
            generation_snapshot=_json_safe(context),
            generation_metadata={"engine_version": "4.4"},
            storage_path_docx=stored_name,
            generated_by=generated_by,
        )
        try:
            version.save()
        except Exception:
            # The DB row (and anything else in this transaction) rolled back;
            # the file was already written to storage, so remove it to avoid an
            # orphan file that looks like a successful generation.
            default_storage.delete(stored_name)
            raise

        if locked_document.status == GeneratedDocument.Status.DRAFT:
            GeneratedDocument.objects.filter(pk=locked_document.pk).update(
                status=GeneratedDocument.Status.GENERATED
            )

    return version