"""
RBAC permission resolution over the existing Role / Permission /
RolePermission / UserRole graph.

A permission is granted to a user when the user has any assigned role that
carries that permission, respecting role scope:
  - global roles (Role.company IS NULL) apply to every user assigned them;
  - company-specific roles (Role.company set) only apply within that company.

Authorization is also split by *scope* (``tenant`` vs ``system``):

  - ``permission_codes_for`` / ``user_has_permission`` resolve **tenant**
    permissions only, through tenant roles (global or the user's own company).
    These are what company APIs use.
  - ``system_permission_codes_for`` / ``user_has_system_permission`` resolve
    **system** permissions through system roles only. These are what the
    platform System Admin boundary uses.

The scope filters are defense in depth on top of the database constraints
(``trg_role_permission_scope_match`` and ``trg_system_role_platform_only``):
even a corrupted role/permission relationship cannot make a tenant role grant a
system permission, or a system role grant a tenant permission.

The `trg_user_role_company_match` trigger already prevents assigning a
company-specific role to a user from another company at the database level;
the scope filter below is kept as defense in depth so a resolution bug can
never grant cross-company access.
"""

from django.db.models import Q

from apps.authentication.models import Permission, Role, Scope


def _tenant_roles_for_user(user):
    """Tenant roles assigned to ``user`` (global or the user's own company)."""
    return Role.objects.filter(
        user_assignments__user=user, scope=Scope.TENANT
    ).filter(Q(company__isnull=True) | Q(company_id=user.company_id))


def _system_roles_for_user(user):
    """System roles assigned to ``user`` (always global)."""
    return Role.objects.filter(
        user_assignments__user=user, scope=Scope.SYSTEM, company__isnull=True
    )


def permission_codes_for(user):
    """Tenant permission codes available to ``user`` within their own company."""
    if user is None:
        return frozenset()
    return frozenset(
        Permission.objects.filter(
            roles__in=_tenant_roles_for_user(user), scope=Scope.TENANT
        ).values_list("code", flat=True)
    )


def user_has_permission(user, code):
    """True when ``user`` holds tenant permission ``code`` in their company."""
    if user is None or not code:
        return False
    return Permission.objects.filter(
        code=code, scope=Scope.TENANT, roles__in=_tenant_roles_for_user(user)
    ).exists()


def is_system_admin(user):
    """
    True when ``user`` is assigned at least one system-scoped role.

    This is a purely structural check on the RBAC graph. It deliberately does
    not look at ``user.company``: platform authorization must not be based on
    company membership (see the ADR, Decision 6).
    """
    if user is None:
        return False
    return _system_roles_for_user(user).exists()


def system_permission_codes_for(user):
    """System permission codes available to a platform System Admin."""
    if user is None:
        return frozenset()
    return frozenset(
        Permission.objects.filter(
            roles__in=_system_roles_for_user(user), scope=Scope.SYSTEM
        ).values_list("code", flat=True)
    )


def user_has_system_permission(user, code):
    """True when ``user`` holds system permission ``code`` through a system role."""
    if user is None or not code:
        return False
    return Permission.objects.filter(
        code=code, scope=Scope.SYSTEM, roles__in=_system_roles_for_user(user)
    ).exists()
