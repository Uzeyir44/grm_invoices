"""Views for the platform System Admin API surface."""

from django.db import IntegrityError
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenViewBase

from apps.audit_logs.services import diff_snapshots, request_metadata
from apps.authentication.models import Role
from apps.companies.models import Company
from apps.system_admin.api.company_serializers import (
    AdminCompanyProvisionSerializer,
    AdminCompanySerializer,
    AdminCompanyUpdateSerializer,
)
from apps.system_admin.api.serializers import (
    SystemAdminMeSerializer,
    SystemAdminTokenObtainSerializer,
    SystemAdminTokenRefreshSerializer,
)
from apps.system_admin.api.user_serializers import (
    AdminUserDetailSerializer,
    AdminUserRoleAssignSerializer,
    AdminUserRoleSerializer,
    AdminUserSerializer,
    AdminUserUpdateSerializer,
)
from apps.system_admin.audit import create_platform_audit_log
from apps.system_admin.authentication import SystemAdminJWTAuthentication
from apps.system_admin.permissions import IsSystemAdmin, system_permission_required
from apps.system_admin.provisioning import ProvisioningError, provision_company
from apps.system_admin.user_management import (
    USER_MANAGE_PERMISSION,
    UserManagementError,
    assign_tenant_role,
    get_managed_user_or_404,
    managed_users_queryset,
    remove_tenant_role,
)

COMPANY_MANAGE_PERMISSION = "system.companies.manage"


class SystemAdminTokenObtainView(TokenViewBase):
    """
    POST /api/admin/authentication/token/  {email, password}

    System Admins only. A company user (with or without tenant permissions)
    receives the same generic 401 as bad credentials. ``TokenViewBase`` keeps
    that failure a 401 (it supplies the WWW-Authenticate header DRF needs).
    """

    serializer_class = SystemAdminTokenObtainSerializer
    throttle_scope = "admin_login"


class SystemAdminTokenRefreshView(TokenViewBase):
    """POST /api/admin/authentication/token/refresh/  {refresh}"""

    serializer_class = SystemAdminTokenRefreshSerializer
    throttle_scope = "admin_refresh"


class SystemAdminMeView(APIView):
    """GET /api/admin/authentication/me/ — the authenticated System Admin."""

    authentication_classes = [SystemAdminJWTAuthentication]
    permission_classes = [IsSystemAdmin]

    def get(self, request):
        return Response(SystemAdminMeSerializer(request.user).data)


# ---------------------------------------------------------------------------
# Company management (/api/admin/companies/...)
# ---------------------------------------------------------------------------


class AdminMethodPermissionAPIView(APIView):
    """
    Base admin view: System Admin JWT authentication plus a per-method system
    permission via ``system_permission_required`` (which enforces the full
    platform boundary). Authorization never uses ``request.user.company``.
    """

    authentication_classes = [SystemAdminJWTAuthentication]
    permission_classes = [IsSystemAdmin]
    method_permissions = {}

    def get_permissions(self):
        code = self.method_permissions.get(self.request.method)
        if code:
            return [system_permission_required(code)()]
        return super().get_permissions()

    def handle_exception(self, exc):
        if isinstance(exc, IntegrityError):
            # The database is the final integrity layer; surface conflicts as a
            # client error rather than a 500, without exposing internals.
            return Response(
                {"detail": "The submitted data conflicts with existing records."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().handle_exception(exc)


def company_snapshot(company):
    """Administratively meaningful company fields for audit diffs."""
    return {
        "legal_name": company.legal_name,
        "display_name": company.display_name,
        "voen": company.voen,
        "registration_number": company.registration_number,
        "default_language": company.default_language,
        "default_timezone": company.default_timezone,
        "status": company.status,
    }


def get_admin_company_or_404(pk):
    """Global (non-tenant) company lookup for the admin surface."""
    return get_object_or_404(Company, pk=pk, deleted_at__isnull=True)


class AdminCompanyListView(AdminMethodPermissionAPIView):
    """GET /api/admin/companies/ — global company list."""

    method_permissions = {"GET": COMPANY_MANAGE_PERMISSION}

    def get(self, request):
        companies = Company.objects.filter(deleted_at__isnull=True).order_by(
            "display_name", "id"
        )
        return Response(AdminCompanySerializer(companies, many=True).data)


class AdminCompanyProvisionView(AdminMethodPermissionAPIView):
    """
    POST /api/admin/companies/provision/ — provision a tenant + its initial
    administrator atomically.
    """

    method_permissions = {"POST": COMPANY_MANAGE_PERMISSION}

    def post(self, request):
        serializer = AdminCompanyProvisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        meta = request_metadata(request)

        try:
            company, _admin_user, _admin_role = provision_company(
                company_data={
                    "legal_name": data["legal_name"],
                    "display_name": data["display_name"],
                    "voen": data.get("voen"),
                    "registration_number": data.get("registration_number"),
                    "default_language": data.get("default_language"),
                    "default_timezone": data.get("default_timezone"),
                },
                admin_email=data["admin_email"],
                admin_password=data["admin_password"],
                admin_first_name=data.get("admin_first_name", ""),
                admin_last_name=data.get("admin_last_name", ""),
                actor=request.user,
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        except ProvisioningError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )

        return Response(
            AdminCompanySerializer(company).data, status=status.HTTP_201_CREATED
        )


class AdminCompanyDetailView(AdminMethodPermissionAPIView):
    """GET/PATCH /api/admin/companies/<pk>/"""

    method_permissions = {
        "GET": COMPANY_MANAGE_PERMISSION,
        "PATCH": COMPANY_MANAGE_PERMISSION,
    }

    def get(self, request, pk):
        company = get_admin_company_or_404(pk)
        return Response(AdminCompanySerializer(company).data)

    def patch(self, request, pk):
        company = get_admin_company_or_404(pk)
        if company.is_platform:
            return Response(
                {"detail": "The platform company cannot be modified."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        before = company_snapshot(company)
        serializer = AdminCompanyUpdateSerializer(
            company, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        previous, new = diff_snapshots(before, company_snapshot(company))
        if previous or new:
            meta = request_metadata(request)
            create_platform_audit_log(
                user=request.user,
                action="company.update",
                entity_type="company",
                entity_id=company.id,
                target_company=company,
                previous_values=previous,
                new_values=new,
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        return Response(AdminCompanySerializer(company).data)


class AdminCompanyLifecycleView(AdminMethodPermissionAPIView):
    """Base view for activate/deactivate transitions."""

    method_permissions = {"POST": COMPANY_MANAGE_PERMISSION}
    target_status = None
    audit_action = None

    def post(self, request, pk):
        company = get_admin_company_or_404(pk)
        if company.is_platform:
            return Response(
                {"detail": "The platform company status cannot be changed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if company.status != self.target_status:
            previous_status = company.status
            company.status = self.target_status
            company.save(update_fields=["status", "updated_at"])
            meta = request_metadata(request)
            create_platform_audit_log(
                user=request.user,
                action=self.audit_action,
                entity_type="company",
                entity_id=company.id,
                target_company=company,
                previous_values={"status": previous_status},
                new_values={"status": company.status},
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        return Response(AdminCompanySerializer(company).data)


class AdminCompanyActivateView(AdminCompanyLifecycleView):
    """POST /api/admin/companies/<pk>/activate/"""

    target_status = Company.Status.ACTIVE
    audit_action = "company.activate"


class AdminCompanyDeactivateView(AdminCompanyLifecycleView):
    """POST /api/admin/companies/<pk>/deactivate/"""

    target_status = Company.Status.SUSPENDED
    audit_action = "company.deactivate"


# ---------------------------------------------------------------------------
# User management (/api/admin/users/...)
#
# Operates on ordinary tenant users only; System Admin accounts (reserved
# platform company) are excluded by the queryset and surface as 404.
# ---------------------------------------------------------------------------


def user_snapshot(user):
    """Administratively meaningful user fields for audit diffs (no secrets)."""
    return {
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
    }


class AdminUserListView(AdminMethodPermissionAPIView):
    """GET /api/admin/users/ — global list of ordinary tenant users."""

    method_permissions = {"GET": USER_MANAGE_PERMISSION}

    def get(self, request):
        users = (
            managed_users_queryset()
            .prefetch_related("role_assignments__role")
            .order_by("id")
        )
        return Response(AdminUserSerializer(users, many=True).data)


class AdminUserDetailView(AdminMethodPermissionAPIView):
    """GET/PATCH /api/admin/users/<pk>/"""

    method_permissions = {
        "GET": USER_MANAGE_PERMISSION,
        "PATCH": USER_MANAGE_PERMISSION,
    }

    def get(self, request, pk):
        user = get_managed_user_or_404(pk)
        return Response(AdminUserDetailSerializer(user).data)

    def patch(self, request, pk):
        user = get_managed_user_or_404(pk)
        before = user_snapshot(user)
        serializer = AdminUserUpdateSerializer(
            user, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        previous, new = diff_snapshots(before, user_snapshot(user))
        if previous or new:
            meta = request_metadata(request)
            create_platform_audit_log(
                user=request.user,
                action="user.update",
                entity_type="user",
                entity_id=user.id,
                target_company=user.company,
                previous_values=previous,
                new_values=new,
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        return Response(AdminUserDetailSerializer(user).data)


class AdminUserLifecycleView(AdminMethodPermissionAPIView):
    """Base view for activate/deactivate transitions."""

    method_permissions = {"POST": USER_MANAGE_PERMISSION}
    target_active = None
    audit_action = None

    def post(self, request, pk):
        user = get_managed_user_or_404(pk)
        if user.is_active != self.target_active:
            previous_active = user.is_active
            user.is_active = self.target_active
            user.save(update_fields=["is_active", "updated_at"])
            meta = request_metadata(request)
            create_platform_audit_log(
                user=request.user,
                action=self.audit_action,
                entity_type="user",
                entity_id=user.id,
                target_company=user.company,
                previous_values={"is_active": previous_active},
                new_values={"is_active": user.is_active},
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        return Response(AdminUserDetailSerializer(user).data)


class AdminUserActivateView(AdminUserLifecycleView):
    """POST /api/admin/users/<pk>/activate/"""

    target_active = True
    audit_action = "user.activate"


class AdminUserDeactivateView(AdminUserLifecycleView):
    """POST /api/admin/users/<pk>/deactivate/"""

    target_active = False
    audit_action = "user.deactivate"


class AdminUserRoleListCreateView(AdminMethodPermissionAPIView):
    """GET/POST /api/admin/users/<pk>/roles/ — list / assign tenant roles."""

    method_permissions = {
        "GET": USER_MANAGE_PERMISSION,
        "POST": USER_MANAGE_PERMISSION,
    }

    def get(self, request, pk):
        user = get_managed_user_or_404(pk)
        roles = [
            assignment.role
            for assignment in user.role_assignments.select_related("role").all()
        ]
        return Response(AdminUserRoleSerializer(roles, many=True).data)

    def post(self, request, pk):
        user = get_managed_user_or_404(pk)
        serializer = AdminUserRoleAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role = serializer.validated_data["role"]
        meta = request_metadata(request)
        try:
            assign_tenant_role(
                user=user,
                role=role,
                actor=request.user,
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        except UserManagementError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response(
            AdminUserRoleSerializer(role).data, status=status.HTTP_201_CREATED
        )


class AdminUserRoleDetailView(AdminMethodPermissionAPIView):
    """DELETE /api/admin/users/<pk>/roles/<role_id>/ — remove a tenant role."""

    method_permissions = {"DELETE": USER_MANAGE_PERMISSION}

    def delete(self, request, pk, role_id):
        user = get_managed_user_or_404(pk)
        role = get_object_or_404(Role, pk=role_id)
        meta = request_metadata(request)
        try:
            removed = remove_tenant_role(
                user=user,
                role=role,
                actor=request.user,
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        except UserManagementError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )
        if not removed:
            return Response(
                {"detail": "The role is not assigned to this user."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
