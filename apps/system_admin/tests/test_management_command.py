"""Tests for the ``provision_system_admin`` management command."""

from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from apps.authentication.models import User, UserRole
from apps.authentication.rbac import is_system_admin
from apps.companies.models import Company
from apps.system_admin.services import PlatformConfigurationError, get_platform_company
from apps.system_admin.tests.support import PASSWORD, make_platform_company


class ProvisionSystemAdminCommandTests(TestCase):
    EMAIL = "root@grm.example"

    def run_command(self, email=EMAIL, password=PASSWORD, **extra):
        out = StringIO()
        call_command(
            "provision_system_admin",
            email=email,
            password=password,
            stdout=out,
            **extra,
        )
        return out.getvalue()

    def test_provisions_platform_company_admin_and_role(self):
        self.run_command()

        platform = Company.objects.get(is_platform=True)
        self.assertEqual(platform.display_name, "GRM Platform")
        self.assertEqual(platform.status, Company.Status.ACTIVE)

        role = platform.users.get(email=self.EMAIL).role_assignments.get().role
        self.assertEqual(role.name, "System Admin")
        self.assertTrue(role.company_id is None)
        self.assertEqual(role.scope, "system")
        self.assertEqual(
            role.permissions.count(), 7
        )

        user = User.objects.get(company=platform, email=self.EMAIL)
        self.assertTrue(user.check_password(PASSWORD))
        self.assertTrue(user.is_active)
        self.assertTrue(is_system_admin(user))

    def test_command_output_does_not_leak_the_password(self):
        output = self.run_command(password="Super-Secret-Pass-123")
        self.assertNotIn("Super-Secret-Pass-123", output)

    def test_idempotent_rerun_does_not_duplicate(self):
        self.run_command()
        self.run_command()

        self.assertEqual(Company.objects.filter(is_platform=True).count(), 1)
        platform = Company.objects.get(is_platform=True)
        self.assertEqual(
            User.objects.filter(company=platform, email=self.EMAIL).count(), 1
        )
        self.assertEqual(
            UserRole.objects.filter(user__company=platform).count(), 1
        )

    def test_rerun_does_not_change_existing_password(self):
        self.run_command(password="first-password")
        self.run_command(password="second-password")
        user = User.objects.get(email=self.EMAIL, company__is_platform=True)
        self.assertTrue(user.check_password("first-password"))
        self.assertFalse(user.check_password("second-password"))

    def test_refuses_to_reuse_soft_deleted_account(self):
        self.run_command()
        user = User.objects.get(email=self.EMAIL, company__is_platform=True)
        user.deleted_at = timezone.now()
        user.save(update_fields=["deleted_at"])

        with self.assertRaises(CommandError):
            self.run_command()

    def test_refuses_to_reuse_soft_deleted_platform_company(self):
        platform = make_platform_company()
        platform.deleted_at = timezone.now()
        platform.save(update_fields=["deleted_at"])
        with self.assertRaises(CommandError):
            self.run_command()

    def test_requires_email(self):
        with self.assertRaises(CommandError):
            call_command("provision_system_admin", password=PASSWORD)

    def test_second_platform_company_is_blocked_by_db_constraint(self):
        make_platform_company()
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Company.objects.create(
                    legal_name="Second",
                    display_name="Second",
                    status=Company.Status.ACTIVE,
                    is_platform=True,
                )

    def test_get_platform_company_raises_when_unprovisioned(self):
        with self.assertRaises(PlatformConfigurationError):
            get_platform_company()
