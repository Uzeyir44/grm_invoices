"""
Non-persistent pre-generation document preview.

Renders the selected company template with the current (unsaved) form data into
a temporary PDF using the **same** building blocks as actual generation:

    creation input
        -> shared preparation (client/currency/template/line-item snapshots)
        -> generation context (provisional PREVIEW number + current date)
        -> placeholder engine -> rendered DOCX bytes
        -> DOCX -> PDF conversion
        -> PDF bytes returned to the caller

Nothing is written anywhere: no ``GeneratedDocument``, no
``GeneratedDocumentVersion``, no ``DocumentLineItem``, no audit event, no
document number consumed, and no file saved through Django storage. The
provisional document number is the literal ``PREVIEW`` so a preview can never
be mistaken for — or collide with — a real document number, which is only
assigned when the user actually generates the document.

The service is deliberately independent of HTTP/DRF: it takes plain values and
model instances and returns raw PDF bytes. All errors from the shared
generation services propagate unchanged so the API can map them to the same
controlled responses as Generate.
"""

from django.utils import timezone

from apps.generated_documents.services.context import build_generation_context
from apps.generated_documents.services.generate_from_input import (
    prepare_generation_input,
)
from apps.generated_documents.services.generator import _render_docx
from apps.generated_documents.services.pdf_generator import (
    PdfGenerationError,
    _is_pdf_bytes,
    convert_docx_bytes_to_pdf,
)

PREVIEW_DOCUMENT_NUMBER = "PREVIEW"


def preview_document(
    *,
    company,
    client,
    document_type_id,
    currency_id=None,
    items=None,
    document_date=None,
    converter=None,
):
    """
    Render a temporary PDF preview from creation input without persisting
    anything.

    Args:
        company: the authoritative company (``request.user.company``).
        client: an already tenant-verified ``Client``.
        document_type_id: ``DocumentType`` reference id.
        currency_id: ``Currency`` id (required, same rule as generation).
        items: optional list of line-item inputs.
        document_date: optional ISO date for ``document.date``; defaults to the
            current UTC date. Only used for the transient preview context.
        converter: optional callable ``f(docx_bytes) -> pdf_bytes``; defaults to
            LibreOffice headless. Injectable for tests.

    Returns:
        The rendered PDF bytes.

    Raises:
        DocumentCreationError: cross-company client, unknown/missing currency,
            or no active template/version. Nothing is persisted.
        GenerationContextError: required template data cannot be resolved.
        UnknownPlaceholderError / MissingRequiredValueError /
            PlaceholderEngineError / GenerationError: template rendering failed.
        PdfConversionUnavailableError / PdfGenerationError: PDF conversion
            failed.
    """
    prepared = prepare_generation_input(
        company=company,
        client=client,
        document_type_id=document_type_id,
        currency_id=currency_id,
        items=items,
    )

    if document_date is None:
        document_date = timezone.now().date().isoformat()

    context = build_generation_context(
        company=company,
        client=client,
        document=None,
        require_client=False,
        document_number=PREVIEW_DOCUMENT_NUMBER,
        document_date=document_date,
        document_type_name=prepared.template.document_type.name,
        items=prepared.item_snapshots,
    )

    rendered_bytes = _render_docx(prepared.template_version, context)

    if converter is None:
        converter = convert_docx_bytes_to_pdf
    pdf_bytes = converter(rendered_bytes)
    if not _is_pdf_bytes(pdf_bytes):
        raise PdfGenerationError(
            "DOCX -> PDF conversion produced invalid PDF output."
        )
    return pdf_bytes
