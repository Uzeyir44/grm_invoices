"""Shared fixtures for System Admin tests."""

from apps.authentication.models import Role, UserRole
from apps.authentication.tests.test_authentication import make_user
from apps.companies.models import Company

PASSWORD = "Str0ng-pass-123!"
SYSTEM_ADMIN_ROLE_NAME = "System Admin"


def make_platform_company(**overrides):
    values = {
        "legal_name": "GRM Platform",
        "display_name": "GRM Platform",
        "status": Company.Status.ACTIVE,
        "is_platform": True,
    }
    values.update(overrides)
    return Company.objects.create(**values)


def system_admin_role():
    return Role.objects.get(name=SYSTEM_ADMIN_ROLE_NAME, company__isnull=True, scope="system")


def make_system_admin(company=None, email="root@grm.example", password=PASSWORD, **extra):
    company = company or make_platform_company()
    user = make_user(company, email=email, password=password, **extra)
    UserRole.objects.create(user=user, role=system_admin_role())
    return user
