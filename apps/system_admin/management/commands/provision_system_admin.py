"""
Provision the reserved platform company and a System Admin account.

This is the ONLY supported way to create a System Admin in Phase 1. It is
deliberately a local management command (not an HTTP endpoint): platform
privilege must never be obtainable through the public API.

Once created, an account's password is never changed here — no password-reset
behavior is part of this phase. The command is idempotent and fails loudly
rather than silently creating duplicate privileged accounts.

Run with:
    python manage.py provision_system_admin --email admin@grm.example
(omit --password to be prompted; the password is never echoed or logged.)
"""

from getpass import getpass

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.authentication.models import (
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
)
from apps.authentication.models import Scope as RbacScope
from apps.companies.models import Company
from apps.system_admin.constants import (
    PLATFORM_COMPANY_DISPLAY_NAME,
    PLATFORM_COMPANY_LEGAL_NAME,
    SYSTEM_ADMIN_ROLE_NAME,
    SYSTEM_PERMISSIONS,
)


class Command(BaseCommand):
    help = "Provision the GRM Platform company and a System Admin account."

    def add_arguments(self, parser):
        parser.add_argument(
            "--email",
            required=True,
            help="Email of the System Admin account to create or ensure.",
        )
        parser.add_argument(
            "--password",
            default=None,
            help=(
                "Password for a NEW account. Omit to be prompted. Never used "
                "to change an existing account's password, and never logged."
            ),
        )
        parser.add_argument("--first-name", default="System")
        parser.add_argument("--last-name", default="Administrator")

    def handle(self, *args, **options):
        email = (options["email"] or "").strip()
        if not email:
            raise CommandError("--email must not be empty.")

        with transaction.atomic():
            company = self._ensure_platform_company()
            self._ensure_system_permissions()
            role = self._ensure_system_admin_role()

            existing = (
                User.objects.filter(company=company, email__iexact=email)
                .order_by("-is_active", "id")
                .first()
            )
            if existing is not None:
                if existing.deleted_at is not None:
                    raise CommandError(
                        "A soft-deleted account already exists for "
                        f"{email!r} in the platform company (id={existing.id}). "
                        "It is not reused automatically; resolve it explicitly."
                    )
                user = existing
                self.stdout.write(
                    f"Account already exists (id={user.id}); ensuring role only."
                )
            else:
                password = options.get("password")
                if password is None:
                    password = getpass("Password for the new System Admin: ")
                    if password != getpass("Confirm password: "):
                        raise CommandError("Passwords do not match.")
                if not password:
                    raise CommandError("A non-empty password is required.")
                user = User.objects.create_user(
                    company=company,
                    email=email,
                    password=password,
                    first_name=options["first_name"],
                    last_name=options["last_name"],
                )
                self.stdout.write(f"Created System Admin account (id={user.id}).")

            UserRole.objects.get_or_create(user=user, role=role)

        self.stdout.write(
            self.style.SUCCESS(
                f"System Admin ready: {user.email} (company={company.id}, "
                f"role={role.name})."
            )
        )

    # ------------------------------------------------------------------ steps

    def _ensure_platform_company(self):
        existing = Company.objects.filter(is_platform=True)
        if existing.count() > 1:
            raise CommandError(
                "Multiple platform companies exist; refusing to continue."
            )
        company = existing.first()
        if company is None:
            company = Company.objects.create(
                legal_name=PLATFORM_COMPANY_LEGAL_NAME,
                display_name=PLATFORM_COMPANY_DISPLAY_NAME,
                status=Company.Status.ACTIVE,
                is_platform=True,
            )
            self.stdout.write(f"Created platform company (id={company.id}).")
            return company
        if company.deleted_at is not None:
            raise CommandError(
                "The platform company exists but is soft-deleted; refusing to "
                "reuse it."
            )
        if company.status != Company.Status.ACTIVE:
            company.status = Company.Status.ACTIVE
            company.save(update_fields=["status", "updated_at"])
            self.stdout.write("Reactivated the platform company.")
        return company

    def _ensure_system_permissions(self):
        for code, description in SYSTEM_PERMISSIONS:
            permission, created = Permission.objects.get_or_create(
                code=code,
                defaults={
                    "description": description,
                    "scope": RbacScope.SYSTEM,
                },
            )
            if not created and permission.scope != RbacScope.SYSTEM:
                raise CommandError(
                    f"Permission {code!r} exists with tenant scope; it must be "
                    "system-scoped. Refusing to mutate existing data."
                )

    def _ensure_system_admin_role(self):
        role, created = Role.objects.get_or_create(
            name=SYSTEM_ADMIN_ROLE_NAME,
            company=None,
            defaults={"scope": RbacScope.SYSTEM},
        )
        if not created and (role.scope != RbacScope.SYSTEM or role.company_id is not None):
            raise CommandError(
                f"Role {SYSTEM_ADMIN_ROLE_NAME!r} exists with the wrong scope "
                "or company; refusing to mutate it."
            )
        permissions = Permission.objects.filter(
            code__in=[code for code, _ in SYSTEM_PERMISSIONS],
            scope=RbacScope.SYSTEM,
        )
        for permission in permissions:
            RolePermission.objects.get_or_create(role=role, permission=permission)
        if created:
            self.stdout.write(f"Created role {SYSTEM_ADMIN_ROLE_NAME!r}.")
        return role
