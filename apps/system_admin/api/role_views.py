"""Views for System Admin RBAC role & permission management."""

from django.db.models import Count
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.response import Response

from apps.audit_logs.services import request_metadata
from apps.authentication.models import Permission, Role
from apps.system_admin.api.role_serializers import (
    AdminPermissionQuerySerializer,
    AdminPermissionSerializer,
    AdminRoleCreateSerializer,
    AdminRoleDetailSerializer,
    AdminRoleListSerializer,
    AdminRolePermissionAssignSerializer,
    AdminRoleQuerySerializer,
    AdminRoleUpdateSerializer,
)
from apps.system_admin.api.views import AdminMethodPermissionAPIView
from apps.system_admin.role_management import (
    ROLE_MANAGE_PERMISSION,
    RoleManagementError,
    assign_tenant_permission,
    create_tenant_role,
    remove_tenant_permission,
    update_tenant_role,
)


class AdminPermissionListView(AdminMethodPermissionAPIView):
    """GET /api/admin/permissions/ — the application permission catalog."""

    method_permissions = {"GET": ROLE_MANAGE_PERMISSION}

    def get(self, request):
        query = AdminPermissionQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        scope = query.validated_data.get("scope")

        permissions = Permission.objects.all().order_by("code", "id")
        if scope:
            permissions = permissions.filter(scope=scope)
        return Response(AdminPermissionSerializer(permissions, many=True).data)


class AdminRoleListCreateView(AdminMethodPermissionAPIView):
    """GET (list) / POST (create) /api/admin/roles/."""

    method_permissions = {
        "GET": ROLE_MANAGE_PERMISSION,
        "POST": ROLE_MANAGE_PERMISSION,
    }

    def get(self, request):
        query = AdminRoleQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)

        roles = (
            Role.objects.all()
            .select_related("company")
            .annotate(permission_count=Count("permissions"))
            .order_by("scope", "company_id", "name", "id")
        )
        scope = query.validated_data.get("scope")
        company_id = query.validated_data.get("company_id")
        if scope:
            roles = roles.filter(scope=scope)
        if company_id is not None:
            roles = roles.filter(company_id=company_id)
        return Response(AdminRoleListSerializer(roles, many=True).data)

    def post(self, request):
        serializer = AdminRoleCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        meta = request_metadata(request)
        try:
            role = create_tenant_role(
                company=serializer.validated_data["company"],
                name=serializer.validated_data["name"],
                actor=request.user,
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        except RoleManagementError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response(
            AdminRoleDetailSerializer(role).data, status=status.HTTP_201_CREATED
        )


class AdminRoleDetailView(AdminMethodPermissionAPIView):
    """GET/PATCH /api/admin/roles/<pk>/"""

    method_permissions = {
        "GET": ROLE_MANAGE_PERMISSION,
        "PATCH": ROLE_MANAGE_PERMISSION,
    }

    def get(self, request, pk):
        role = get_object_or_404(
            Role.objects.select_related("company").prefetch_related("permissions"),
            pk=pk,
        )
        return Response(AdminRoleDetailSerializer(role).data)

    def patch(self, request, pk):
        role = get_object_or_404(Role, pk=pk)
        serializer = AdminRoleUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        meta = request_metadata(request)
        try:
            update_tenant_role(
                role=role,
                name=serializer.validated_data["name"],
                actor=request.user,
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        except RoleManagementError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )
        role.refresh_from_db()
        return Response(AdminRoleDetailSerializer(role).data)


class AdminRolePermissionListCreateView(AdminMethodPermissionAPIView):
    """GET/POST /api/admin/roles/<pk>/permissions/"""

    method_permissions = {
        "GET": ROLE_MANAGE_PERMISSION,
        "POST": ROLE_MANAGE_PERMISSION,
    }

    def get(self, request, pk):
        role = get_object_or_404(Role, pk=pk)
        permissions = role.permissions.all().order_by("code", "id")
        return Response(AdminPermissionSerializer(permissions, many=True).data)

    def post(self, request, pk):
        role = get_object_or_404(Role, pk=pk)
        serializer = AdminRolePermissionAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        permission = serializer.validated_data["permission"]
        meta = request_metadata(request)
        try:
            assign_tenant_permission(
                role=role,
                permission=permission,
                actor=request.user,
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        except RoleManagementError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response(
            AdminPermissionSerializer(permission).data,
            status=status.HTTP_201_CREATED,
        )


class AdminRolePermissionDetailView(AdminMethodPermissionAPIView):
    """DELETE /api/admin/roles/<pk>/permissions/<permission_id>/"""

    method_permissions = {"DELETE": ROLE_MANAGE_PERMISSION}

    def delete(self, request, pk, permission_id):
        role = get_object_or_404(Role, pk=pk)
        permission = get_object_or_404(Permission, pk=permission_id)
        meta = request_metadata(request)
        try:
            removed = remove_tenant_permission(
                role=role,
                permission=permission,
                actor=request.user,
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        except RoleManagementError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )
        if not removed:
            return Response(
                {"detail": "The permission is not assigned to this role."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
