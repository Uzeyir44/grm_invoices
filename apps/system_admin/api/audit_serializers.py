"""
Read-only serializers for the System Admin platform audit API.

Only platform audit records (``company`` = reserved platform company) are
served. The response exposes compact identifiers plus a few display strings
resolved in **one batch query** by the view (never N+1): ``user_name``,
``target_company_name`` (from ``new_values["target_company_id"]``), and
``entity_name`` for company entities. The JSON values were already redacted at
write time by the audit writer; this serializer never adds writable fields and
never exposes credentials.
"""

from rest_framework import serializers

from apps.audit_logs.models import AuditLog
from apps.audit_logs.services import format_user_name

#: Key under which platform audit records name the affected tenant.
TARGET_COMPANY_ID_KEY = "target_company_id"


def _target_company_id(new_values):
    """Extract a valid integer ``target_company_id`` from an audit payload."""
    if not isinstance(new_values, dict):
        return None
    value = new_values.get(TARGET_COMPANY_ID_KEY)
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


class AdminAuditLogSerializer(serializers.ModelSerializer):
    """Read-only representation of a platform audit record."""

    company_id = serializers.IntegerField(read_only=True)
    user_id = serializers.IntegerField(read_only=True, allow_null=True)
    user_name = serializers.SerializerMethodField()
    entity_name = serializers.SerializerMethodField()
    target_company_id = serializers.SerializerMethodField()
    target_company_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "company_id",
            "user_id",
            "user_name",
            "action",
            "entity_type",
            "entity_id",
            "entity_name",
            "target_company_id",
            "target_company_name",
            "previous_values",
            "new_values",
            "ip_address",
            "user_agent",
            "request_id",
            "created_at",
        ]
        read_only_fields = fields

    def get_user_name(self, obj):
        if obj.user is None:
            return None
        return format_user_name(obj.user.first_name, obj.user.last_name)

    def get_target_company_id(self, obj):
        return _target_company_id(obj.new_values)

    def _company_names(self):
        return self.context.get("company_names", {})

    def get_target_company_name(self, obj):
        target_id = _target_company_id(obj.new_values)
        if target_id is None:
            return None
        return self._company_names().get(target_id)

    def get_entity_name(self, obj):
        # Only company entities are batch-resolved; other entity types keep
        # their stable ``<type> #<id>`` reference without an extra query.
        if obj.entity_type == "company" and isinstance(obj.entity_id, int):
            return self._company_names().get(obj.entity_id)
        return None


class AdminAuditLogQuerySerializer(serializers.Serializer):
    """
    Whitelisted, validated query parameters for the platform audit list.

    Only these keys may influence the queryset — arbitrary ORM lookups / JSON
    paths are never accepted. Invalid values produce the project's normal DRF
    400 response, never a 500.
    """

    action = serializers.CharField(required=False, max_length=100)
    entity_type = serializers.CharField(required=False, max_length=100)
    entity_id = serializers.IntegerField(required=False)
    user_id = serializers.IntegerField(required=False)
    target_company_id = serializers.IntegerField(required=False)
    created_after = serializers.DateTimeField(required=False)
    created_before = serializers.DateTimeField(required=False)

    def validate(self, attrs):
        after = attrs.get("created_after")
        before = attrs.get("created_before")
        if after is not None and before is not None and after > before:
            raise serializers.ValidationError(
                "created_after must not be later than created_before."
            )
        return attrs
