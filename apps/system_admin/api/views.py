"""Views for the platform System Admin API surface."""

from django.db import IntegrityError
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenViewBase

from apps.audit_logs.services import diff_snapshots, request_metadata
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
from apps.system_admin.audit import create_platform_audit_log
from apps.system_admin.authentication import SystemAdminJWTAuthentication
from apps.system_admin.permissions import IsSystemAdmin, system_permission_required
from apps.system_admin.provisioning import ProvisioningError, provision_company

COMPANY_MANAGE_PERMISSION = "system.companies.manage"


class SystemAdminTokenObtainView(TokenViewBase):
    """
    POST /api/admin/authentication/token/  {email, password}

    System Admins only. A company user (with or without tenant permissions)
    receives the same generic 401 as bad credentials. ``TokenViewBase`` keeps
    that failure a 401 (it supplies the WWW-Authenticate header DRF needs).
    """

    serializer_class = SystemAdminTokenObtainSerializer
    throttle_scope = "auth_login"


class SystemAdminTokenRefreshView(TokenViewBase):
    """POST /api/admin/authentication/token/refresh/  {refresh}"""

    serializer_class = SystemAdminTokenRefreshSerializer
    throttle_scope = "auth_refresh"


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
