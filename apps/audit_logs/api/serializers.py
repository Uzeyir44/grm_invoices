"""
Read-only serializers for the Audit Logs read API (Steps 5.3/5.4).

Only compact identifiers (``company_id`` / ``user_id``) are exposed — never
full ``User`` / ``Company`` objects, so no password hashes, MFA secrets,
tokens, or unrelated profile data can leak. Two human-readable display
strings ride alongside the identifiers: ``user_name`` (the acting user's
full name) and ``entity_name`` (the referenced entity's label, resolved
tenant-scoped by the view). Both are ``None`` when the name is unavailable
(deleted user, unknown entity type) — the IDs remain the stable reference.
The record serializer is strictly read-only; the query serializer validates
the explicitly whitelisted filter parameters.
"""

from rest_framework import serializers

from apps.audit_logs.models import AuditLog
from apps.audit_logs.services import format_user_name


class AuditLogSerializer(serializers.ModelSerializer):
    """Read-only representation of an immutable append-only audit record."""

    company_id = serializers.IntegerField(read_only=True)
    user_id = serializers.IntegerField(read_only=True, allow_null=True)
    user_name = serializers.SerializerMethodField()
    entity_name = serializers.SerializerMethodField()

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
            "previous_values",
            "new_values",
            "ip_address",
            "user_agent",
            "request_id",
            "created_at",
        ]
        read_only_fields = fields

    def get_user_name(self, obj):
        user = obj.user
        if user is None:
            return None
        return format_user_name(user.first_name, user.last_name)

    def get_entity_name(self, obj):
        labels = self.context.get("entity_labels", {})
        return labels.get((obj.entity_type, obj.entity_id))


class AuditLogQuerySerializer(serializers.Serializer):
    """
    Validation for the explicitly whitelisted query parameters.

    Only these keys may influence the queryset — arbitrary ORM lookups are
    never accepted. ``entity_id``/``user_id`` must be valid numbers and
    ``created_after``/``created_before`` valid datetimes; invalid values
    produce the project's normal DRF validation response (400), never a 500.
    """

    action = serializers.CharField(required=False, max_length=100)
    entity_type = serializers.CharField(required=False, max_length=100)
    entity_id = serializers.IntegerField(required=False)
    user_id = serializers.IntegerField(required=False)
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