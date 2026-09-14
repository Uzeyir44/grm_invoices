"""
Authorization boundary for the platform ``/api/admin/*`` surface.

``IsSystemAdmin`` is deliberately *not* a tenant permission. It combines three
independent facts:

  1. an authenticated, active, non-deleted privileged account,
  2. an admin token carrying the explicit platform scope claim, and
  3. a reserved system-scoped RBAC role.

It never calls ``active_user_rule()`` (so a target company's ``suspended`` /
``cancelled`` status cannot gate platform administration) and never uses
``request.user.company`` as the authorization basis (the platform boundary is
explicitly cross-tenant). See ``docs/architecture/ADR-system-admin.md``,
Decision 6.
"""

from rest_framework.permissions import BasePermission

from apps.authentication.rbac import is_system_admin, user_has_system_permission
from apps.system_admin.constants import SYSTEM_ADMIN_SCOPE, SYSTEM_ADMIN_SCOPE_CLAIM


def active_platform_account(user):
    """The System Admin's own account must be active and not soft-deleted."""
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    if not user.is_active or user.deleted_at is not None:
        return False
    return True


def token_has_system_admin_scope(request):
    token = getattr(request, "auth", None)
    if token is None:
        return False
    return token.get(SYSTEM_ADMIN_SCOPE_CLAIM) == SYSTEM_ADMIN_SCOPE


class IsSystemAdmin(BasePermission):
    """Reusable DRF permission guarding every ``/api/admin/*`` endpoint."""

    message = "System administrator privileges are required."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not active_platform_account(user):
            return False
        if not token_has_system_admin_scope(request):
            return False
        return is_system_admin(user)


def system_user_has_permission(user, code):
    """
    True only when ``user`` is a System Admin holding system permission ``code``.

    The system-scoped counterpart of
    ``apps.authentication.rbac.user_has_permission``: it combines the platform
    identity check with scope-aware system permission resolution. It never
    infers platform access from ``user.company``, never accepts a tenant-scoped
    permission, and never relies on permission-code naming.
    """
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    if not is_system_admin(user):
        return False
    return user_has_system_permission(user, code)


class SystemPermissionRequired(IsSystemAdmin):
    """
    DRF permission enforcing the **full** platform boundary *plus* one system
    permission.

    Subclassing :class:`IsSystemAdmin` guarantees the platform boundary
    (active privileged account + ``scope=system_admin`` token claim + system
    RBAC identity) is checked first. The returned permission therefore can
    never be satisfied by a tenant principal, even if a malformed tenant role
    referenced a system permission. Prefer the
    :func:`system_permission_required` factory in views.
    """

    required_permission = None

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if not self.required_permission:
            return False
        return user_has_system_permission(request.user, self.required_permission)


def system_permission_required(code):
    """
    Factory returning a DRF permission class that requires system permission
    ``code`` under the System Admin boundary.

    Usage::

        class CompanyAdminView(APIView):
            authentication_classes = [SystemAdminJWTAuthentication]
            permission_classes = [system_permission_required("system.companies.manage")]

    The returned class enforces the platform boundary itself, so a future admin
    endpoint never has to (and must not) combine a bare tenant
    ``permission_required`` check with it.
    """
    return type(
        f"HasSystemPermission_{code.replace('.', '_')}",
        (SystemPermissionRequired,),
        {
            "required_permission": code,
            "message": f"Missing required system permission: {code}",
        },
    )
