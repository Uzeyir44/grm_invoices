"""
Step 5.4 — Audit Logs read API: filtering, pagination, ordering.

Strictly read-only and tenant-scoped. The authenticated user's company is
authoritative; ``company_id`` is never taken from query parameters or the body.
Filters are explicitly whitelisted (see :class:`AuditLogQuerySerializer`): only
supported query parameters influence the queryset, and all of them operate
inside the tenant scope established first. Pagination uses a bounded DRF
``PageNumberPagination`` (``?page=`` / ``?page_size=``, max page size applied).
Ordering is ``-created_at`` with ``-id`` as a deterministic tiebreak.
"""

from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit_logs.api.serializers import (
    AuditLogQuerySerializer,
    AuditLogSerializer,
)
from apps.audit_logs.models import AuditLog
from apps.authentication.api.permissions import IsCompanyMember, permission_required


class AuditLogPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class AuditLogListView(APIView):
    """
    GET /api/audit-logs/ — list the authenticated user's company audit logs.

    Query parameters (all optional, composable, tenant-scoped):
        action, entity_type, entity_id, user_id,
        created_after (>=), created_before (<=), page, page_size.
    """

    permission_classes = [IsCompanyMember, permission_required("audit_logs.read")]
    pagination_class = AuditLogPagination

    def get(self, request):
        query_serializer = AuditLogQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        validated = query_serializer.validated_data

        # Tenant scope first — user-controlled filters never widen it.
        queryset = AuditLog.objects.filter(company_id=request.user.company_id)

        filters = {}
        if validated.get("action"):
            filters["action"] = validated["action"]
        if validated.get("entity_type"):
            filters["entity_type"] = validated["entity_type"]
        if validated.get("entity_id") is not None:
            filters["entity_id"] = validated["entity_id"]
        if validated.get("user_id") is not None:
            filters["user_id"] = validated["user_id"]
        if validated.get("created_after") is not None:
            filters["created_at__gte"] = validated["created_after"]
        if validated.get("created_before") is not None:
            filters["created_at__lte"] = validated["created_before"]
        if filters:
            queryset = queryset.filter(**filters)

        # Newest first with a deterministic secondary tiebreak. The primary
        # ordering uses the existing (company, -created_at) index.
        queryset = queryset.order_by("-created_at", "-id")

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        if page is not None:
            serializer = AuditLogSerializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)
        serializer = AuditLogSerializer(queryset, many=True)
        return Response(serializer.data)