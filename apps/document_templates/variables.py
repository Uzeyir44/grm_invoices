"""
Single authoritative definition of the controlled template-variable
namespace and the placeholder validator.

Purpose
-------
Document templates may reference a *controlled* set of variables (no
arbitrary Python/Django expressions are ever evaluated). This module is the
one place the future document-generation engine reads the same definitions,
so validation here and resolution in Step 4 stay in sync.

Supported namespaces
--------------------
    company.*    fields on apps.companies.Company
    client.*     resolved fields on a Client (legal-entity / individual)
    document.*   fields on / derived from a GeneratedDocument

Placeholder syntax
------------------
    {{ company.name }}
    {{ client.name }}
    {{ document.number }}

Repeating sections (item.* variables)
-------------------------------------
    {{#each items}}
    {{ item.description }}
    {{/each}}

``{{#each items}}`` / ``{{/each}}`` are control markers (not catalog
variables) and are skipped by the validator; ``items`` is the only supported
collection (mirroring the generation engine's ``EACH_COLLECTION``). An
unknown collection such as ``{{#each bogus}}`` is flagged as invalid.
Structural concerns (unbalanced/nested sections, ``item.*`` outside a
section, table-row marker placement) are render-time checks performed by the
placeholder engine, not by this text validator.

Only the ``{{ path }}`` form is recognized. Validation is text-based; it
turns any ``{{ ... }}`` into a normalized ``namespace.field`` key and checks
it against the catalog.

IMPORTANT: placeholder validation and the variable catalog are VALIDATION
ONLY. No value is ever resolved or inserted here — replacement is Step 4.
"""

import re
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Variable catalog
#
# Each entry describes a variable the templates may reference. ``source`` and
# ``data_type`` describe where the value will come from during generation
# (Step 4); nothing is resolved now.
#
# Only fields that actually exist in the current models are listed. Nothing
# is invented here. Resolution details (e.g. client legal_name vs individual
# full name) are left to the generation engine, but the keys are valid.
# ---------------------------------------------------------------------------

PLACEHOLDER_RE = re.compile(r"\{\{\s*(.*?)\s*\}\}")
VARIABLE_KEY_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$", re.IGNORECASE)

# Control-marker recognition mirrors the generation engine's regexes
# (apps/generated_documents/services/placeholder_engine.EACH_RE /
# END_EACH_RE): case-sensitive, collection name must be a bare lowercase
# identifier, and only EACH_COLLECTION ("items") is supported.
EACH_MARKER_RE = re.compile(r"^#each\s+([a-z][a-z0-9_]*)$")
END_EACH_MARKER_RE = re.compile(r"^/each$")


def _is_each_marker(raw):
    """Return the collection name if ``raw`` is a well-formed ``#each`` marker."""
    match = EACH_MARKER_RE.match(raw)
    return match.group(1) if match else None


@dataclass(frozen=True)
class TemplateVariable:
    key: str
    label: str
    source: str
    data_type: str
    required: bool = False


VARIABLES = [
    # company.* — apps.companies.Company
    TemplateVariable("company.name", "Company name", "company.display_name", "string"),
    TemplateVariable("company.legal_name", "Company legal name", "company.legal_name", "string"),
    TemplateVariable("company.voen", "Company VOEN", "company.voen", "string"),
    TemplateVariable(
        "company.registration_number", "Company registration number", "company.registration_number", "string"
    ),
    # client.* — resolved from Client (legal-entity / individual) + contacts
    TemplateVariable("client.name", "Client name", "client.name", "string", required=True),
    TemplateVariable("client.voen", "Client VOEN", "client.legal_entity.voen", "string"),
    TemplateVariable("client.email", "Client email", "client.primary_contact.email", "string"),
    TemplateVariable("client.phone", "Client phone", "client.primary_contact.phone", "string"),
    # document.* — apps.generated_documents.GeneratedDocument
    TemplateVariable("document.number", "Document number", "document.document_number", "string", required=True),
    TemplateVariable("document.date", "Document date", "document.created_at", "date", required=True),
    TemplateVariable("document.type", "Document type", "document.document_type.name", "string", required=True),
    # item.* — inside {{#each items}} repeating sections only; resolved from
    # DocumentLineItem (the line items of a GeneratedDocumentVersion).
    TemplateVariable("item.line_number", "Line number", "item.line_number", "integer"),
    TemplateVariable("item.description", "Description", "item.description", "string"),
    TemplateVariable("item.quantity", "Quantity", "item.quantity", "decimal"),
    TemplateVariable("item.unit", "Unit", "item.unit", "decimal"),
    TemplateVariable("item.unit_price", "Unit price", "item.unit_price", "decimal"),
    TemplateVariable("item.discount_percent", "Discount percent", "item.discount_percent", "decimal"),
    TemplateVariable("item.vat_rate_percent", "VAT rate percent", "item.vat_rate_percent", "decimal"),
    TemplateVariable("item.subtotal", "Subtotal", "item.subtotal", "decimal"),
    TemplateVariable("item.vat_amount", "VAT amount", "item.vat_amount", "decimal"),
    TemplateVariable("item.total", "Total", "item.total", "decimal"),
]

# The name of the repeating collection provided by the generation context.
# ``{{#each items}}`` iterates the document's line items; each iteration
# exposes the ``item.*`` variables above.
EACH_COLLECTION = "items"

# Fast lookup keyed by the placeholder key.
VARIABLE_BY_KEY = {v.key: v for v in VARIABLES}


def valid_variable_keys():
    """All valid placeholder keys (namespace.field), e.g. 'company.name'."""
    return sorted(VARIABLE_BY_KEY)


def _normalize_placeholder(raw):
    """
    Normalize the text captured between ``{{ `` and `` }}`` into a lookup key.

    Returns the normalized key, or None if the syntax is unsupported/malformed.
    """
    text = raw.strip()
    if not text:
        return None
    # Only allow the simple namespace.field path; reject expressions,
    # calls, indexing, operators, whitespace-in-key, etc.
    if not VARIABLE_KEY_RE.match(text):
        return None
    return text.lower()


def validate_placeholders(text):
    """
    Validate template ``text`` against the controlled variable catalog.

    Args:
        text: the plain-text content of the template (extracted from the
              .docx by the caller).

    Returns:
        (valid_placeholders, invalid_placeholders)
            valid_placeholders   -> list of recognized ''{{ key }}'' strings
            invalid_placeholders -> list of ''{{ ... }}'' strings that are
                                    malformed, reference an unknown variable,
                                    or name an unsupported repeating
                                    collection. Well-formed ''{{#each items}}''
                                    / ''{{/each}}'' markers are control tokens
                                    and appear in neither list.
    """
    valid = []
    invalid = []
    for match in PLACEHOLDER_RE.finditer(text):
        raw = match.group(1)
        stripped = raw.strip()
        # ``{{/each}}`` is a closing control marker — skip it.
        if END_EACH_MARKER_RE.match(stripped):
            continue
        # ``{{#each items}}`` is an opening control marker. A well-formed
        # marker for the supported collection is skipped; a well-formed marker
        # for any other collection is invalid (fail-fast, like the renderer).
        collection = _is_each_marker(stripped)
        if collection is not None:
            if collection == EACH_COLLECTION:
                continue
            invalid.append("{{%s}}" % raw)
            continue
        key = _normalize_placeholder(raw)
        if key is not None and key in VARIABLE_BY_KEY:
            valid.append(f"{{{{ {key} }}}}")
        else:
            invalid.append("{{%s}}" % raw)
    return valid, invalid


def placeholder_is_valid(placeholder):
    """True if the single ``{{ ... }}`` placeholder is valid."""
    valid, invalid = validate_placeholders(placeholder)
    return bool(valid) and not invalid


def has_invalid_placeholders(text):
    """True if ``text`` contains any malformed/unknown placeholder."""
    _valid, invalid = validate_placeholders(text)
    return bool(invalid)
