"""
Document creation + automatic numbering service.

Creates a ``GeneratedDocument`` from scratch so the existing generation
pipeline (Steps 4.4–4.6) can operate on it:

    client -> document_type -> active template / template version
    -> company-scoped atomic document number (CompanyDocumentCounter)
    -> GeneratedDocument (draft)
    -> GeneratedDocumentVersion v1
    -> initial DocumentLineItem rows (if provided)
    -> audit event

Everything runs inside one ``transaction.atomic()`` block: if any step fails,
the counter increment, the document, its version, its line items and the audit
event all roll back together — no partial document survives.

Numbering deliberately reuses ``CompanyDocumentCounter.next_number()`` (a
single UPSERT…RETURNING statement). Document numbers are company-scoped,
allocated atomically, and unique, so concurrent creation for the same company
can never produce the same number.

This service does **not** perform DOCX/PDF generation — document creation and
document generation stay separate responsibilities; the caller (or the API)
invokes the existing ``generate_document`` / ``generate_pdf`` services
afterwards on the returned document.
"""

from decimal import Decimal

from django.db import transaction

from apps.audit_logs.services import create_audit_log
from apps.company_document_counters.models import CompanyDocumentCounter
from apps.document_templates.models import DocumentTemplate
from apps.generated_documents.models import (
    DocumentLineItem,
    GeneratedDocument,
    GeneratedDocumentVersion,
)
from apps.generated_documents.services.context import build_generation_context
from apps.generated_documents.services.generator import _json_safe
from apps.reference_data.models import Currency, DocumentType

_Q4 = Decimal("0.0001")


class DocumentCreationError(Exception):
    """
    Controlled document-creation failure (missing/unknown reference or active
    template state). Nothing is persisted when this is raised.
    """


def _resolve_currency(currency_id):
    if currency_id is None:
        raise DocumentCreationError(
            "A currency is required for the initial version."
        )
    currency = Currency.objects.filter(pk=currency_id).first()
    if currency is None:
        raise DocumentCreationError("Unknown currency.")
    return currency


def _resolve_template(company, document_type_id):
    if not DocumentType.objects.filter(pk=document_type_id).exists():
        raise DocumentCreationError("Unknown document type.")
    # Exactly zero or one active template may exist for (company, document
    # type): the DB enforces UNIQUE(company, document_type) among non-deleted
    # templates. A deterministic `.get()` is used instead of `.first()`, so
    # resolution can never depend on arbitrary ordering — and a corrupted
    # duplicate would surface loudly rather than being silently picked.
    try:
        template = DocumentTemplate.objects.get(
            company=company,
            document_type_id=document_type_id,
            is_active=True,
            deleted_at__isnull=True,
        )
    except DocumentTemplate.DoesNotExist:
        raise DocumentCreationError(
            "No active document template exists in this company for the "
            "selected document type."
        ) from None
    template_version = (
        template.versions.filter(is_active=True).order_by("-version_number").first()
    )
    if template_version is None:
        raise DocumentCreationError(
            "The selected template has no active version to generate from."
        )
    return template, template_version


def _compute_totals(item):
    """Monetary fields for a line item (quantity/price → subtotal/vat/total)."""
    quantity = item["quantity"]
    unit_price = item["unit_price"]
    discount = item.get("discount_percent") or Decimal("0")
    vat_rate = item["vat_rate_percent"]

    subtotal = (quantity * unit_price).quantize(_Q4)
    net = (subtotal * (Decimal("1") - discount / Decimal("100"))).quantize(_Q4)
    vat_amount = (net * vat_rate / Decimal("100")).quantize(_Q4)
    total = (net + vat_amount).quantize(_Q4)
    return subtotal, vat_amount, total


def _line_item_snapshot(index, item, computed):
    subtotal, vat_amount, total = computed
    return {
        "line_number": index,
        "description": item["description"],
        "quantity": item["quantity"],
        "unit": item.get("unit"),
        "unit_price": item["unit_price"],
        "discount_percent": item.get("discount_percent") or Decimal("0"),
        "vat_rate_percent": item["vat_rate_percent"],
        "subtotal": subtotal,
        "vat_amount": vat_amount,
        "total": total,
    }


def create_generated_document(
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
):
    """
    Create a ``GeneratedDocument`` (with its initial version and optional line
    items) plus the ``create`` audit event, atomically.

    Args:
        company: the authoritative company (``request.user.company``). A
            client-supplied company is never accepted.
        user: the acting ``User``.
        client: an already tenant-verified ``Client`` (the caller resolves it
            through the tenant helpers, so a cross-company client is a 404).
        document_type_id: ``DocumentType`` reference id (must exist).
        currency_id: optional ``Currency`` id; required when no currency can
            be derived (V1: always required — the initial version needs one).
        items: optional list of line-item inputs (validated by the API
            serializer), e.g. each with ``description``, ``quantity``,
            ``unit``, ``unit_price``, ``discount_percent``, ``vat_rate_percent``.
        ip_address / user_agent / request_id: optional request metadata for
            the audit event.

    Returns:
        The created :class:`GeneratedDocument` (status ``draft``, ``v1``
        version + line items + audit event persisted inside the transaction).

    Raises:
        DocumentCreationError: unknown reference data, an unsuitable active
            template/version, or an unresolvable currency. Nothing is
            persisted.
    """
    if client.company_id != company.id:
        raise DocumentCreationError(
            "The client does not belong to the document's company."
        )

    currency = _resolve_currency(currency_id)
    template, template_version = _resolve_template(company, document_type_id)
    items = list(items or [])

    with transaction.atomic():
        number = CompanyDocumentCounter.next_number(company.id)
        document_number = str(number)

        document = GeneratedDocument.objects.create(
            company=company,
            client=client,
            document_type_id=document_type_id,
            template=template,
            document_number=document_number,
            created_by=user,
        )

        computed_items = [_compute_totals(item) for item in items]

        # Initial-version generation snapshot: the Step 4.1 context builder for
        # the company/client/document plus the item snapshots prepared here.
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

        version = GeneratedDocumentVersion.objects.create(
            generated_document=document,
            company=company,
            version_number=1,
            template_version=template_version,
            currency=currency,
            generation_snapshot=_json_safe(context),
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
                discount_percent=item.get("discount_percent") or Decimal("0"),
                vat_rate_percent=item["vat_rate_percent"],
                currency=currency,
                subtotal=subtotal,
                vat_amount=vat_amount,
                total=total,
            )

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

    return document