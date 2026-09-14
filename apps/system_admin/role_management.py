"""
System Admin RBAC role & permission management.

Manages **tenant-scoped** roles and their permission assignments only.

* Tenant roles (``scope=tenant``) — global templates (``company=NULL``) and
  company-specific roles — may receive **tenant-scoped** permissions only.
* System roles (``scope=system``, necessarily global) are protected: they can
  be listed and inspected, but never created, renamed, or have permissions
  mutated through this API.

The existing database triggers (``trg_role_permission_scope_match``,
``trg_system_role_platform_only``) remain the authoritative backstop; this
module provides the clear application-level errors before the constraint is
reached. No new model field or identity mechanism is introduced — protection is
derived from the existing ``scope``.
"""

from django.db import transaction

from apps.authentication.models import Permission, Role, RolePermission, Scope
from apps.companies.models import Company
from apps.system_admin.audit import create_platform_audit_log

ROLE_MANAGE_PERMISSION = "system.roles.manage"


class RoleManagementError(Exception):
    """An RBAC management operation violated an architecture invariant."""


def tenant_permissions_queryset():
    """The tenant-scoped permission catalog (never system permissions)."""
    return Permission.objects.filter(scope=Scope.TENANT).order_by("code", "id")


def assert_manageable_tenant_role(role):
    """Only tenant-scoped roles are mutable through this API."""
    if role.scope != Scope.TENANT:
        raise RoleManagementError(
            "System roles are protected and cannot be modified through role "
            "management."
        )


def assert_tenant_permission(permission):
    if permission.scope != Scope.TENANT:
        raise RoleManagementError(
            "Only tenant-scoped permissions can be assigned to tenant roles."
        )


@transaction.atomic
def create_tenant_role(
    *,
    company,
    name,
    actor,
    ip_address=None,
    user_agent=None,
    request_id=None,
):
    """
    Create a company-specific tenant role.

    Scope is always ``tenant`` and is set by the backend (never client-supplied).
    The platform company is rejected.
    """
    if company.deleted_at is not None:
        raise RoleManagementError("The selected company is not active.")
    if company.is_platform:
        raise RoleManagementError(
            "Tenant roles cannot be created for the platform company."
        )

    name = (name or "").strip()
    if not name:
        raise RoleManagementError("A role name is required.")
    if Role.objects.filter(company=company, name=name).exists():
        raise RoleManagementError(
            "A role with this name already exists in this company."
        )

    role = Role.objects.create(company=company, name=name, scope=Scope.TENANT)

    create_platform_audit_log(
        user=actor,
        action="role.create",
        entity_type="role",
        entity_id=role.id,
        target_company=company,
        new_values={
            "name": role.name,
            "scope": role.scope,
            "company_id": company.id,
        },
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return role


@transaction.atomic
def update_tenant_role(
    *,
    role,
    name,
    actor,
    ip_address=None,
    user_agent=None,
    request_id=None,
):
    """
    Update a tenant role's name only.

    Scope and company are immutable here (they are not even accepted as input).
    """
    assert_manageable_tenant_role(role)

    name = (name or "").strip()
    if not name:
        raise RoleManagementError("A role name is required.")

    duplicate = Role.objects.filter(company=role.company, name=name).exclude(
        pk=role.pk
    )
    if duplicate.exists():
        raise RoleManagementError(
            "A role with this name already exists in this company."
        )

    if role.name != name:
        previous_name = role.name
        role.name = name
        role.save(update_fields=["name"])
        create_platform_audit_log(
            user=actor,
            action="role.update",
            entity_type="role",
            entity_id=role.id,
            target_company=role.company,
            previous_values={"name": previous_name},
            new_values={"name": role.name},
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
    return role


@transaction.atomic
def assign_tenant_permission(
    *,
    role,
    permission,
    actor,
    ip_address=None,
    user_agent=None,
    request_id=None,
):
    """
    Assign a tenant permission to a tenant role (idempotent).

    Returns ``(relation, created)``; only an actual change is audited.
    """
    assert_manageable_tenant_role(role)
    assert_tenant_permission(permission)

    relation, created = RolePermission.objects.get_or_create(
        role=role, permission=permission
    )
    if created:
        create_platform_audit_log(
            user=actor,
            action="role.permission_assign",
            entity_type="role",
            entity_id=role.id,
            target_company=role.company,
            new_values={
                "permission_id": permission.id,
                "permission_code": permission.code,
            },
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
    return relation, created


@transaction.atomic
def remove_tenant_permission(
    *,
    role,
    permission,
    actor,
    ip_address=None,
    user_agent=None,
    request_id=None,
):
    """
    Remove a tenant permission from a tenant role.

    Returns ``True`` when a row was removed (and audited), ``False`` when the
    permission was not assigned.
    """
    assert_manageable_tenant_role(role)
    assert_tenant_permission(permission)

    deleted, _ = RolePermission.objects.filter(
        role=role, permission=permission
    ).delete()
    if not deleted:
        return False

    create_platform_audit_log(
        user=actor,
        action="role.permission_remove",
        entity_type="role",
        entity_id=role.id,
        target_company=role.company,
        previous_values={
            "permission_id": permission.id,
            "permission_code": permission.code,
        },
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return True
