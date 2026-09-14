"""
Application-triggered System Admin backup services (Phase 9).

Produces **real** backup artifacts and never fabricates them:

* ``database`` backups run the server-configured ``pg_dump`` against the
  configured PostgreSQL connection and write a **custom-format** dump
  (``-Fc``) — a compressed, single-file, consistent snapshot that is restored
  with ``pg_restore`` (restore itself is out of scope in this phase).
* ``media`` backups archive the **explicit scope** of ``MEDIA_ROOT`` (the
  application-managed template/generated-document files) into a ZIP; the whole
  project or the machine is never archived.

Security properties:

* The ``pg_dump`` executable path is server configuration
  (``settings.PG_DUMP_PATH`` or ``shutil.which``), never client input.
* The command is a fixed argument list (no ``shell=True``, no interpolation).
* The database password is passed only through the ``PGPASSWORD`` environment
  variable of the subprocess — it never appears in ``argv``, logs, exceptions,
  audit payloads, or API responses.
* A timeout bounds every subprocess; a non-zero exit status, a timeout, or an
  ``OSError`` marks the backup ``failed`` (no ``completed`` record is ever
  created without a real artifact).
* Artifacts live under ``settings.BACKUP_ROOT`` — never ``MEDIA_ROOT``, never a
  web-served path — and are addressed only through authenticated System Admin
  endpoints.

Capabilities are reported honestly: when ``pg_dump`` cannot be resolved,
database backups are reported as unavailable rather than silently failing.
"""

import hashlib
import logging
import os
import secrets
import shutil
import subprocess
import zipfile
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from apps.system_admin.models import Backup

logger = logging.getLogger(__name__)

#: Logical storage label exposed to clients instead of any filesystem path.
STORAGE_LABEL = Backup.STORAGE_LABEL


class BackupServiceError(Exception):
    """Base error for the backup service."""


class BackupCapabilityError(BackupServiceError):
    """The requested backup type is not available on this server."""


class BackupInProgressError(BackupServiceError):
    """A backup is already pending/running; concurrent creation is refused."""


class BackupExecutionError(BackupServiceError):
    """The backup process itself failed (generic, non-secret message)."""


class BackupDeleteError(BackupServiceError):
    """The backup artifact could not be removed."""


# ---------------------------------------------------------------------------
# Storage / capability
# ---------------------------------------------------------------------------


def get_backup_storage_root():
    """Return the (created) artifact directory, never web-served."""
    root = Path(settings.BACKUP_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_pg_dump_path():
    """
    Return the resolved ``pg_dump`` executable path, or ``None``.

    ``settings.PG_DUMP_PATH`` wins when set and points at an existing file;
    otherwise ``pg_dump`` is discovered via ``PATH``. ``None`` means database
    backups are unavailable on this server.
    """
    configured = (getattr(settings, "PG_DUMP_PATH", "") or "").strip()
    if configured:
        candidate = Path(configured)
        if candidate.is_file():
            return candidate
        logger.warning(
            "PG_DUMP_PATH is set but does not name an existing file: %s",
            configured,
        )
        return None
    discovered = shutil.which("pg_dump")
    return Path(discovered) if discovered else None


def database_backup_capability():
    path = resolve_pg_dump_path()
    if path is None:
        return {
            "available": False,
            "reason": "pg_dump is not configured or not installed on this server.",
        }
    return {
        "available": True,
        "reason": "pg_dump is configured on this server.",
    }


def media_backup_capability():
    media_root = Path(settings.MEDIA_ROOT)
    if not media_root.is_dir():
        return {
            "available": False,
            "reason": "The media storage directory is not available.",
        }
    return {
        "available": True,
        "reason": "Media files are stored on the local filesystem.",
    }


def backup_capabilities():
    """Report actual, per-type backup capability for the admin surface."""
    return {
        Backup.Type.DATABASE: database_backup_capability(),
        Backup.Type.MEDIA: media_backup_capability(),
    }


def backup_artifact_path(backup):
    """
    Resolve a backup's artifact path inside ``BACKUP_ROOT``, or ``None``.

    ``file_name`` is always server-generated, but the resolved path is still
    confined to the storage root as defense-in-depth.
    """
    if not backup.file_name:
        return None
    root = get_backup_storage_root().resolve()
    candidate = (root / backup.file_name).resolve()
    if candidate != root and root not in candidate.parents:
        return None
    return candidate


# ---------------------------------------------------------------------------
# Artifact helpers
# ---------------------------------------------------------------------------


def _generate_filename(backup_type):
    timestamp = timezone.now().strftime("%Y%m%d-%H%M%S")
    token = secrets.token_hex(4)
    extension = "dump" if backup_type == Backup.Type.DATABASE else "zip"
    return f"grm-backup-{backup_type}-{timestamp}-{token}.{extension}"


def _sha256_hex(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _redact_text(text, password):
    """Remove the database password from a log/error snippet, if present."""
    if not text or not password:
        return text
    return text.replace(password, "[REDACTED]")


# ---------------------------------------------------------------------------
# Artifact producers
# ---------------------------------------------------------------------------


def _run_pg_dump(dest):
    """Run pg_dump (custom format) to ``dest``; raise on any failure."""
    pg_dump_path = resolve_pg_dump_path()
    if pg_dump_path is None:
        raise BackupExecutionError(
            "Database backups are not available: pg_dump is not configured "
            "on this server."
        )

    db = settings.DATABASES["default"]
    password = str(db.get("PASSWORD") or "")
    command = [
        str(pg_dump_path),
        "--host",
        str(db.get("HOST") or "127.0.0.1"),
        "--port",
        str(db.get("PORT") or "5432"),
        "--username",
        str(db.get("USER") or ""),
        "--dbname",
        str(db.get("NAME") or ""),
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        str(dest),
    ]
    env = dict(os.environ)
    env["PGPASSWORD"] = password

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=settings.BACKUP_CREATION_TIMEOUT,
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired:
        logger.error(
            "Backup creation timed out after %ss.",
            settings.BACKUP_CREATION_TIMEOUT,
        )
        raise BackupExecutionError("Backup creation timed out.")
    except OSError:
        logger.exception("Backup process could not be started.")
        raise BackupExecutionError("The backup process could not be started.")

    if result.returncode != 0:
        logger.error(
            "pg_dump failed with exit code %s: %s",
            result.returncode,
            _redact_text(result.stderr, password),
        )
        raise BackupExecutionError("The database backup process failed.")

    if not dest.is_file() or dest.stat().st_size == 0:
        raise BackupExecutionError(
            "The backup process did not produce a usable artifact."
        )


def _archive_media_root(dest):
    """ZIP the explicit scope ``MEDIA_ROOT`` (templates + generated files)."""
    media_root = Path(settings.MEDIA_ROOT).resolve()
    if not media_root.is_dir():
        raise BackupExecutionError(
            "Media backups are not available: the media storage directory "
            "does not exist."
        )

    archived = 0
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_STORED) as archive:
        for root, dirs, files in os.walk(media_root):
            for name in files:
                full_path = Path(root) / name
                try:
                    arcname = full_path.resolve().relative_to(media_root).as_posix()
                except ValueError:
                    continue
                archive.write(full_path, arcname)
                archived += 1

    if archived == 0:
        raise BackupExecutionError(
            "There are no application files to back up."
        )


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


def create_backup_record(*, backup_type, actor):
    """
    Validate capability/concurrency and create a ``running`` backup record.

    Raises:
        BackupCapabilityError: the type is unavailable on this server.
        BackupInProgressError: a backup is already pending/running.
    """
    capability = backup_capabilities().get(backup_type, {})
    if not capability.get("available"):
        raise BackupCapabilityError(
            capability.get("reason", "This backup type is unavailable.")
        )

    running = Backup.objects.filter(
        status__in=[Backup.Status.PENDING, Backup.Status.RUNNING]
    ).exists()
    if running:
        raise BackupInProgressError(
            "A backup is already in progress. Wait for it to finish."
        )

    return Backup.objects.create(
        backup_type=backup_type,
        status=Backup.Status.RUNNING,
        created_by=actor,
    )


def run_backup(backup):
    """
    Produce the real artifact for ``backup`` and update its final status.

    ``completed`` is written only after the artifact exists on disk with its
    size and SHA-256 recorded; any execution failure yields ``failed`` with a
    generic ``error_message`` and the partial artifact removed.
    """
    storage_root = get_backup_storage_root()
    dest = storage_root / _generate_filename(backup.backup_type)
    try:
        if backup.backup_type == Backup.Type.DATABASE:
            _run_pg_dump(dest)
        else:
            _archive_media_root(dest)

        backup.file_name = dest.name
        backup.file_size = dest.stat().st_size
        backup.checksum_sha256 = _sha256_hex(dest)
        backup.status = Backup.Status.COMPLETED
        backup.completed_at = timezone.now()
        backup.error_message = ""
        backup.save(update_fields=[
            "file_name",
            "file_size",
            "checksum_sha256",
            "status",
            "completed_at",
            "error_message",
            "updated_at",
        ])
    except BackupExecutionError as exc:
        _remove_artifact(dest)
        backup.status = Backup.Status.FAILED
        backup.error_message = str(exc)
        backup.save(update_fields=["status", "error_message", "updated_at"])

    return backup


def create_backup(*, backup_type, actor):
    """Convenience wrapper: create the record then produce the artifact."""
    backup = create_backup_record(backup_type=backup_type, actor=actor)
    return run_backup(backup)


def _remove_artifact(path):
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        logger.exception("Could not remove partial backup artifact %s", path)


def verify_backup(backup):
    """
    Verify an existing artifact on demand (file exists + non-zero size + SHA-256
    matches). A checksum proves *integrity*, not successful restoration.
    """
    path = backup_artifact_path(backup)
    if path is None or not path.is_file():
        return {"exists": False, "size": None, "checksum_matches": False}
    size = path.stat().st_size
    actual = _sha256_hex(path)
    matches = bool(backup.checksum_sha256) and secrets.compare_digest(
        backup.checksum_sha256, actual
    )
    return {"exists": True, "size": size, "checksum_matches": matches}


def delete_backup(backup):
    """
    Permanently remove a backup: artifact first, then the metadata record.

    Only completed/failed backups may be deleted. A missing artifact is handled
    safely (metadata still removed); an ``OSError`` during removal leaves the
    record intact so the operator can retry.
    """
    if backup.status in (Backup.Status.PENDING, Backup.Status.RUNNING):
        raise BackupInProgressError(
            "A backup that is pending or in progress cannot be deleted."
        )

    path = backup_artifact_path(backup)
    if path is not None:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise BackupDeleteError(
                "The backup artifact could not be removed."
            ) from exc

    backup.delete()