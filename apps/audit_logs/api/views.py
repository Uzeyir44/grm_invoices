"""
Step 5.3 — Audit Logs read API.

Strictly read-only and tenant-scoped. The authenticated user's company is
authoritative; ``company_id`` is never taken from query parameters or the body.
Only the ``audit_logs.read`` permission grants access (existing RBAC factory).
Advanced filtering/pagination is deliberately deferred to Step 5.4.
"""

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit_logs.api.serializers import AuditLogSerializer
from apps.audit_logs.models import AuditLog
from apps.authentication.api.permissions import IsCompanyMember, permission_required


class AuditLogListView(APIView):
    """
    GET /api/audit-logs/ — list the authenticated user's company audit logs,
    newest first. The queryset is scoped to ``request.user.company`` so a
    cross-company record is simply never reachable (Rule C/D conventions).
    """

    permission_classes = [IsCompanyMember, permission_required("audit_logs.read")]

    def get(self, request):
        # Ordering matches the existing (company, -created_at) index.
        queryset = AuditLog.objects.filter(
            company_id=request.user.company_id
        ).order_by("-created_at")
        serializer = AuditLogSerializer(queryset, many=True)
        return Response(serializer.data)