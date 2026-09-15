"""
Phase 9 — System Admin backup API tests.

Covers the authorization boundary (anonymous/tenant/forged-scope/admin-without-
permission/admin-allowed), backup capability reporting, the real artifact
lifecycle (create database/media, verify, download, delete), failure handling
(no fake ``completed`` records), audit attribution, and secret-leakage
prevention.

The ``pg_dump`` subprocess is mocked (``subprocess.run``), and artifact/media
storage is redirected to temporary directories via ``override_settings`` — no
production database, no real dump, no test dependency on local PostgreSQL tools
beyond the test database itself.

Full 600+ backend suite intentionally NOT run.
"""

import shutil
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.conf import settings as django_settings
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.audit_logs.models import AuditLog
from apps.authentication.models import Permission, Role, Scope, UserRole
from apps.authentication.rbac import is_system_admin
from apps.authentication.tests.test_authentication import make_company, make_user
from apps.system_admin.backup_services import _sha256_hex
from apps.system_admin.constants import SYSTEM_ADMIN_SCOPE, SYSTEM_ADMIN_SCOPE_CLAIM
from apps.system_admin.models import Backup
from apps.system_admin.tests.support import make_platform_company, make_system_admin

DUMP_BYTES = b"mock pg_dump custom-format payload\n"


class FakePgDump:
    """Simulates ``subprocess.run`` for pg_dump without touching PostgreSQL."""

    def __init__(self, returncode=0, stderr=""):
        self.returncode = returncode
        self.stderr = stderr
        self.calls = []

    def __call__(self, command, **kwargs):
        self.calls.append((list(command), dict(kwargs)))
        if self.returncode != 0:
            return subprocess.CompletedProcess(
                command, self.returncode, stdout="", stderr=self.stderr
            )
        dest = command[command.index("--file") + 1]
        Path(dest).write_bytes(DUMP_BYTES)
        return subprocess.CompletedProcess(
            command, 0, stdout="", stderr=""
        )


class BackupManagementTestBase(APITestCase):
    def setUp(self):
        self.platform = make_platform_company()
        self.admin = make_system_admin(
            company=self.platform, email="root@grm.example"
        )
        self.tenant_company = make_company()
        self.tenant_user = make_user(
            self.tenant_company, email="alice@example.com"
        )

        self.backup_root = Path(tempfile.mkdtemp(prefix="grm-backup-root-"))
        self.media_root = Path(tempfile.mkdtemp(prefix="grm-media-root-"))
        self.pg_dump = self.backup_root / "pg_dump.exe"
        self.pg_dump.write_bytes(b"fake pg_dump")
        self.addCleanup(lambda: shutil.rmtree(self.backup_root, ignore_errors=True))
        self.addCleanup(lambda: shutil.rmtree(self.media_root, ignore_errors=True))

    # ------------------------------------------------------------- helpers

    def backup_settings(self):
        return override_settings(
            BACKUP_ROOT=str(self.backup_root),
            MEDIA_ROOT=str(self.media_root),
            PG_DUMP_PATH=str(self.pg_dump),
        )

    def request(self, method, url, **kwargs):
        """Issue a client call with the temp storage settings applied."""
        with self.backup_settings():
            return getattr(self.client, method)(url, **kwargs)

    def admin_token(self, scope=SYSTEM_ADMIN_SCOPE):
        token = AccessToken()
        if scope is not None:
            token[SYSTEM_ADMIN_SCOPE_CLAIM] = scope
        return token

    def authenticate_admin(self, user=None, scope=SYSTEM_ADMIN_SCOPE):
        self.client.force_authenticate(
            user=user or self.admin, token=self.admin_token(scope)
        )

    def grant_all_tenant_permissions(self, user):
        role = Role.objects.create(
            name=f"Tenant Admin {user.id}", company=None, scope=Scope.TENANT
        )
        for permission in Permission.objects.filter(scope=Scope.TENANT):
            role.permissions.add(permission)
        UserRole.objects.create(user=user, role=role)

    def grant_system_permissions(self, user, *codes):
        role = Role.objects.create(
            name=f"System Role {user.id}", company=None, scope=Scope.SYSTEM
        )
        for code in codes:
            role.permissions.add(
                Permission.objects.get(code=code, scope=Scope.SYSTEM)
            )
        UserRole.objects.create(user=user, role=role)

    def list_url(self):
        return reverse("admin-backup-list-create")

    def capability_url(self):
        return reverse("admin-backup-capability")

    def detail_url(self, pk):
        return reverse("admin-backup-detail", args=[pk])

    def download_url(self, pk):
        return reverse("admin-backup-download", args=[pk])

    def verify_url(self, pk):
        return reverse("admin-backup-verify", args=[pk])

    def create_backup_via_api(self, backup_type="database"):
        fake = FakePgDump()
        with self.backup_settings(), patch(
            "apps.system_admin.backup_services.subprocess.run", fake
        ):
            return fake, self.client.post(
                self.list_url(), {"backup_type": backup_type}, format="json"
            )

    def create_completed_backup(self, backup_type=Backup.Type.DATABASE):
        backup = Backup.objects.create(
            backup_type=backup_type,
            status=Backup.Status.COMPLETED,
            created_by=self.admin,
            file_name="grm-backup-test-0001.dump",
            file_size=len(DUMP_BYTES),
        )
        artifact = self.backup_root / backup.file_name
        artifact.write_bytes(DUMP_BYTES)
        backup.checksum_sha256 = _sha256_hex(artifact)
        backup.save(update_fields=["checksum_sha256"])
        return backup


class BackupAuthorizationTests(BackupManagementTestBase):
    def test_anonymous_is_rejected(self):
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_tenant_user_is_denied(self):
        self.client.force_authenticate(user=self.tenant_user)
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_tenant_user_with_all_tenant_permissions_is_denied(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        self.client.force_authenticate(user=self.tenant_user)
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_forged_scope_claim_on_tenant_user_is_denied(self):
        self.grant_all_tenant_permissions(self.tenant_user)
        self.client.force_authenticate(
            user=self.tenant_user, token=self.admin_token()
        )
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_system_admin_without_backup_permission_is_denied(self):
        restricted = make_user(self.platform, email="ops@grm.example")
        self.grant_system_permissions(restricted, "system.audit.read")
        self.assertTrue(is_system_admin(restricted))
        self.authenticate_admin(user=restricted)
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_authorized_system_admin_is_allowed(self):
        self.authenticate_admin()
        self.assertEqual(
            self.client.get(self.list_url()).status_code,
            status.HTTP_200_OK,
        )

    def test_download_endpoint_requires_same_boundary(self):
        self.client.force_authenticate(user=self.tenant_user)
        response = self.client.get(self.download_url(1))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class BackupCapabilityTests(BackupManagementTestBase):
    def test_reports_unavailable_when_pg_dump_unset(self):
        self.authenticate_admin()
        with override_settings(PG_DUMP_PATH=""):
            with patch(
                "apps.system_admin.backup_services.shutil.which",
                return_value=None,
            ):
                body = self.client.get(self.capability_url()).json()
        self.assertFalse(body["database"]["available"])
        self.assertIn("pg_dump", body["database"]["reason"])

    def test_reports_database_available_when_pg_dump_configured(self):
        self.authenticate_admin()
        with self.backup_settings():
            body = self.client.get(self.capability_url()).json()
        self.assertTrue(body["database"]["available"])
        self.assertTrue(body["media"]["available"])

    def test_reports_media_unavailable_when_media_root_missing(self):
        self.authenticate_admin()
        with override_settings(MEDIA_ROOT="/nonexistent/grm/media"):
            body = self.client.get(self.capability_url()).json()
        self.assertFalse(body["media"]["available"])

    def test_backup_root_overlapping_media_root_fails_safely(self):
        self.authenticate_admin()
        with override_settings(
            BACKUP_ROOT=str(self.media_root / "backups"),
            MEDIA_ROOT=str(self.media_root),
        ):
            response = self.client.post(
                self.list_url(), {"backup_type": "media"}, format="json"
            )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["status"], Backup.Status.FAILED)
        self.assertIn("overlap", response.json()["error_message"])

    def test_backup_root_failure_does_not_expose_filesystem_path(self):
        self.authenticate_admin()
        with override_settings(
            BACKUP_ROOT=str(self.media_root / "backups"),
            MEDIA_ROOT=str(self.media_root),
        ):
            response = self.client.post(
                self.list_url(), {"backup_type": "media"}, format="json"
            )
        self.assertNotIn(str(self.media_root), response.content.decode())


class BackupCreateDatabaseTests(BackupManagementTestBase):
    def test_create_database_backup_produces_real_artifact(self):
        self.authenticate_admin()
        fake, response = self.create_backup_via_api("database")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        self.assertEqual(body["status"], Backup.Status.COMPLETED)
        self.assertEqual(body["backup_type"], "database")
        self.assertTrue(body["file_size"] > 0)
        self.assertEqual(len(body["checksum_sha256"]), 64)
        self.assertEqual(body["storage"], "backup-storage")
        self.assertNotIn("MEDIA_ROOT", body.get("storage", ""))
        self.assertNotIn(str(self.backup_root), body.get("file_name", ""))

        artifact = self.backup_root / body["file_name"]
        self.assertTrue(artifact.is_file())
        self.assertGreater(artifact.stat().st_size, 0)
        self.assertEqual(_sha256_hex(artifact), body["checksum_sha256"])
        self.assertEqual(artifact.read_bytes(), DUMP_BYTES)

    def test_pg_dump_command_has_no_password_in_args(self):
        self.authenticate_admin()
        fake, response = self.create_backup_via_api("database")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        command, kwargs = fake.calls[0]
        joined = " ".join(command)
        self.assertNotIn(django_settings.DATABASES["default"]["PASSWORD"], joined)
        self.assertNotIn("PGPASSWORD", joined)
        self.assertIn("--format=custom", joined)
        self.assertIn("--no-owner", joined)
        self.assertIn("--no-privileges", joined)
        self.assertIn("--file", joined)
        self.assertEqual(kwargs.get("shell", False), False)
        self.assertEqual(kwargs["env"]["PGPASSWORD"], django_settings.DATABASES["default"]["PASSWORD"])

    def test_failed_pg_dump_never_creates_completed_record(self):
        self.authenticate_admin()
        with self.backup_settings():
            fake = FakePgDump(returncode=1, stderr="connection refused")
            with patch(
                "apps.system_admin.backup_services.subprocess.run", fake
            ):
                response = self.client.post(
                    self.list_url(), {"backup_type": "database"}, format="json"
                )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        self.assertEqual(body["status"], Backup.Status.FAILED)
        self.assertEqual(body["file_size"], None)
        self.assertEqual(body["checksum_sha256"], "")
        # No dump artifact may remain from the failed attempt.
        self.assertEqual(list(self.backup_root.glob("*.dump")), [])

    def test_timeout_marks_backup_failed(self):
        self.authenticate_admin()
        with self.backup_settings():
            def timeout(command, **kwargs):
                raise subprocess.TimeoutExpired(command, timeout=1)

            with patch(
                "apps.system_admin.backup_services.subprocess.run", timeout
            ):
                response = self.client.post(
                    self.list_url(), {"backup_type": "database"}, format="json"
                )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["status"], Backup.Status.FAILED)

    def test_unavailable_capability_is_400_and_creates_no_record(self):
        self.authenticate_admin()
        with override_settings(PG_DUMP_PATH=""):
            with patch(
                "apps.system_admin.backup_services.shutil.which",
                return_value=None,
            ):
                response = self.client.post(
                    self.list_url(), {"backup_type": "database"}, format="json"
                )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Backup.objects.exists())

    def test_concurrent_running_backup_is_409(self):
        Backup.objects.create(
            backup_type=Backup.Type.DATABASE,
            status=Backup.Status.RUNNING,
            created_by=self.admin,
        )
        self.authenticate_admin()
        with self.backup_settings():
            fake = FakePgDump()
            with patch(
                "apps.system_admin.backup_services.subprocess.run", fake
            ):
                response = self.client.post(
                    self.list_url(), {"backup_type": "database"}, format="json"
                )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(len(fake.calls), 0)


class BackupCreateMediaTests(BackupManagementTestBase):
    def test_create_media_backup_zips_media_root(self):
        sample = self.media_root / "generated" / "doc.txt"
        sample.parent.mkdir(parents=True)
        sample.write_text("hello media")
        self.authenticate_admin()
        with self.backup_settings():
            response = self.client.post(
                self.list_url(), {"backup_type": "media"}, format="json"
            )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        self.assertEqual(body["status"], Backup.Status.COMPLETED)
        self.assertEqual(body["backup_type"], "media")
        artifact = self.backup_root / body["file_name"]
        self.assertTrue(artifact.is_file())
        import zipfile

        with zipfile.ZipFile(artifact) as archive:
            names = archive.namelist()
        self.assertIn("generated/doc.txt", names)

    def test_empty_media_root_fails_honestly(self):
        self.authenticate_admin()
        with self.backup_settings():
            response = self.client.post(
                self.list_url(), {"backup_type": "media"}, format="json"
            )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        self.assertEqual(body["status"], Backup.Status.FAILED)
        self.assertIn("no application files", body["error_message"])


class BackupListDetailTests(BackupManagementTestBase):
    def test_list_and_detail(self):
        backup = self.create_completed_backup()
        self.authenticate_admin()
        body = self.request("get", self.list_url()).json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["id"], backup.id)
        self.assertEqual(body["results"][0]["storage"], "backup-storage")

        detail = self.request("get", self.detail_url(backup.id)).json()
        self.assertEqual(detail["id"], backup.id)
        self.assertEqual(detail["status"], Backup.Status.COMPLETED)


class BackupVerifyTests(BackupManagementTestBase):
    def test_verify_matches_checksum(self):
        backup = self.create_completed_backup()
        self.authenticate_admin()
        response = self.request("post", self.verify_url(backup.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertTrue(body["exists"])
        self.assertEqual(body["size"], len(DUMP_BYTES))
        self.assertTrue(body["checksum_matches"])

    def test_verify_detects_tampered_artifact(self):
        backup = self.create_completed_backup()
        (self.backup_root / backup.file_name).write_bytes(b"tampered")
        self.authenticate_admin()
        body = self.request("post", self.verify_url(backup.id)).json()
        self.assertTrue(body["exists"])
        self.assertFalse(body["checksum_matches"])

    def test_verify_missing_artifact(self):
        backup = self.create_completed_backup()
        (self.backup_root / backup.file_name).unlink()
        self.authenticate_admin()
        body = self.request("post", self.verify_url(backup.id)).json()
        self.assertFalse(body["exists"])
        self.assertFalse(body["checksum_matches"])


class BackupDownloadTests(BackupManagementTestBase):
    def test_download_streams_real_artifact(self):
        backup = self.create_completed_backup()
        self.authenticate_admin()
        response = self.request("get", self.download_url(backup.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            b"".join(response.streaming_content), DUMP_BYTES
        )
        disposition = response.get("Content-Disposition", "")
        self.assertIn(backup.file_name, disposition)

    def test_download_non_completed_is_400(self):
        backup = Backup.objects.create(
            backup_type=Backup.Type.DATABASE,
            status=Backup.Status.FAILED,
            created_by=self.admin,
        )
        self.authenticate_admin()
        response = self.request("get", self.download_url(backup.id))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_download_missing_artifact_is_404(self):
        backup = self.create_completed_backup()
        (self.backup_root / backup.file_name).unlink()
        self.authenticate_admin()
        response = self.request("get", self.download_url(backup.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class BackupDeleteTests(BackupManagementTestBase):
    def test_delete_removes_artifact_and_record(self):
        backup = self.create_completed_backup()
        artifact = self.backup_root / backup.file_name
        self.assertTrue(artifact.is_file())
        self.authenticate_admin()
        response = self.request("delete", self.detail_url(backup.id))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(artifact.exists())
        self.assertFalse(Backup.objects.filter(pk=backup.id).exists())

    def test_delete_running_backup_is_409_and_kept(self):
        backup = Backup.objects.create(
            backup_type=Backup.Type.MEDIA,
            status=Backup.Status.RUNNING,
            created_by=self.admin,
        )
        self.authenticate_admin()
        response = self.request("delete", self.detail_url(backup.id))
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(Backup.objects.filter(pk=backup.id).exists())

    def test_delete_with_missing_artifact_is_safe(self):
        backup = self.create_completed_backup()
        (self.backup_root / backup.file_name).unlink()
        self.authenticate_admin()
        response = self.request("delete", self.detail_url(backup.id))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Backup.objects.filter(pk=backup.id).exists())


class BackupSecretLeakTests(BackupManagementTestBase):
    def test_responses_never_expose_credentials_or_paths(self):
        self.authenticate_admin()
        fake, create_response = self.create_backup_via_api("database")
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        backup = Backup.objects.get()
        raw = create_response.content.decode()
        password = django_settings.DATABASES["default"]["PASSWORD"]
        self.assertNotIn(password, raw)
        self.assertNotIn("PGPASSWORD", raw)
        self.assertNotIn(str(self.backup_root), raw)
        self.assertNotIn(str(self.media_root), raw)

        list_raw = self.request("get", self.list_url()).content.decode()
        self.assertNotIn(str(self.backup_root), list_raw)

        detail_raw = self.request(
            "get", self.detail_url(backup.id)
        ).content.decode()
        self.assertNotIn(str(self.backup_root), detail_raw)

        verify_raw = self.request(
            "post", self.verify_url(backup.id)
        ).content.decode()
        self.assertNotIn(str(self.backup_root), verify_raw)


class BackupAuditTests(BackupManagementTestBase):
    def test_successful_backup_is_audited_on_platform_company(self):
        self.authenticate_admin()
        _, response = self.create_backup_via_api("database")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        backup = Backup.objects.get()
        actions = {
            log.action
            for log in AuditLog.objects.filter(
                entity_type="backup", entity_id=backup.id
            )
        }
        self.assertEqual(actions, {"backup.create", "backup.completed"})
        for log in AuditLog.objects.filter(entity_type="backup"):
            self.assertEqual(log.company_id, self.platform.id)
            self.assertEqual(log.user_id, self.admin.id)
            self.assertNotIn("password", str(log.new_values).lower())

    def test_failed_backup_is_audited_as_failed(self):
        self.authenticate_admin()
        with self.backup_settings():
            with patch(
                "apps.system_admin.backup_services.subprocess.run",
                FakePgDump(returncode=1, stderr="boom"),
            ):
                response = self.client.post(
                    self.list_url(), {"backup_type": "database"}, format="json"
                )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        backup = Backup.objects.get()
        actions = {
            log.action
            for log in AuditLog.objects.filter(
                entity_type="backup", entity_id=backup.id
            )
        }
        self.assertEqual(actions, {"backup.create", "backup.failed"})

    def test_download_verify_and_delete_are_audited(self):
        backup = self.create_completed_backup()
        self.authenticate_admin()
        # Consume the download stream so the response (and its file handle)
        # is closed before deletion runs.
        download = self.request("get", self.download_url(backup.id))
        self.assertEqual(b"".join(download.streaming_content), DUMP_BYTES)
        self.request("post", self.verify_url(backup.id))
        delete_response = self.request("delete", self.detail_url(backup.id))
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        actions = set(
            AuditLog.objects.filter(entity_type="backup").values_list(
                "action", flat=True
            )
        )
        self.assertTrue(
            {"backup.download", "backup.verify", "backup.delete"}
            <= actions
        )
