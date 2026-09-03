from django.urls import path

from apps.audit_logs.api.views import AuditLogListView

urlpatterns = [
    path("", AuditLogListView.as_view(), name="audit-log-list"),
]