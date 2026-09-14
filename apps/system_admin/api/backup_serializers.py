"""
Serializers for the System Admin backup API (Phase 9).

The response deliberately exposes a **logical** storage label
(``storage: "backup-storage"``) instead of any filesystem path, and never
includes credentials, connection details, absolute paths, or internal error
detail. ``created_by`` is exposed as ``created_by_id`` plus a display name.
"""

from rest_framework import serializers

from apps.audit_logs.services import format_user_name
from apps.system_admin.backup_services import STORAGE_LABEL
from apps.system_admin.models import Backup


class AdminBackupSerializer(serializers.ModelSerializer):
    """Read-only representation of a backup record (safe fields only)."""

    storage = serializers.SerializerMethodField()
    created_by_id = serializers.IntegerField(read_only=True, allow_null=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Backup
        fields = [
            "id",
            "backup_type",
            "status",
            "created_at",
            "updated_at",
            "completed_at",
            "file_name",
            "file_size",
            "checksum_sha256",
            "storage",
            "error_message",
            "created_by_id",
            "created_by_name",
        ]
        read_only_fields = fields

    def get_storage(self, obj):
        return STORAGE_LABEL

    def get_created_by_name(self, obj):
        if obj.created_by is None:
            return None
        return format_user_name(
            obj.created_by.first_name, obj.created_by.last_name
        )


class AdminBackupCreateSerializer(serializers.Serializer):
    """Create a backup — only the validated backup type is accepted."""

    backup_type = serializers.ChoiceField(choices=Backup.Type.choices)


class AdminBackupVerifySerializer(serializers.Serializer):
    """On-demand verification result (computed, never persisted)."""

    exists = serializers.BooleanField()
    size = serializers.IntegerField(allow_null=True)
    checksum_matches = serializers.BooleanField()