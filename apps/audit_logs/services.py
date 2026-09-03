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