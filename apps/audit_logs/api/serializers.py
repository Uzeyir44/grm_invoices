"""
Read-only serializers for the Step 5.3 Audit Logs read API.

Only compact identifiers (``company_id`` / ``user_id``) are exposed — never
full ``User`` / ``Company`` objects, so no password hashes, MFA secrets,
tokens, or unrelated profile data can leak. All fields are read-only; clients
cannot submit audit records.
"""

from rest_framework import serializers

from apps.audit_logs.models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    """Read-only representation of an immutable append-only audit record."""

    company_id = serializers.IntegerField(read_only=True)
    user_id = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "company_id",
            "user_id",
            "action",
            "entity_type",
            "entity_id",
            "previous_values",
            "new_values",
            "ip_address",
            "user_agent",
            "request_id",
            "created_at",
        ]
        read_only_fields = fields