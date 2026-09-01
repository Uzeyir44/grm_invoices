"""
Reusable document-generation data context builder.

This service is the Step 4.1 piece of document generation. Given the
authoritative company / client / document objects for a generated document,
it builds the **controlled template-variable context** consumed later by the
placeholder replacement engine (Step 4.2).

It is deliberately independent of HTTP views and of the DRF request object:
it can be called from placeholder replacement, document generation, preview,
and tests with nothing but model instances.

Variable keys are taken **only** from the authoritative catalog defined in
``apps.document_templates.variables`` (Step 3). No new/unauthorised variables
are introduced here; the produced context mirrors exactly the approved
``company.*``, ``client.*`` and ``document.*`` namespaces.

Missing optional values resolve to ``None`` (the project's empty-value
convention). Missing *required* values and cross-tenant object combinations
fail loudly with :class:`GenerationContextError` rather than producing
silently wrong data.
"""

from apps.clients.models import Client


class GenerationContextError(Exception):
    """Raised when the generation data context cannot be built safely."""


def _empty(value):
    """Coerce empty strings to the project's empty-value convention (None)."""
    if value is None or value == "":
        return None
    return value


def _require(value, variable_key):
    """Return ``value`` or raise for a required variable that has no value."""
    value = _empty(value)
    if value is None:
        raise GenerationContextError(
            f"Required template variable '{variable_key}' has no resolvable value."
        )
    return value


def _assert_company_matches(attribute, company_id, obj_label):
    if getattr(attribute, "company_id", None) != company_id:
        raise GenerationContextError(
            f"{obj_label} does not belong to the document's company "
            f"(tenant mismatch)."
        )


def _assert_tenant_consistent(company, client, document):
    """
    Defense-in-depth tenant check: company, client (when present) and the
    document must all belong to the same company. The document is the
    authoritative tenant anchor; the ``company`` argument acts as the expected
    tenant (e.g. request.user.company) and must match.
    """
    document_company_id = document.company_id
    if company is not None and company.id != document_company_id:
        raise GenerationContextError(
            "The provided company does not match the document's company "
            "(tenant mismatch)."
        )
    if client is not None:
        _assert_company_matches(client, document_company_id, "Client")


def _client_name(client):
    """Human display name of a client, from its subtype data."""
    if client is None:
        return None
    if client.client_type == Client.ClientType.LEGAL_ENTITY:
        legal = getattr(client, "legal_entity", None)
        return _empty(legal.legal_name) if legal is not None else None

    individual = getattr(client, "individual", None)
    if individual is None:
        return None
    parts = [
        p
        for p in (
            individual.first_name,
            individual.middle_name,
            individual.last_name,
        )
        if p
    ]
    return " ".join(parts) or None


def _client_voen(client):
    """VOEN exists only on legal-entity clients."""
    if client is None or client.client_type != Client.ClientType.LEGAL_ENTITY:
        return None
    legal = getattr(client, "legal_entity", None)
    return _empty(legal.voen) if legal is not None else None


def _primary_contact(client):
    if client is None:
        return None
    return client.contacts.filter(is_primary=True).first()


def build_company_context(company):
    """Company portion of the context (approved company.* variables)."""
    return {
        "name": _empty(company.display_name),
        "legal_name": _empty(company.legal_name),
        "voen": _empty(company.voen),
        "registration_number": _empty(company.registration_number),
    }


def build_client_context(client):
    """Client portion of the context (approved client.* variables).

    Name/voen come from the subtype rows (legal entity vs individual);
    email/phone come from the client's primary contact. Any of these may be
    missing for optional variables, in which case they resolve to ``None``.

    A ``None`` client yields an all-``None`` client block; whether that is an
    error depends on ``require_client`` at build_generation_context time.
    """
    if client is None:
        return {"name": None, "voen": None, "email": None, "phone": None}
    contact = _primary_contact(client)
    return {
        "name": _client_name(client),
        "voen": _client_voen(client),
        "email": _empty(contact.email if contact else None),
        "phone": _empty(contact.phone if contact else None),
    }


def build_document_context(document):
    """Document portion of the context (approved document.* variables)."""
    return {
        "number": _require(document.document_number, "document.number"),
        "date": _require(
            document.created_at.date().isoformat()
            if document.created_at is not None
            else None,
            "document.date",
        ),
        "type": _require(document.document_type.name, "document.type"),
    }


def build_generation_context(company=None, client=None, document=None, *, require_client=True):
    """
    Build the validated template data context for a generated document.

    Args:
        company:  the expected tenant (e.g. the authenticated user's company).
                  If not given, ``document.company`` is the tenant anchor.
        client:   the document's client. Defaults to ``document.client``.
                  For a document with no client this is ``None``.
        document: the GeneratedDocument being rendered.
        require_client: when True (default), a document with no client is a
                  hard error (client.name is a required variable).

    Returns a nested dict::

        {
            "company":   {"name", "legal_name", "voen", "registration_number"},
            "client":    {"name", "voen", "email", "phone"},
            "document":  {"number", "date", "type"},
        }

    Raises:
        GenerationContextError on tenant mismatch or missing required data.
    """
    if document is None:
        raise GenerationContextError("A GeneratedDocument is required.")
    if client is None:
        client = document.client
    if company is None:
        company = document.company

    _assert_tenant_consistent(company, client, document)

    client_context = build_client_context(client)
    if require_client and client_context["name"] is None:
        raise GenerationContextError(
            "Required template variable 'client.name' cannot be resolved: the "
            "document has no client."
        )

    return {
        "company": build_company_context(company),
        "client": client_context,
        "document": build_document_context(document),
    }


def flat_context_keys(context):
    """
    All ``namespace.key`` keys present in a built context, e.g.
    ``{"company.name", "client.email", ...}``. Used to assert the variable
    contract (the produced context only contains approved keys).
    """
    keys = set()
    for namespace, fields in context.items():
        for field in fields:
            keys.add(f"{namespace}.{field}")
    return keys