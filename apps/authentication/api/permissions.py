"""
Reusable DRF permission classes for tenant isolation and RBAC.

Recommended usage in future feature views:

    class ClientView(APIView):
        permission_classes = [IsCompanyMember, permission_required("clients.read")]

        def get(self, request):
            clients = tenant_queryset(Client, request.user.company)
            ...

        def get_object(self, pk):
            return get_tenant_object_or_404(Client, request.user.company, pk=pk)

`IsSameCompanyObject` is the object-level fallback for views that fetch the
object generically instead of tenant-scoping the queryset.
"""

from rest_framework.permissions import BasePermission

from apps.authentication.backends import active_user_rule
from apps.authentication.rbac import user_has_permission
from apps.authentication.tenant import belongs_to_company


class IsCompanyMember(BasePermission):
    """
    Requires an authenticated user whose own company is currently
    authenticatable (active/trial). The tenant context is ALWAYS
    ``request.user.company``; a company id supplied by the client is ignored.
    """

    message = "User is not a member of an active company."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        return active_user_rule(user)


def permission_required(code):
    """
    Factory returning a DRF permission class that requires the permission
    ``code`` within the authenticated user's own company (global and
    company-scoped roles both apply — see apps.authentication.rbac).

    Usage::

        permission_classes = [permission_required("clients.create")]
    """

    def has_permission(request, view):
        user = getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        if not active_user_rule(user):
            return False
        return user_has_permission(user, code)

    return type(
        f"HasPermission_{code.replace('.', '_')}",
        (BasePermission,),
        {
            "message": f"Missing required permission: {code}",
            "has_permission": staticmethod(has_permission),
        },
    )


class IsSameCompanyObject(BasePermission):
    """
    Object-level check: the object must belong to ``request.user.company``.

    Objects are expected to expose ``company_id`` directly. For nested models
    resolve the tenant boundary through the parent chain first (see
    apps.authentication.tenant) and pass the resolved parent. Prefer tenant-
    scoped querysets (tenant_queryset / get_tenant_object_or_404) over this in
    most views: they prevent the object from being loaded at all.
    """

    message = "Object does not belong to your company."

    def has_object_permission(self, request, view, obj):
        user = getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        return belongs_to_company(user.company, obj)