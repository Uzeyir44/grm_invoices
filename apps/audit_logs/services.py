"""
Audit event writer (Step 5.1).

A small, reusable application-layer helper that creates :class:`AuditLog`
records for future business-operation integrations (clients, document
templates, generated documents, PDF generation, company settings/branding).
It records into the existing ``apps.audit_logs.AuditLog`` model only — there
is no second audit system.

Guarantees
----------
* **Tenant safety** — the caller must supply the ``company`` explicitly. If a
  ``user`` is supplied, the user must belong to that company
  (``user.company == company``); anything else raises
  :class:`AuditTenantMismatchError`. The company is never inferred or silently
  corrected. The database composite FK/composite-key protections remain the
  final integrity boundary.
* **Sensitive-data sanitization** — ``previous_values`` / ``new_values`` may
  contain arbitrary JSON-compatible snapshots from future integrations, so the
  writer redacts authentication/security values (passwords, tokens, MFA
  secrets, API keys, authorization material, …) at any nesting depth, replacing
  them with ``[REDACTED]``. The caller's dicts/lists are never mutated.
* **JSON compatibility** — payloads are validated against strict standard JSON
  (`json.dumps`), matching what the PostgreSQL driver actually accepts for the
  model's JSONField, so unsupported values fail predictably at the service
  boundary instead of at the database.
* **Transaction friendly** — the writer performs a plain ORM ``create`` and
  introduces no transaction of its own, so the audit row participates in the
  caller's surrounding ``transaction.atomic()`` block; a rollback removes it
  together with the business change.

Audit rows remain append-only: there is deliberately no update/delete helper
here, and the database immutability trigger is unchanged.
"""

import json
import uuid

from apps.audit_logs.models import AuditLog
from apps.authentication.models import User
from apps.clients.models import Client
from apps.document_templates.models import DocumentTemplate, TemplateVersion
from apps.generated_documents.models import GeneratedDocument, GeneratedDocumentVersion

REDACTED_MARKER = "[REDACTED]"

# Case-insensitive key matches. Substring matching is intentional: it also
# covers composite names such as ``access_token``, ``hashed_password``,
# ``mfa_secret_encrypted``, ``api_key``.
SENSITIVE_FIELD_SUBSTRINGS = (
    "password",
    "password_hash",
    "raw_password",
    "mfa_secret",
    "mfa_secret_encrypted",
    "token",
    "access_token",
    "refresh_token",
    "authorization",
    "api_key",
    "secret",
)


class AuditLogError(Exception):
    """Base error for the audit event writer service."""


class AuditTenantMismatchError(AuditLogError):
    """A supplied user does not belong to the supplied company."""


def is_sensitive_key(key):
    """True when a (nested) dict key should have its value redacted."""
    return any(part in str(key).lower() for part in SENSITIVE_FIELD_SUBSTRINGS)


def sanitize_audit_payload(value):
    """
    Return a deep, redacted *copy* of ``value``.

    Sensitive keys are replaced by ``[REDACTED]`` wherever they appear (top
    level or nested in dicts/lists). The input object is never mutated.
    Scalars and non-sensitive structures pass through unchanged.
    """
    if value is None:
        return value
    if isinstance(value, dict):
        return {
            key: (
                REDACTED_MARKER
                if is_sensitive_key(key)
                else sanitize_audit_payload(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [sanitize_audit_payload(item) for item in value]
    return value


def _validate_json_compatible(value, field_name):
    """Fail fast if a payload cannot be stored by the model's JSONField.

    The PostgreSQL driver serializes JSON with the standard ``json.dumps``
    encoder, so the same rule is applied here (no Decimal/date/uuid/objects).
    """
    try:
        json.dumps(value)
    except (TypeError, ValueError) as exc:
        raise AuditLogError(
            f"Audit log '{field_name}' must contain JSON-serializable data."
        ) from exc


def _coerce_request_id(request_id):
    """Normalize ``request_id`` to a UUID instance, preserving provided values."""
    if request_id is None:
        return None
    if isinstance(request_id, uuid.UUID):
        return request_id
    try:
        return uuid.UUID(str(request_id))
    except (TypeError, ValueError, AttributeError) as exc:
        raise AuditLogError("request_id must be a valid UUID.") from exc


def diff_snapshots(previous, new):
    """
    Reduce two before/after snapshots to the *changed* fields only.

    Returns ``(previous, new)`` where both are dicts (possibly empty) covering
    exactly the top-level keys whose values differ. Used by update integrations
    so audit payloads stay small and do not log unchanged fields. The input
    dicts are never mutated.
    """
    if previous is None and new is None:
        return {}, {}
    previous = previous or {}
    new = new or {}
    prev_changed = {}
    new_changed = {}
    for key in set(previous) | set(new):
        if previous.get(key) != new.get(key):
            if key in previous:
                prev_changed[key] = previous[key]
            if key in new:
                new_changed[key] = new[key]
    return prev_changed, new_changed


def request_metadata(request):
    """
    Extract safe request metadata from an ``HttpRequest`` for audit events.

    Convenience only — ``create_audit_log`` itself never requires an
    ``HttpRequest``; it accepts these values explicitly.
    """
    ip_address = request.META.get("HTTP_X_FORWARDED_FOR")
    if ip_address:
        ip_address = ip_address.split(",")[0].strip()
    if not ip_address:
        ip_address = request.META.get("REMOTE_ADDR")
    return {
        "ip_address": ip_address or None,
        "user_agent": request.META.get("HTTP_USER_AGENT"),
    }


def create_audit_log(
    *,
    company,
    user=None,
    action,
    entity_type,
    entity_id,
    previous_values=None,
    new_values=None,
    ip_address=None,
    user_agent=None,
    request_id=None,
):
    """
    Create and return one :class:`AuditLog` row.

    Args:
        company: the ``Company`` tenant the event belongs to (required, never
            inferred from other arguments).
        user: the acting ``User`` (optional). Must belong to ``company``.
        action: required event verb, e.g. ``client.created``.
        entity_type: required affected entity type, e.g. ``client``.
        entity_id: required primary key of the affected entity.
        previous_values / new_values: optional JSON-compatible before/after
            snapshots; sensitive fields are redacted before storing.
        ip_address / user_agent / request_id: optional request metadata,
            supplied explicitly by the caller (the service never requires an
            ``HttpRequest``).

    Returns:
        The created :class:`AuditLog`.

    Raises:
        AuditTenantMismatchError: ``user`` does not belong to ``company``.
        AuditLogError: required fields are missing or ``request_id``/payloads
            are invalid.
    """
    if company is None:
        raise AuditLogError("A company is required for an audit event.")
    if not action or not str(action).strip():
        raise AuditLogError("An action is required for an audit event.")
    if not entity_type or not str(entity_type).strip():
        raise AuditLogError("An entity_type is required for an audit event.")
    if entity_id is None:
        raise AuditLogError("An entity_id is required for an audit event.")

    if user is not None and user.company_id != company.id:
        raise AuditTenantMismatchError(
            "The audit event user does not belong to the supplied company."
        )

    sanitized_previous = sanitize_audit_payload(previous_values)
    sanitized_new = sanitize_audit_payload(new_values)
    if sanitized_previous is not None:
        _validate_json_compatible(sanitized_previous, "previous_values")
    if sanitized_new is not None:
        _validate_json_compatible(sanitized_new, "new_values")

    # Plain ORM create: it joins the caller's ambient transaction when one is
    # active (no separate transaction is started here).
    return AuditLog.objects.create(
        company=company,
        user=user,
        action=str(action).strip(),
        entity_type=str(entity_type).strip(),
        entity_id=entity_id,
        previous_values=sanitized_previous,
        new_values=sanitized_new,
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=_coerce_request_id(request_id),
    )


def format_user_name(first_name, last_name):
    """
    Combine ``first_name``/``last_name`` into a human-readable display name.

    Returns ``None`` when both parts are blank, so callers can fall back to
    a technical identifier instead of rendering an empty string.
    """
    parts = []
    for part in (first_name, last_name):
        if part:
            text = str(part).strip()
            if text:
                parts.append(text)
    return " ".join(parts) or None


def resolve_entity_labels(company_id, logs):
    """
    Batch-resolve human-readable labels for audit rows' entities.

    Args:
        company_id: the tenant that owns both the audit rows and the
            referenced entities. Every entity lookup is scoped by this id,
            so a label can never leak across tenants.
        logs: the audit rows (or any objects with ``entity_type`` /
            ``entity_id``) to resolve.

    Returns:
        A dict keyed by ``(entity_type, entity_id)`` whose values are the
        display label or ``None`` when the entity type is unknown or the
        entity no longer exists (e.g. a physically deleted user).

    Soft-deleted rows (clients, templates, documents) still resolve: the
    lookups deliberately do not exclude ``deleted_at`` rows, because audit
    history must stay readable after a soft-delete. At most one query per
    supported ``entity_type`` is issued, regardless of row count, so a
    paginated list never becomes N+1.
    """
    wanted = {}
    for log in logs:
        wanted.setdefault(log.entity_type, set()).add(log.entity_id)
    labels = {}

    user_ids = wanted.get("user", set())
    if user_ids:
        users = User.objects.filter(company_id=company_id, id__in=user_ids).only(
            "id", "first_name", "last_name"
        )
        for user in users:
            labels[("user", user.id)] = format_user_name(
                user.first_name, user.last_name
            )

    client_ids = wanted.get("client", set())
    if client_ids:
        clients = (
            Client.objects.filter(company_id=company_id, id__in=client_ids)
            .select_related("legal_entity", "individual")
        )
        for client in clients:
            labels[("client", client.id)] = client.get_display_name()

    template_ids = wanted.get("document_template", set())
    if template_ids:
        templates = DocumentTemplate.objects.filter(
            company_id=company_id, id__in=template_ids
        ).only("id", "name")
        for template in templates:
            labels[("document_template", template.id)] = template.name or None

    template_version_ids = wanted.get("document_template_version", set())
    if template_version_ids:
        versions = TemplateVersion.objects.filter(
            company_id=company_id, id__in=template_version_ids
        ).select_related("template")
        for version in versions:
            template = getattr(version, "template", None)
            template_name = template.name if template is not None else None
            if template_name:
                labels[("document_template_version", version.id)] = (
                    f"{template_name} v{version.version_number}"
                )
            else:
                labels[("document_template_version", version.id)] = (
                    f"v{version.version_number}"
                )

    document_ids = wanted.get("generated_document", set())
    if document_ids:
        documents = GeneratedDocument.objects.filter(
            company_id=company_id, id__in=document_ids
        ).only("id", "document_number")
        for document in documents:
            labels[("generated_document", document.id)] = (
                document.document_number or None
            )

    document_version_ids = wanted.get("generated_document_version", set())
    if document_version_ids:
        versions = GeneratedDocumentVersion.objects.filter(
            company_id=company_id, id__in=document_version_ids
        ).select_related("generated_document")
        for version in versions:
            document = getattr(version, "generated_document", None)
            document_number = (
                document.document_number if document is not None else None
            )
            if document_number:
                labels[("generated_document_version", version.id)] = (
                    f"{document_number} v{version.version_number}"
                )
            else:
                labels[("generated_document_version", version.id)] = (
                    f"v{version.version_number}"
                )

    return labels