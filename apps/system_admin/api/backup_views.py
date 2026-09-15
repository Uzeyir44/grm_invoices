"""
System Admin backup API views (Phase 9).

Every endpoint is guarded by the ``system.backups.manage`` system permission
under the full System Admin boundary (``AdminMethodPermissionAPIView``) — a
tenant principal can never reach them, regardless of tenant permissions.

Only the System Admin may create/list/download/verify/delete backups; the
download endpoint streams the real artifact through Django (never a raw URL,
never a filesystem path) and answers 404 when the artifact is missing. All
mutations are recorded through ``create_platform_audit_log`` with no target
company (backups are system-wide).
"""

from django.http import FileResponse
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.audit_logs.services import request_metadata
from apps.system_admin.api.backup_serializers import (
    AdminBackupCreateSerializer,
    AdminBackupSerializer,
    AdminBackupVerifySerializer,
)
from apps.system_admin.api.views import AdminMethodPermissionAPIView
from apps.system_admin.audit import create_platform_audit_log
from apps.system_admin.backup_services import (
    BackupCapabilityError,
    BackupConfigurationError,
    BackupDeleteError,
    BackupInProgressError,
    backup_artifact_path,
    backup_capabilities,
    create_backup_record,
    delete_backup,
    run_backup,
    verify_backup,
)
from apps.system_admin.models import Backup

BACKUP_MANAGE_PERMISSION = "system.backups.manage"


def get_backup_or_404(pk):
    """System-wide backup lookup (never tenant-scoped)."""
    return get_object_or_404(Backup, pk=pk)


class AdminBackupPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


class AdminBackupListView(AdminMethodPermissionAPIView):
    """
    GET  /api/admin/backups/  — list backup records (newest first, paged).
    POST /api/admin/backups/  — create a database or media backup.
    """

    method_permissions = {
        "GET": BACKUP_MANAGE_PERMISSION,
        "POST": BACKUP_MANAGE_PERMISSION,
    }
    pagination_class = AdminBackupPagination

    def get(self, request):
        queryset = Backup.objects.select_related("created_by").order_by(
            "-created_at", "-id"
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        if page is not None:
            serializer = AdminBackupSerializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)
        serializer = AdminBackupSerializer(queryset, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = AdminBackupCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        backup_type = serializer.validated_data["backup_type"]
        meta = request_metadata(request)

        try:
            backup = create_backup_record(
                backup_type=backup_type, actor=request.user
            )
        except BackupCapabilityError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )
        except BackupInProgressError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_409_CONFLICT
            )
        except BackupConfigurationError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )

        create_platform_audit_log(
            user=request.user,
            action="backup.create",
            entity_type="backup",
            entity_id=backup.id,
            new_values={"backup_type": backup.backup_type},
            ip_address=meta["ip_address"],
            user_agent=meta["user_agent"],
        )

        run_backup(backup)

        outcome_values = {
            "backup_type": backup.backup_type,
            "status": backup.status,
        }
        if backup.status == Backup.Status.COMPLETED:
            outcome_values.update(
                {
                    "file_size": backup.file_size,
                    "checksum_sha256": backup.checksum_sha256,
                }
            )
            action = "backup.completed"
        else:
            outcome_values["error_message"] = backup.error_message
            action = "backup.failed"

        create_platform_audit_log(
            user=request.user,
            action=action,
            entity_type="backup",
            entity_id=backup.id,
            new_values=outcome_values,
            ip_address=meta["ip_address"],
            user_agent=meta["user_agent"],
        )

        return Response(
            AdminBackupSerializer(backup).data,
            status=status.HTTP_201_CREATED,
        )


class AdminBackupCapabilityView(AdminMethodPermissionAPIView):
    """
    GET /api/admin/backups/capability/ — honest per-type backup capability.

    Reports whether each backup type is actually available on this server and
    why; it never fabricates availability.
    """

    method_permissions = {"GET": BACKUP_MANAGE_PERMISSION}

    def get(self, request):
        return Response(backup_capabilities())


class AdminBackupDetailView(AdminMethodPermissionAPIView):
    """
    GET    /api/admin/backups/<id>/ — one backup record.
    DELETE /api/admin/backups/<id>/ — permanently remove a backup.

    Deletion removes the artifact before the metadata record; a missing
    artifact is handled safely. Pending/running backups are never deletable.
    """

    method_permissions = {
        "GET": BACKUP_MANAGE_PERMISSION,
        "DELETE": BACKUP_MANAGE_PERMISSION,
    }

    def get(self, request, pk):
        backup = get_backup_or_404(pk)
        return Response(AdminBackupSerializer(backup).data)

    def delete(self, request, pk):
        backup = get_backup_or_404(pk)
        meta = request_metadata(request)
        try:
            delete_backup(backup)
        except BackupInProgressError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_409_CONFLICT
            )
        except BackupDeleteError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        except BackupConfigurationError:
            return Response(
                {"detail": "Backup storage is not safely configured."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        create_platform_audit_log(
            user=request.user,
            action="backup.delete",
            entity_type="backup",
            entity_id=pk,
            new_values={
                "backup_type": backup.backup_type,
                "file_name": backup.file_name,
            },
            ip_address=meta["ip_address"],
            user_agent=meta["user_agent"],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminBackupDownloadView(AdminMethodPermissionAPIView):
    """
    GET /api/admin/backups/<id>/download/ — stream the real artifact.

    The artifact is served through an authenticated System Admin endpoint with
    a sanitized attachment filename; the filesystem path is never exposed. A
    missing artifact is a 404.
    """

    method_permissions = {"GET": BACKUP_MANAGE_PERMISSION}

    def get(self, request, pk):
        backup = get_backup_or_404(pk)
        if backup.status != Backup.Status.COMPLETED:
            return Response(
                {"detail": "Only completed backups can be downloaded."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            path = backup_artifact_path(backup)
        except BackupConfigurationError:
            return Response(
                {"detail": "Backup storage is not safely configured."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        if path is None or not path.is_file():
            return Response(
                {"detail": "The backup artifact does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )
        meta = request_metadata(request)
        create_platform_audit_log(
            user=request.user,
            action="backup.download",
            entity_type="backup",
            entity_id=backup.id,
            new_values={"backup_type": backup.backup_type},
            ip_address=meta["ip_address"],
            user_agent=meta["user_agent"],
        )
        content_type = (
            "application/octet-stream"
            if backup.backup_type == Backup.Type.DATABASE
            else "application/zip"
        )
        return FileResponse(
            open(path, "rb"),
            as_attachment=True,
            filename=backup.file_name,
            content_type=content_type,
        )


class AdminBackupVerifyView(AdminMethodPermissionAPIView):
    """
    POST /api/admin/backups/<id>/verify/ — verify artifact integrity on demand.

    Returns file-exists, current size, and whether the stored SHA-256 matches
    the artifact. A checksum proves integrity, not successful restoration.
    """

    method_permissions = {"POST": BACKUP_MANAGE_PERMISSION}

    def post(self, request, pk):
        backup = get_backup_or_404(pk)
        try:
            result = verify_backup(backup)
        except BackupConfigurationError:
            return Response(
                {"detail": "Backup storage is not safely configured."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        meta = request_metadata(request)
        create_platform_audit_log(
            user=request.user,
            action="backup.verify",
            entity_type="backup",
            entity_id=backup.id,
            new_values={
                "backup_type": backup.backup_type,
                **result,
            },
            ip_address=meta["ip_address"],
            user_agent=meta["user_agent"],
        )
        return Response(AdminBackupVerifySerializer(result).data)


class AdminBackupDeleteView(AdminMethodPermissionAPIView):
    """
    DELETE /api/admin/backups/<id>/ — permanently remove a backup.

    Artifact removal precedes metadata removal; a missing artifact is handled
    safely. Pending/running backups are never deletable.
    """

    method_permissions = {"DELETE": BACKUP_MANAGE_PERMISSION}

    def delete(self, request, pk):
        backup = get_backup_or_404(pk)
        meta = request_metadata(request)
        try:
            delete_backup(backup)
        except BackupInProgressError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_409_CONFLICT
            )
        except BackupDeleteError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        create_platform_audit_log(
            user=request.user,
            action="backup.delete",
            entity_type="backup",
            entity_id=pk,
            new_values={
                "backup_type": backup.backup_type,
                "file_name": backup.file_name,
            },
            ip_address=meta["ip_address"],
            user_agent=meta["user_agent"],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
