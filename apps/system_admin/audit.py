"""
Platform (System Admin) audit attribution.

Platform actions must be auditable without being misrepresented as tenant
actions. ``AuditLog.company`` is NOT NULL, so a platform event uses the reserved
platform company as its audit ``company`` (the *actor company*), while the
affected tenant is recorded explicitly in the payload as ``target_company_id``
(the *target company*). See ``docs/architecture/ADR-system-admin.md``,
Decision 7.

Callers cannot choose the audit company: it is always resolved server-side from
``Company.is_platform``. This module delegates to the generic
``create_audit_log`` service, so sensitive-field redaction, JSON validation,
transaction behavior, and the append-only guarantee are all unchanged.
"""

from apps.audit_logs.services import AuditLogError, create_audit_log
from apps.authentication.rbac import is_system_admin
from apps.system_admin.services import (
    PlatformConfigurationError,
    get_platform_company,
)

#: Payload key naming the administered tenant in a platform audit event.
TARGET_COMPANY_ID_KEY = "target_company_id"


class PlatformAuditError(AuditLogError):
    """A platform audit event was requested with an invalid actor or target."""


def _with_target_company(payload, target_company_id):
    """Return a copy of ``payload`` carrying the explicit target company id."""
    if target_company_id is None:
        return payload
    merged = dict(payload) if payload else {}
    merged[TARGET_COMPANY_ID_KEY] = target_company_id
    return merged


def create_platform_audit_log(
    *,
    user,
    action,
    entity_type,
    entity_id,
    target_company=None,
    target_company_id=None,
    previous_values=None,
    new_values=None,
    ip_address=None,
    user_agent=None,
    request_id=None,
):
    """
    Create an audit event for a platform (System Admin) action.

    The audit ``company`` is **always** the reserved platform company resolved
    from trusted server state — the caller cannot supply it, so a platform
    action can never be forged onto an arbitrary tenant. The acting user must
    be a System Admin and must belong to the platform company.

    When the action affects a tenant, pass ``target_company`` (a ``Company``
    instance) or ``target_company_id`` (an int); it is stored in the event's
    ``new_values`` payload under :data:`TARGET_COMPANY_ID_KEY`.

    Args:
        user: the acting System Admin (``request.user``). Required.
        action / entity_type / entity_id: the audit event verb and affected
            entity (e.g. ``company.create`` / ``company`` / ``<company id>``).
        target_company / target_company_id: the administered tenant, if any.
            Mutually exclusive.
        previous_values / new_values: optional JSON-compatible snapshots.
        ip_address / user_agent / request_id: optional request metadata
            (see ``apps.audit_logs.services.request_metadata``).

    Returns:
        The created :class:`AuditLog` (``company`` = platform company).

    Raises:
        PlatformAuditError: no valid platform actor, unknown platform
            configuration, or conflicting target arguments.
        AuditLogError: invalid payload/request_id (via ``create_audit_log``).
    """
    try:
        platform_company = get_platform_company()
    except PlatformConfigurationError as exc:
        raise PlatformAuditError(str(exc)) from exc

    if user is None or not getattr(user, "is_authenticated", False):
        raise PlatformAuditError("A valid System Admin actor is required.")
    if not is_system_admin(user):
        raise PlatformAuditError(
            "The platform audit actor must hold a system-scoped role."
        )
    if user.company_id != platform_company.id:
        raise PlatformAuditError(
            "The platform audit actor must belong to the platform company."
        )

    if target_company is not None and target_company_id is not None:
        raise PlatformAuditError(
            "Provide either target_company or target_company_id, not both."
        )
    resolved_target_id = (
        target_company.id if target_company is not None else target_company_id
    )

    return create_audit_log(
        company=platform_company,
        user=user,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        previous_values=previous_values,
        new_values=_with_target_company(new_values, resolved_target_id),
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
