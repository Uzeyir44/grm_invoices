"""
System Admin company provisioning.

Creates a new tenant company together with its initial administrator account
and a company-scoped administrator role, in one atomic operation. It reuses the
existing ``Role`` / ``Permission`` / ``UserRole`` RBAC graph and the existing
``UserManager`` (so passwords are hashed, never stored or logged in plaintext).

The platform audit event is written inside the same transaction via
``create_platform_audit_log`` (actor company = platform company; target company
recorded in the payload). If any step fails the whole operation rolls back —
no partially provisioned tenant or orphan user survives.
"""

from django.db import transaction

from apps.authentication.models import Permission, Role, Scope, User, UserRole
from apps.companies.models import Company
from apps.system_admin.audit import create_platform_audit_log
from apps.system_admin.constants import TENANT_ADMIN_ROLE_NAME


class ProvisioningError(Exception):
    """A company provisioning request could not be completed."""


def tenant_permissions_queryset():
    """The tenant-scoped permission catalog granted to a tenant administrator."""
    return Permission.objects.filter(scope=Scope.TENANT)


@transaction.atomic
def provision_company(
    *,
    company_data,
    admin_email,
    admin_password,
    admin_first_name="",
    admin_last_name="",
    actor,
    ip_address=None,
    user_agent=None,
    request_id=None,
):
    """
    Provision a tenant company + its initial administrator atomically.

    Args:
        company_data: validated mapping with ``legal_name``, ``display_name``
            and optional ``voen`` / ``registration_number`` /
            ``default_language`` / ``default_timezone``.
        admin_email / admin_password: the initial administrator's credentials.
            The password is hashed by ``UserManager.create_user``; it is never
            returned, logged, or audited.
        admin_first_name / admin_last_name: optional display name.
        actor: the acting System Admin (``request.user``).
        ip_address / user_agent / request_id: optional request metadata.

    Returns:
        ``(company, admin_user, admin_role)``.

    Raises:
        ProvisioningError: the platform actor is invalid, or the operation
            could not be completed. The transaction rolls back entirely.
    """
    try:
        company = Company.objects.create(
            legal_name=company_data["legal_name"],
            display_name=company_data["display_name"],
            voen=company_data.get("voen") or None,
            registration_number=company_data.get("registration_number") or None,
            default_language=company_data.get("default_language") or "az",
            default_timezone=company_data.get("default_timezone") or "Asia/Baku",
        )
    except Exception as exc:  # noqa: BLE001 - converted to a controlled error
        raise ProvisioningError("Could not create the company.") from exc

    # Company-scoped administrator role holding the tenant permission catalog.
    admin_role = Role.objects.create(
        company=company,
        name=TENANT_ADMIN_ROLE_NAME,
        scope=Scope.TENANT,
    )
    admin_role.permissions.set(tenant_permissions_queryset())

    # Initial administrator account. The company is authoritative (from the
    # freshly created row), never client-supplied.
    try:
        admin_user = User.objects.create_user(
            company=company,
            email=admin_email,
            password=admin_password,
            first_name=admin_first_name,
            last_name=admin_last_name,
        )
    except Exception as exc:  # noqa: BLE001 - converted to a controlled error
        raise ProvisioningError(
            "Could not create the initial administrator."
        ) from exc

    UserRole.objects.create(user=admin_user, role=admin_role)

    create_platform_audit_log(
        user=actor,
        action="company.provision",
        entity_type="company",
        entity_id=company.id,
        target_company=company,
        new_values={
            "display_name": company.display_name,
            "status": company.status,
            "admin_user_id": admin_user.id,
            "admin_email": admin_user.email,
        },
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )

    return company, admin_user, admin_role
