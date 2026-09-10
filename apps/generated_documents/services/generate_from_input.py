"""
Atomic create + DOCX + PDF generation from raw creation input.

Unlike the historical two-request choreography (``POST /api/generated-documents/``
creates a persistent ``draft`` + an empty ``v1`` shell, then
``POST .../<id>/generate/`` renders the DOCX as ``v2``), this service performs
the whole workflow as ONE database transaction:

    creation input
        -> company-scoped atomic document number (CompanyDocumentCounter)
        -> GeneratedDocument (created directly with status ``generated``)
        -> render DOCX from the active template version (Step 4.2/4.3 engine)
        -> GeneratedDocumentVersion v1 (DOCX path recorded at INSERT)
        -> DocumentLineItem rows
        -> DOCX -> PDF conversion, PDF path attached to the same v1
        -> audit events (create + generate + generate_pdf, same shapes as the
           step-wise flow)

On success the document's first version is ``version_number = 1`` carrying both
files — no artificial empty shell version is created.

Everything runs inside one ``transaction.atomic()`` block, so a failure at any
step rolls back the document, its version, its line items, the audit events
*and* the counter increment together — no persistent draft remains and no
document number is consumed. Files are not transactional, so every path saved
through Django storage is tracked and removed if the transaction fails (the
same orphan-cleanup pattern the Step 4.4 service uses); a failed call leaves
neither database rows nor generated files behind.

This service reuses the existing building blocks without duplicating them:
input/currency/template resolution and line-item math from
:mod:`document_creation`, DOCX rendering + storage-path conventions from
:mod:`generator`, and PDF conversion from :mod:`pdf_generator`. It is
independent of HTTP/DRF: it takes plain values and model instances and returns
the created :class:`GeneratedDocument`.
"""

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction

from apps.audit_logs.services import create_audit_log
from apps.company_document_counters.models import CompanyDocumentCounter
from apps.generated_documents.models import (
    DocumentLineItem,
    GeneratedDocument,
    GeneratedDocumentVersion,
)
from apps.generated_documents.services.context import build_generation_context
from apps.generated_documents.services.document_creation import (
    DocumentCreationError,
    _compute_totals,
    _line_item_snapshot,
    _resolve_currency,
    _resolve_template,
)
from apps.generated_documents.services.generator import (
    _generated_storage_path,
    _json_safe,
    _render_docx,
)
from apps.generated_documents.services.pdf_generator import (
    PdfGenerationError,
    _is_pdf_bytes,
    convert_docx_bytes_to_pdf,
)


def generate_document_from_input(
    *,
    company,
    user,
    client,
    document_type_id,
    currency_id=None,
    items=None,
    ip_address=None,
    user_agent=None,
    request_id=None,
    converter=None,
):
    """
    Atomically create a ``GeneratedDocument`` from creation input and generate
    its DOCX + PDF as version 1.

    Args:
        company: the authoritative company (``request.user.company``). A
            client-supplied company is never accepted.
        user: the acting ``User``.
        client: an already tenant-verified ``Client`` (the caller resolves it
            through the tenant helpers, so a cross-company client is a 404
            before this service is reached).
        document_type_id: ``DocumentType`` reference id (must exist; the
            company needs an active template with an active version for it).
        currency_id: ``Currency`` id for the generated version (required, same
            rule as document creation).
        items: optional list of line-item inputs (validated by the API
            serializer), each with ``description``, ``quantity``, ``unit``,
            ``unit_price``, ``discount_percent``, ``vat_rate_percent``.
        ip_address / user_agent / request_id: optional request metadata for
            the audit events.
        converter: optional callable ``f(docx_bytes) -> pdf_bytes`` used for
            the DOCX -> PDF conversion; defaults to LibreOffice headless.
            Injectable for tests.

    Returns:
        The created :class:`GeneratedDocument` (status ``generated``, ``v1``
        version + line items + DOCX + PDF + audit events persisted inside the
        transaction).

    Raises:
        DocumentCreationError: the client does not belong to the company, the
            currency is unknown/missing, or no active template/version exists.
            Nothing is persisted.
        GenerationContextError: required template data cannot be resolved.
            Nothing is persisted.
        UnknownPlaceholderError / MissingRequiredValueError /
            PlaceholderEngineError / GenerationError: template rendering
            failed. Nothing is persisted.
        PdfConversionUnavailableError / PdfGenerationError: PDF conversion
            failed. Nothing is persisted — the whole operation (including the
            rendered DOCX and its database rows) rolls back.
    """
    if client.company_id != company.id:
        raise DocumentCreationError(
            "The client does not belong to the document's company."
        )

    currency = _resolve_currency(currency_id)
    template, template_version = _resolve_template(company, document_type_id)
    items = list(items or [])

    if converter is None:
        converter = convert_docx_bytes_to_pdf

    with transaction.atomic():
        number = CompanyDocumentCounter.next_number(company.id)
        document_number = str(number)

        document = GeneratedDocument.objects.create(
            company=company,
            client=client,
            document_type_id=document_type_id,
            template=template,
            document_number=document_number,
            status=GeneratedDocument.Status.GENERATED,
            created_by=user,
        )

        computed_items = [_compute_totals(item) for item in items]

        # Generation context from the company/client/document plus the item
        # snapshots prepared here (same construction as document creation).
        context = build_generation_context(
            company=company,
            client=client,
            document=document,
            require_client=False,
        )
        context["items"] = [
            _line_item_snapshot(index, item, computed)
            for index, (item, computed) in enumerate(zip(items, computed_items), start=1)
        ]

        rendered_bytes = _render_docx(template_version, context)

        docx_path = _generated_storage_path(document, 1)
        # A path for this document can only exist as an orphan from a previous
        # failed attempt, so remove it before saving to keep the recorded path
        # deterministic (mirrors the Step 4.4 orphan handling).
        default_storage.delete(docx_path)
        stored_docx = default_storage.save(docx_path, ContentFile(rendered_bytes))
        saved_paths = [stored_docx]
        try:
            version = GeneratedDocumentVersion.objects.create(
                generated_document=document,
                company=company,
                version_number=1,
                template_version=template_version,
                currency=currency,
                generation_snapshot=_json_safe(context),
                generation_metadata={"engine_version": "4.4"},
                storage_path_docx=stored_docx,
                generated_by=user,
            )

            for index, (item, computed) in enumerate(
                zip(items, computed_items), start=1
            ):
                subtotal, vat_amount, total = computed
                DocumentLineItem.objects.create(
                    generated_document_version=version,
                    company=company,
                    line_number=index,
                    description=item["description"],
                    quantity=item["quantity"],
                    unit=item.get("unit"),
                    unit_price=item["unit_price"],
                    discount_percent=item.get("discount_percent") or 0,
                    vat_rate_percent=item["vat_rate_percent"],
                    currency=currency,
                    subtotal=subtotal,
                    vat_amount=vat_amount,
                    total=total,
                )

            pdf_bytes = converter(rendered_bytes)
            if not _is_pdf_bytes(pdf_bytes):
                raise PdfGenerationError(
                    "DOCX -> PDF conversion produced invalid PDF output."
                )
            pdf_path = docx_path[: -len(".docx")] + ".pdf"
            default_storage.delete(pdf_path)
            stored_pdf = default_storage.save(pdf_path, ContentFile(pdf_bytes))
            saved_paths.append(stored_pdf)

            # Narrowly allowed by migration 0003 (the lone changed column is
            # storage_path_pdf); every other version column stays immutable.
            version.storage_path_pdf = stored_pdf
            version.save(update_fields=["storage_path_pdf"])

            create_audit_log(
                company=company,
                user=user,
                action="create",
                entity_type="generated_document",
                entity_id=document.id,
                previous_values=None,
                new_values={
                    "document_number": document_number,
                    "document_type_id": document_type_id,
                    "template_id": template.id,
                    "client_id": client.id,
                    "version_number": 1,
                },
                ip_address=ip_address,
                user_agent=user_agent,
                request_id=request_id,
            )
            create_audit_log(
                company=company,
                user=user,
                action="generate",
                entity_type="generated_document",
                entity_id=document.id,
                previous_values=None,
                new_values={
                    "document_number": document_number,
                    "document_type_id": document_type_id,
                    "template_id": template.id,
                    "version_number": 1,
                    "template_version_id": template_version.id,
                    "status": GeneratedDocument.Status.GENERATED,
                },
            )
            create_audit_log(
                company=company,
                user=user,
                action="generate_pdf",
                entity_type="generated_document_version",
                entity_id=version.id,
                previous_values=None,
                new_values={
                    "generated_document_id": document.id,
                    "version_number": 1,
                },
            )
        except Exception:
            # The database rows roll back with the transaction; the files
            # already written to storage do not, so remove exactly the paths
            # this call saved to avoid orphan files that look like a
            # successful generation. Never touches unrelated files.
            for path in saved_paths:
                default_storage.delete(path)
            raise

    return document
