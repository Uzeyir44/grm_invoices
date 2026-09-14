"""
System Admin platform audit API (read-only).

Serves the platform audit dataset only — ``AuditLog`` rows whose ``company`` is
the reserved platform company (i.e. events written through
``create_platform_audit_log``). Tenant audit rows are never exposed here.

Globally scoped (never ``request.user.company``), read-only (GET only),
newest-first with a deterministic tiebreak, paginated with the project's
``PageNumberPagination`` convention. Target-company ids embedded in
``new_values["target_company_id"]`` are matched with a JSONB containment filter
and their display names are resolved in a **single** batch query per page.
"""

from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.audit_logs.models import AuditLog
from apps.companies.models import Company
from apps.system_admin.api.audit_serializers import (
    AdminAuditLogQuerySerializer,
    AdminAuditLogSerializer,
    TARGET_COMPANY_ID_KEY,
)
from apps.system_admin.api.views import AdminMethodPermissionAPIView

AUDIT_READ_PERMISSION = "system.audit.read"


class AdminAuditLogPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class AdminAuditLogListView(AdminMethodPermissionAPIView):
    """
    GET /api/admin/audit/ — platform audit records (System Admins only).

    Query parameters (all optional, composable):
        action, entity_type, entity_id, user_id, target_company_id,
        created_after (>=), created_before (<=), page, page_size.
    """

    method_permissions = {"GET": AUDIT_READ_PERMISSION}
    pagination_class = AdminAuditLogPagination

    def get(self, request):
        query = AdminAuditLogQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        validated = query.validated_data

        # Platform dataset only — never a tenant scope.
        queryset = AuditLog.objects.filter(
            company__is_platform=True
        ).select_related("user")

        if validated.get("action"):
            queryset = queryset.filter(action=validated["action"])
        if validated.get("entity_type"):
            queryset = queryset.filter(entity_type=validated["entity_type"])
        if validated.get("entity_id") is not None:
            queryset = queryset.filter(entity_id=validated["entity_id"])
        if validated.get("user_id") is not None:
            queryset = queryset.filter(user_id=validated["user_id"])
        if validated.get("target_company_id") is not None:
            # JSONB containment on the payload key; never an arbitrary JSON path.
            queryset = queryset.filter(
                new_values__contains={
                    TARGET_COMPANY_ID_KEY: validated["target_company_id"]
                }
            )
        if validated.get("created_after") is not None:
            queryset = queryset.filter(created_at__gte=validated["created_after"])
        if validated.get("created_before") is not None:
            queryset = queryset.filter(created_at__lte=validated["created_before"])

        queryset = queryset.order_by("-created_at", "-id")

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        logs = list(page) if page is not None else list(queryset)

        serializer = AdminAuditLogSerializer(
            logs,
            many=True,
            context={"company_names": self._company_names(logs)},
        )
        if page is not None:
            return paginator.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @staticmethod
    def _company_names(logs):
        """
        One query for every company referenced by the page (target companies and
        company entities), so display names never cause an N+1.
        """
        ids = set()
        for log in logs:
            values = log.new_values
            if isinstance(values, dict):
                target_id = values.get(TARGET_COMPANY_ID_KEY)
                if isinstance(target_id, int) and not isinstance(target_id, bool):
                    ids.add(target_id)
            if log.entity_type == "company" and isinstance(log.entity_id, int):
                ids.add(log.entity_id)
        if not ids:
            return {}
        return dict(
            Company.objects.filter(id__in=ids).values_list("id", "display_name")
        )
