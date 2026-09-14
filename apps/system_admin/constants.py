"""
Phase 1 constants for the System Admin foundation.

These values are the single source of truth shared by the provisioning command,
the authentication boundary, and the tests. They are intentionally explicit:
the platform boundary must never be inferred from a permission *name*.
"""

# Explicit platform marker carried by System Admin tokens. A company token can
# never carry this claim, and the admin boundary requires it.
SYSTEM_ADMIN_SCOPE = "system_admin"
SYSTEM_ADMIN_SCOPE_CLAIM = "scope"

# Reserved platform company. It is the account home for System Admins, not a
# tenant context.
PLATFORM_COMPANY_LEGAL_NAME = "GRM Platform"
PLATFORM_COMPANY_DISPLAY_NAME = "GRM Platform"

# Reserved global, system-scoped role.
SYSTEM_ADMIN_ROLE_NAME = "System Admin"

# Company-scoped role created for each newly provisioned tenant to grant its
# initial administrator the tenant permission catalog.
TENANT_ADMIN_ROLE_NAME = "Administrator"

# Initial system permission catalog (seeded by migration
# authentication.0009_seed_system_permissions). Kept in sync with that
# migration; the migration is the source of truth for the database rows.
SYSTEM_PERMISSIONS = (
    ("system.companies.manage", "Manage companies"),
    ("system.users.manage", "Manage users across companies"),
    ("system.roles.manage", "Manage roles and permissions"),
    ("system.reference.manage", "Manage reference data"),
    ("system.audit.read", "Read system-wide audit logs"),
    ("system.backups.manage", "Manage backups"),
    ("system.settings.manage", "Manage platform settings"),
)

SYSTEM_PERMISSION_CODES = tuple(code for code, _ in SYSTEM_PERMISSIONS)
