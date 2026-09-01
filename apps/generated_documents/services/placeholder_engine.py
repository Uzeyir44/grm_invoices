"""
DOCX placeholder replacement engine (Step 4.2 of document generation).

Given a ``.docx`` template and the validated data context produced by Step 4.1
(``apps.generated_documents.services.context``), this service writes a new
``.docx`` document in which every approved ``{{ ... }}`` placeholder is
replaced by its actual value. The source template is never modified: it is
read into memory, the in-memory copy is edited, and a separate output document
is produced.

Security
--------
Only the *controlled* variable catalog from Step 3
(``apps.document_templates.variables``) is ever resolved. Placeholder keys are
normalized text (``namespace.field``) and looked up in the context dict; there
is no ``eval``, no attribute traversal, and no template-expression execution.
Unknown/malformed placeholders and missing *required* values raise a clear
error instead of producing a silently wrong document.

Placeholder syntax
------------------
    {{ company.name }}
    {{ client.voen }}
    {{ document.number }}

Whitespace and casing around the key are normalized (``{{client.name}}`` and
``{{   Company.Name   }}`` resolve to the same variable). Only the
``{{ ... }}`` form is recognized.

Supported namespaces (authoritative catalog in ``variables.py``)
----------------------------------------------------------------
    company.*    company.name, company.legal_name, company.voen,
                 company.registration_number
    client.*     client.name, client.voen, client.email, client.phone
    document.*   document.number, document.date, document.type

DOCX locations processed
------------------------
* normal body paragraphs
* table cells (including nested tables)
* existing headers/footers (only parts that already exist — no empty
  header/footer parts are created)

Split runs
----------
DOCX text is frequently split across multiple runs inside one paragraph
(e.g. ``{{ client`` + ``.name }}``). The engine concatenates the paragraph's
run text to locate placeholders and rewrites only the affected runs, so a
placeholder split across runs is still replaced while the surrounding
formatting is preserved.

Value formatting
----------------
Values are converted to text deterministically: strings pass through,
``None`` becomes the empty string, ``date``/``datetime`` become an ISO date
(``YYYY-MM-DD``), and ``Decimal`` is rendered without trailing zeros. No
localization/currency formatting is applied (deferred to a later step).

Errors
------
* :class:`UnknownPlaceholderError` — a placeholder is malformed or does not
  match any approved variable (e.g. ``{{ client.unknown_field }}``,
  ``{{ some_random_variable }}``). The engine never replaces or executes it.
* :class:`MissingRequiredValueError` — an approved *required* variable
  (``required=True`` in the catalog) has no value in the context.
* Optional variables whose value is missing/``None`` resolve to the empty
  string and never crash generation.

The engine validates the whole document before replacing anything, so all
problems are reported at once and no output is produced when validation fails.
"""

import os
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

from apps.document_templates.variables import (
    PLACEHOLDER_RE,
    VARIABLE_BY_KEY,
    _normalize_placeholder,
)

_MISSING = object()


class PlaceholderEngineError(Exception):
    """Base error for DOCX placeholder replacement failures."""


class UnknownPlaceholderError(PlaceholderEngineError):
    """A placeholder is malformed or does not match any approved variable."""


class MissingRequiredValueError(PlaceholderEngineError):
    """An approved required variable has no resolvable value."""


# ---------------------------------------------------------------------------
# Value formatting
# ---------------------------------------------------------------------------


def _format_decimal(value):
    """Render a Decimal without trailing zeros and without exponent notation."""
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def format_value(value):
    """
    Convert a single context value to its deterministic text representation.

    ``None`` becomes the empty string (the project's empty-value convention).
    Dates/datetimes render as an ISO date (``YYYY-MM-DD``), not the raw Python
    repr, so ``2026-09-01`` does not unexpectedly become
    ``2026-09-01 00:00:00``.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, Decimal):
        return _format_decimal(value)
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _resolve(key, context):
    """Resolve an approved ``namespace.field`` key against ``context``."""
    variable = VARIABLE_BY_KEY[key]
    namespace, _, field = key.partition(".")
    value = context.get(namespace, {}).get(field, _MISSING)
    if value is _MISSING or value is None:
        if variable.required:
            raise MissingRequiredValueError(
                f"Required template variable '{{{{ {key} }}}}' has no value "
                f"in the generation context."
            )
        return ""
    return format_value(value)


# ---------------------------------------------------------------------------
# Paragraph / table traversal
# ---------------------------------------------------------------------------


def _replace_paragraph(paragraph, context):
    """
    Replace every placeholder in one paragraph.

    The paragraph's run texts are concatenated so a placeholder split across
    runs is found; each affected run is then rewritten in place, preserving
    the formatting of the surrounding text.
    """
    runs = paragraph.runs
    if not runs:
        return
    full_text = "".join(r.text or "" for r in runs)
    if "{{" not in full_text:
        return
    matches = list(PLACEHOLDER_RE.finditer(full_text))
    if not matches:
        return

    spans = [
        (m.start(), m.end(), _resolve(_normalize_placeholder(m.group(1)), context))
        for m in matches
    ]

    offsets = []
    cursor = 0
    for run in runs:
        offsets.append(cursor)
        cursor += len(run.text or "")

    for index, run in enumerate(runs):
        text = run.text or ""
        if not text:
            continue
        run_start = offsets[index]
        run_end = run_start + len(text)

        pieces = []
        pos = run_start
        for span_start, span_end, replacement in spans:
            if span_end <= run_start or span_start >= run_end:
                continue
            keep_end = min(span_start, run_end)
            if keep_end > pos:
                pieces.append(text[pos - run_start : keep_end - run_start])
            if span_start >= run_start:
                pieces.append(replacement)
            pos = max(pos, min(span_end, run_end))
        if pos < run_end:
            pieces.append(text[pos - run_start : run_end - run_start])
        run.text = "".join(pieces)


def _replace_table(table, context):
    """Replace placeholders in every cell of a table (recursing into nested tables)."""
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                _replace_paragraph(paragraph, context)
            for nested in cell.tables:
                _replace_table(nested, context)


def _existing_header_footer_parts(document):
    """
    Yield only the header/footer parts a document already references.

    The python-docx high-level ``section.header`` / ``section.footer`` API
    *creates* an empty part when accessed; iterating the XML references
    instead means a template with no headers/footers is not given any.
    """
    part = document.part
    seen = set()
    for sect_pr in part.element.body.iter(qn("w:sectPr")):
        for tag in ("w:headerReference", "w:footerReference"):
            for ref in sect_pr.findall(qn(tag)):
                related_id = ref.get(qn("r:id"))
                if not related_id:
                    continue
                related = part.related_parts.get(related_id)
                if related is None or id(related) in seen:
                    continue
                seen.add(id(related))
                yield related


def _iter_document_paragraphs(document):
    """Yield every paragraph to process: body, table cells, existing headers/footers."""
    for paragraph in document.paragraphs:
        yield paragraph
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    yield paragraph
                for nested in cell.tables:
                    yield from _iter_table_paragraphs(nested)
    for part in _existing_header_footer_parts(document):
        for paragraph_element in part.element.iter(qn("w:p")):
            yield Paragraph(paragraph_element, part)


def _iter_table_paragraphs(table):
    """Yield every paragraph inside a table (including nested tables)."""
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                yield paragraph
            for nested in cell.tables:
                yield from _iter_table_paragraphs(nested)


def _validate(document, context):
    """
    Validate every placeholder in the document before any replacement.

    Raises :class:`UnknownPlaceholderError` (malformed/unknown keys) or
    :class:`MissingRequiredValueError` (approved required variable without a
    value). All problems across the whole document are reported at once.
    """
    unknown = []
    missing_required = []
    seen_unknown = set()
    seen_required = set()

    for paragraph in _iter_document_paragraphs(document):
        full_text = "".join(r.text or "" for r in paragraph.runs)
        for match in PLACEHOLDER_RE.finditer(full_text):
            raw = match.group(1)
            key = _normalize_placeholder(raw)
            if key is None or key not in VARIABLE_BY_KEY:
                if raw not in seen_unknown:
                    seen_unknown.add(raw)
                    unknown.append(
                        f"Unsupported placeholder '{{{{{raw}}}}}' does not match "
                        f"any approved template variable."
                    )
                continue
            variable = VARIABLE_BY_KEY[key]
            namespace, _, field = key.partition(".")
            value = context.get(namespace, {}).get(field, _MISSING)
            if variable.required and (value is _MISSING or value is None):
                if key not in seen_required:
                    seen_required.add(key)
                    missing_required.append(
                        f"Required template variable '{{{{ {key} }}}}' has no "
                        f"value in the generation context."
                    )

    if unknown:
        raise UnknownPlaceholderError("\n".join(unknown))
    if missing_required:
        raise MissingRequiredValueError("\n".join(missing_required))


def _replace(document, context):
    """Replace placeholders throughout the document."""
    for paragraph in _iter_document_paragraphs(document):
        _replace_paragraph(paragraph, context)
    for table in document.tables:
        _replace_table(table, context)
    for part in _existing_header_footer_parts(document):
        for paragraph_element in part.element.iter(qn("w:p")):
            _replace_paragraph(Paragraph(paragraph_element, part), context)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def _load_document(template_file):
    """Open a .docx from a path or binary file-like object."""
    try:
        if isinstance(template_file, (str, os.PathLike)):
            return Document(str(template_file))
        if hasattr(template_file, "read"):
            content = template_file.read()
            try:
                template_file.seek(0)
            except (AttributeError, OSError):
                pass
            return Document(BytesIO(content))
    except Exception as exc:
        raise PlaceholderEngineError(
            "The template is not a readable .docx file."
        ) from exc
    raise PlaceholderEngineError(
        "template_file must be a path or a binary file-like object."
    )


def _save_document(document, output_file):
    """Persist the in-memory document to a path or binary file-like object."""
    if isinstance(output_file, (str, os.PathLike)):
        document.save(str(output_file))
        return output_file
    if hasattr(output_file, "write"):
        buffer = BytesIO()
        document.save(buffer)
        buffer.seek(0)
        output_file.write(buffer.read())
        return output_file
    raise PlaceholderEngineError(
        "output_file must be a path or a binary file-like object."
    )


def render_document(template_file, output_file, context):
    """
    Render a .docx template with ``context``, producing a new document.

    Args:
        template_file: path or binary file-like object for the source .docx.
            It is read-only and never modified.
        output_file: path or binary file-like object to write the result to.
        context: the controlled template-variable context from Step 4.1, e.g.
            ``{"company": {...}, "client": {...}, "document": {...}}``.

    Returns:
        ``output_file``.

    Raises:
        UnknownPlaceholderError: the template contains a malformed or unknown
            placeholder (nothing is written).
        MissingRequiredValueError: an approved required variable has no value
            (nothing is written).
        PlaceholderEngineError: the input is not a readable .docx.
    """
    document = _load_document(template_file)
    _validate(document, context)
    _replace(document, context)
    return _save_document(document, output_file)
