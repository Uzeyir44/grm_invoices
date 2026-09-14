"""System Admin models.

The authorization boundary reuses ``authentication.User`` and the scoped RBAC
models (``Permission`` / ``Role``). Phase 9 adds a single system-scoped
``Backup`` model to track real backup artifacts produced by the backup service.
"""

from django.conf import settings
from django.db import models


class Backup(models.Model):
    """
    Metadata for one application-produced backup artifact.

    Backups are **system-level** objects: they contain the entire CRM dataset
    and are deliberately not company-scoped (no ``company_id`` / ``tenant_id``).
    The artifact itself lives under ``settings.BACKUP_ROOT`` — never under
    ``MEDIA_ROOT`` — and is only reachable through the authenticated System
    Admin download endpoint.

    ``status`` reflects the real lifecycle of the underlying process:

    * ``pending``  — requested, not yet started,
    * ``running``  — the artifact is being produced,
    * ``completed`` — a real artifact exists (file on disk, size + checksum),
    * ``failed``   — the process failed; no usable artifact was produced.

    A row is only marked ``completed`` after the artifact has actually been
    written and its SHA-256 checksum computed.
    """

    class Type(models.TextChoices):
        DATABASE = "database", "Database"
        MEDIA = "media", "Media"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    #: Logical storage label returned to clients instead of any filesystem path.
    STORAGE_LABEL = "backup-storage"

    backup_type = models.CharField(
        max_length=16,
        choices=Type.choices,
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    #: Server-generated artifact filename (never client-supplied).
    file_name = models.CharField(max_length=255, blank=True, default="")
    file_size = models.BigIntegerField(null=True, blank=True)
    checksum_sha256 = models.CharField(max_length=64, blank=True, default="")
    #: Generic, non-secret failure detail (never raw stderr, never credentials).
    error_message = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="system_backups",
    )

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["backup_type"]),
        ]

    def __str__(self):
        return f"{self.backup_type} backup #{self.pk} ({self.status})"