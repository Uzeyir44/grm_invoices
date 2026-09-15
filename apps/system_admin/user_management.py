"""
System Admin global user management.

Manages **ordinary tenant users only**. System Admin accounts live in the
reserved platform company and are a separate principal: they are excluded from
every queryset here, so they can never be listed, edited, activated,
deactivated, or have tenant roles assigned/removed through this API. This is
the existing architecture's identity mechanism (platform company + system-scope
RBAC) — no new flag/column is introduced.

Tenant role assignment is deliberately strict: only a **tenant-scoped** role
owned by the target user's own company may be assigned. System roles, global
role templates, and other companies' roles are rejected. The existing database
triggers remain the final integrity boundary.
"""

from django.db import transaction
from django.shortcuts import get_object_or_404

from apps.authentication.models import Role, Scope, User, UserRole
from apps.system_admin.audit import create_platform_audit_log

USER_MANAGE_PERMISSION = "system.users.manage"


class UserManagementError(Exception):
    """A user-management operation violated an architecture invariant."""


def managed_users_queryset():
    """
    Ordinary tenant users only (non-deleted).

    Excludes the reserved platform company (and therefore every System Admin
    account) and, defensively, any user holding a system-scoped role. Platform
    administration must never treat a System Admin as an ordinary tenant user.
    """
    return (
        User.objects.filter(company__is_platform=False, deleted_at__isnull=True)
        .exclude(role_assignments__role__scope=Scope.SYSTEM)
        .select_related("company")
    )


def get_managed_user_or_404(pk):
    """Fetch an ordinary tenant user; a System Admin / missing id is a 404."""
    return get_object_or_404(managed_users_queryset(), pk=pk)


def assignable_roles_for_user(user):
    """Tenant roles owned by the user's company (never global/system roles)."""
    return Role.objects.filter(
        company_id=user.company_id, scope=Scope.TENANT
    ).order_by("name", "id")


def validate_assignable_role(user, role):
    if role.scope != Scope.TENANT:
        raise UserManagementError(
            "Only tenant-scoped roles can be assigned to a company user."
        )
    if role.company_id != user.company_id:
        raise UserManagementError(
            "The role belongs to a different company than the user."
        )


@transaction.atomic
def create_tenant_user(
    *,
    company,
    email,
    password,
    first_name="",
    last_name="",
    role_ids=None,
    actor,
    ip_address=None,
    user_agent=None,
    request_id=None,
):
    """Create an ordinary tenant user and optional company roles atomically."""
    if company.is_platform or company.deleted_at is not None:
        raise UserManagementError("Users can only be created for tenant companies.")

    role_ids = list(role_ids or [])
    roles = list(Role.objects.filter(id__in=role_ids))
    if len(roles) != len(set(role_ids)):
        raise UserManagementError("One or more selected roles do not exist.")

    user = User.objects.create_user(
        company=company,
        email=email,
        password=password,
        first_name=first_name,
        last_name=last_name,
    )
    for role in roles:
        validate_assignable_role(user, role)
        UserRole.objects.create(user=user, role=role)

    create_platform_audit_log(
        user=actor,
        action="user.create",
        entity_type="user",
        entity_id=user.id,
        target_company=company,
        new_values={
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "role_ids": [role.id for role in roles],
        },
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return user


@transaction.atomic
def assign_tenant_role(
    *,
    user,
    role,
    actor,
    ip_address=None,
    user_agent=None,
    request_id=None,
):
    """
    Assign a tenant role to a tenant user (idempotent).

    Returns ``(assignment, created)``. Only an actual change produces an audit
    event.
    """
    validate_assignable_role(user, role)
    assignment, created = UserRole.objects.get_or_create(user=user, role=role)
    if created:
        create_platform_audit_log(
            user=actor,
            action="user.role_assign",
            entity_type="user",
            entity_id=user.id,
            target_company=user.company,
            new_values={"role_id": role.id, "role_name": role.name},
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
    return assignment, created


@transaction.atomic
def remove_tenant_role(
    *,
    user,
    role,
    actor,
    ip_address=None,
    user_agent=None,
    request_id=None,
):
    """
    Remove a tenant role assignment from a tenant user.

    Returns ``True`` when a row was removed (and audited), ``False`` when the
    role was not assigned.
    """
    validate_assignable_role(user, role)
    deleted, _ = UserRole.objects.filter(user=user, role=role).delete()
    if not deleted:
        return False
    create_platform_audit_log(
        user=actor,
        action="user.role_remove",
        entity_type="user",
        entity_id=user.id,
        target_company=user.company,
        previous_values={"role_id": role.id, "role_name": role.name},
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return True
