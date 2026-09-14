"""Service helpers for the reserved platform company."""

from apps.companies.models import Company


class PlatformConfigurationError(Exception):
    """The reserved platform company is missing, soft-deleted, or ambiguous."""


def get_platform_company():
    """
    Return the single reserved platform company, or raise.

    The platform company is identified by the additive ``Company.is_platform``
    marker (not by name), so provisioning and authorization never depend on a
    mutable display string.
    """
    queryset = Company.objects.filter(is_platform=True, deleted_at__isnull=True)
    count = queryset.count()
    if count == 0:
        raise PlatformConfigurationError(
            "The reserved platform company has not been provisioned. Run "
            "'python manage.py provision_system_admin' first."
        )
    if count > 1:
        raise PlatformConfigurationError(
            "Multiple platform companies exist; exactly one is expected."
        )
    return queryset.get()
