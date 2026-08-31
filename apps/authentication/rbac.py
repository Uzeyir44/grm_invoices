"""
RBAC permission resolution over the existing Role / Permission /
RolePermission / UserRole graph.

A permission is granted to a user when the user has any assigned role that
carries that permission, respecting role scope:
  - global roles (Role.company IS NULL) apply to every user assigned them;
  - company-specific roles (Role.company set) only apply within that company.

The `trg_user_role_company_match` trigger already prevents assigning a
company-specific role to a user from another company at the database level;
the scope filter below is kept as defense in depth so a resolution bug can
never grant cross-company access.
"""

from django.db.models import Q

from apps.authentication.models import Permission, Role


def _roles_for_user(user):
    """Roles assigned to ``user``, scoped to global or the user's company."""
    return Role.objects.filter(user_assignments__user=user).filter(
        Q(company__isnull=True) | Q(company_id=user.company_id)
    )


def permission_codes_for(user):
    """All permission codes available to ``user`` within their own company."""
    if user is None:
        return frozenset()
    return frozenset(
        Permission.objects.filter(roles__in=_roles_for_user(user)).values_list(
            "code", flat=True
        )
    )


def user_has_permission(user, code):
    """True when ``user`` holds ``code`` within their own company."""
    if user is None or not code:
        return False
    return Permission.objects.filter(
        code=code, roles__in=_roles_for_user(user)
    ).exists()