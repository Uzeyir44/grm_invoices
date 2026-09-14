# ADR: System Admin Architecture

## Status

Accepted

## Context

GRM Group CRM is a multi-tenant Django + DRF + PostgreSQL SaaS. It has exactly
one account model, `authentication.User`, which is company-scoped and
company-authenticated. There is currently **no concept of a platform/system
administrator**. The product will need a separate React Admin Panel for trusted
platform operators to manage companies, users, roles/permissions, reference
data, audit/security, backups, and limited settings.

Django `/admin/` is installed but unusable with the custom user (see Decision 8)
and is explicitly **not** the intended product administration interface.

This ADR fixes the architectural decisions required before Phase 1
(system-admin authentication + authorization boundary) is implemented. It does
not implement anything.

## Current Architecture

**Account model** (`apps/authentication/models.py`)
- `AUTH_USER_MODEL = "authentication.User"`.
- `User` extends `AbstractBaseUser` only — **no `PermissionsMixin`**, therefore
  no `is_staff`, `is_superuser`, `groups`, or `user_permissions`.
- `User.company` is a **NOT NULL** `FK → companies.Company` (`PROTECT`).
- `email` is unique **per company**:
  `uq_users_company_email_active (company, email) WHERE deleted_at IS NULL`.
- Soft delete via `deleted_at`; `is_active`; `mfa_enabled` /
  `mfa_secret_encrypted` (fields only — MFA is not implemented).

**Authentication** (`apps/authentication/backends.py`, `config/settings.py`)
- Only backend: `CompanyEmailBackend`, which requires
  `(company_id, email, password)`; email is unique per company, not globally.
- `active_user_rule(user)` requires: user active + not soft-deleted; company not
  soft-deleted; company status ∈ {`trial`, `active`}.
- SimpleJWT: `POST /api/authentication/token/` → `{access, refresh}`; tokens
  carry `user_id` + `company_id`; `CompanyJWTAuthentication` re-runs
  `active_user_rule` on **every** request; refresh/`/me/` exist.
- Django's stock `ModelBackend` is deliberately not used.

**RBAC** (`apps/authentication/models.py`, `rbac.py`)
- `Permission` — global catalog, unique `code`, no company column.
- `Role` — `company` nullable: `NULL` = global role template; set = company role.
- `RolePermission`, `UserRole` junctions; `uq_role_permissions_pair`,
  `uq_user_roles_pair`.
- `permission_codes_for` / `user_has_permission` resolve through roles that are
  **global OR the user's company**.
- DB trigger `trg_user_role_company_match` blocks a company role being assigned
  to a foreign-company user, but **permits global roles to be assigned to any
  user** and they then apply within that user's company.
- DRF: `IsCompanyMember` and `permission_required(code)` both require
  `active_user_rule` and resolve within `request.user.company`.

**Tenant isolation** (`apps/authentication/tenant.py`)
- `tenant_queryset` / `get_tenant_object_or_404` always scope by
  `request.user.company`; client-supplied `company_id` is never trusted.

**Audit** (`apps/audit_logs`)
- `AuditLog.company` **NOT NULL** (`PROTECT`), `user` nullable (`SET_NULL`),
  composite FK `(user_id, company_id) → users(id, company_id)`.
- `create_audit_log` requires `company` and enforces `user.company == company`.
- Append-only: DB trigger forbids UPDATE/DELETE.
- Read API is strictly company-scoped.

**Company** (`apps/companies/models.py`)
- `status` ∈ {trial, active, suspended, cancelled}; `deleted_at` soft delete;
  `uq_companies_voen_active`.
- `CompanySettings` and `CompanyBranding` are 1:1; `CompanyDocumentCounter` 1:1.

**Raw-SQL integrity** (`apps/database/migrations/0002_raw_sql_constraints.py`)
- Composite FKs, `company_id` immutability triggers, client subtype
  exclusivity, `user_roles` company-match trigger, INSERT-only triggers.

**Frontend** (`frontend/src`)
- Single `AuthContext` + `ProtectedRoute` + `AppShell`; `/login`; no `/admin`.

## Decision 1 — System Admin Identity

**Decision: Option A — a System Admin is an existing `authentication.User`**
that belongs to the reserved platform company (`GRM Platform`, see Decision 2).

Rationale:
- One identity model means one audit path, one JWT pipeline, and one account
  lifecycle, which matches the existing architecture.
- `User.company` is NOT NULL and is the target of composite FKs and audit
  joins; a separate principal table would force an audit redesign (Decision 7)
  and duplicate the entire auth stack.
- The distinction between a company user and a system admin is enforced at the
  **authorization boundary** (Decision 6), not by a second identity table.

`PermissionsMixin`, Django `ModelBackend`, `is_staff`, and `is_superuser` are
**not** introduced. Reasons:
- The project deliberately uses `AbstractBaseUser` only and a company-scoped
  backend; adding `PermissionsMixin` would introduce a second, parallel
  permission system (`auth_permission`/`auth_group`) that competes with the
  existing `Permission`/`Role` RBAC.
- `createsuperuser` fails only because `UserManager` has no `create_superuser`;
  adding it would make the command work while solving none of the real problems
  (platform permissions, tenant isolation, audit attribution). It is a
  workaround, not an architecture.
- `is_staff` is a Django-admin login gate, not a product authorization model;
  product authorization must live in `/api/admin/*`, not in the Django admin.

## Decision 2 — Platform Company

**Decision: Option A — one reserved internal company, `GRM Platform`**, owns
all System Admin users. `User.company` remains NOT NULL.

Rationale:
- Making `User.company` nullable (Option B) would break the composite-FK target
  `users(id, company_id)`, the `AuditLog` join, and every
  `tenant_queryset(..., request.user.company)` assumption, and would add many
  null-branches to the security-critical path.
- Option C (separate admin model) is deferred as the isolation-maximal fallback
  but not chosen (Decision 7 cost).

Conceptual model — the platform company is a **home for admin accounts, not a
tenant context**:

```text
Tenant Company
    ↓
Company Users
    ↓
CRM operations (tenant-isolated)

GRM Platform Company
    ↓
System Admin Users
    ↓
Platform operations (explicit cross-tenant boundary)
```

A System Admin belonging to the platform company is **never** treated as a
normal tenant user: the company APIs still scope to `request.user.company`, and
the platform company contains no tenant data. `/api/admin/*` authorization does
**not** use `request.user.company` (Decision 6). The platform company exists
purely so that the NOT NULL company FK, composite FKs, and audit joins remain
valid.

## Decision 3 — Platform Permission Segregation

Naming alone (`system.*`) is **rejected**: `Permission.code` is a plain string
and any role can be attached any permission, so a naming convention cannot
prevent privilege escalation.

**Decision: scoped RBAC — introduce a `Scope` (`tenant` | `system`) on both
`Permission` and `Role`, and enforce that a role may only hold permissions of
its own scope.** (Dimensions A and B applied together; neither alone is
sufficient — a permission scope without a role scope cannot classify the role,
and a role scope without a permission scope leaves the catalog undivided.)

```text
Permission { code, description, scope: tenant | system }
Role       { company, name, scope: tenant | system }
```

Enforcement (implemented in a later phase, not now):
- `RolePermission` may only pair a role with a permission of the same `scope`.
- A `system`-scoped role may only be assigned to a System Admin (platform
  company user); a `tenant` role is rejected if it contains any `system`
  permission.
- DB-level defense-in-depth via a trigger added through the raw-SQL migration
  mechanism already used by the project (`apps/database/migrations/`),
  consistent with `trg_user_role_company_match`; application/service validation
  is the primary guard.
- The permission catalog remains seeded by data migrations.

Resulting guarantees:

```text
Company User → Company Role / Global Tenant Role → tenant permissions only
System Admin → Reserved System Role (scope=system) → system permissions only
```

Option C (a fully separate permission catalog/model) is rejected because it
fragments `rbac.py` and the existing role/permission model for no additional
guarantee beyond scoping. Option D (naming only) is rejected as unsafe.

## Decision 4 — System Role

**Decision: one reserved global role named `System Admin` with
`company = NULL` and `scope = system`.**

- `company = NULL` is required because role uniqueness for global roles is
  `uq_roles_name_global`, and the role is platform-wide, not tenant-owned.
- `scope = system` is what separates it structurally from every tenant role.
- It **cannot** be assigned through normal company APIs. There are no
  role-assignment APIs today, and the future tenant-facing RBAC surface must
  refuse `scope = system` roles for non-platform users. Assignment is permitted
  only through privileged provisioning (management command / platform-admin
  user management in a later phase).
- The **first** System Admin is provisioned **out of band** by a management
  command (platform company + user + reserved role assignment + audit), never
  by a public endpoint.
- Company users can never receive this role: it is system-scoped, so the
  scoping invariant (Decision 3) rejects the pairing.

Multiple system roles (e.g., a read-only system auditor) may be added later;
they remain `scope = system`. Phase 1 defines only the single reserved role.

## Decision 5 — Admin Authentication Boundary

Company login stays exactly as-is:

```text
POST /api/authentication/token/   { company_id, email, password }  →  Company token
```

**Decision: a separate explicit platform authentication boundary:**

```text
POST /api/admin/authentication/token/           →  System Admin token
POST /api/admin/authentication/token/refresh/   →  System Admin refresh
GET  /api/admin/authentication/me/              →  admin identity + system permissions
```

- The admin token endpoint authenticates credentials **and requires the user to
  hold the reserved system role**; otherwise it fails with the standard generic
  auth error.
- Tokens use the same SimpleJWT infrastructure but carry an explicit platform
  marker claim (e.g. a `scope`/`principal` claim indicating `system_admin`), so
  a company token can never be mistaken for an admin token and vice versa.
- The admin boundary (Decision 6) **requires** the platform claim; the company
  boundary does not, and a company token is rejected by `/api/admin/*`.
- The company token endpoint does not grant platform access. A System Admin
  account existing in the platform company yields a token scoped to that empty
  platform company if used on the company endpoint; that token is still barred
  from `/api/admin/*`, preserving separation.
- Frontend stores company and admin tokens under **separate storage keys**
  (Decision 9).

Result:

```text
Company token      → company APIs (request.user.company scope)
System Admin token → /api/admin/* only (platform scope)
```

## Decision 6 — Authorization Boundary

**Decision: a dedicated `IsSystemAdmin` DRF permission class guards all
`/api/admin/*` endpoints.** It must:

- require an authenticated user,
- require the platform token claim (Decision 5),
- require the user to hold the reserved system role / a `scope = system`
  permission (Decision 3),
- **not** call `active_user_rule()`,
- **not** use `request.user.company` as the authorization basis.

Why not `active_user_rule()`: it couples authorization to company status
(`trial`/`active`). A System Admin must administer **suspended/cancelled**
companies, so gating admin access on any company's status is wrong, and the
platform company's own status must not be the gate.

Why not `request.user.company`: company APIs are tenant-scoped by that field;
platform APIs are intentionally cross-tenant. Reusing company membership as the
authorization basis would either force admins into a fake tenant context or
tempt an implementation to trust a client-supplied `company_id`. Neither is
acceptable.

```text
request
  ↓
authenticated User (platform token claim)
  ↓
IsSystemAdmin (reserved system role / system permission)
  ↓
/api/admin/*

Company APIs (unchanged):
request → authenticated User → IsCompanyMember → permission_required
        → request.user.company scope
```

## Decision 7 — Audit Attribution

`AuditLog.company` is NOT NULL and `create_audit_log` enforces
`user.company == company`.

**Decision: Option A — platform actions are attributed to the reserved
platform company (`actor_company`).** The affected company is recorded inside
the event payload (`target_company_id`) and the action/entity fields. The audit
schema is **not** changed in this phase.

Conceptual distinction, even though the schema does not yet have these exact
fields:

```text
actor_company  = GRM Platform   (the System Admin's company; satisfies the FK)
target_company = Company X      (the administered tenant; recorded in the event)
```

Example event: action `company.create`, entity_type `company`,
entity_id `X.id`, `new_values = { "target_company_id": X.id, ... }`,
`company = GRM Platform`.

Option B (nullable audit `company`) and Option C (separate platform audit
storage) are rejected as more invasive and as fragmenting the single append-only
audit trail. If a first-class `actor_company_id` / `target_company_id` pair is
ever justified, it is a later, separate migration; this ADR only fixes the
conceptual model so platform actions are never misrepresented as tenant actions.

## Decision 8 — Django Admin vs Product Admin

**Decision: Django `/admin/` remains developer/emergency/internal tooling only.
The React Admin Panel is the product System Admin interface.**

- Django Admin is session/staff based and cannot represent the company-scoped,
  JWT, RBAC, and audit model of this application. Using it as the product panel
  would create a second, weaker authorization surface.
- If Django Admin is ever made usable internally, it must be feature-flagged,
  network-restricted, and never exposed as the product admin.
- `createsuperuser` **currently fails** because `UserManager` defines
  `create_user` but no `create_superuser` (and `User` has no
  `is_staff`/`is_superuser`). This is documented here but deliberately **not
  fixed** in this task.

## Decision 9 — Frontend Architecture

**Decision: a separate admin frontend surface, without touching company auth:**

```text
Company CRM                         System Admin
  AuthContext                         AdminAuthContext
  ProtectedRoute                      AdminRoute
  AppShell                            AdminShell
  /… company routes                   /admin/* routes
```

- **Separate token storage keys** for the admin token are required, so a company
  token and an admin token can never be confused.
- A **separate admin API client** (or a scoped instance of the existing
  `apiClient`) pointing at `/api/admin/` and sending the admin token is
  appropriate.
- **Company authentication stays untouched.** The existing `AuthContext`,
  `ProtectedRoute`, `apiClient` refresh logic, and `/login` are unchanged.
- **`/admin/login` is separate** from `/login`.
- **`/admin/*` is inaccessible to company principals**: `AdminRoute` requires
  admin authentication (admin `/me`), and the backend rejects any non-platform
  token regardless of frontend behavior.

Proposed routes (documented only, not created): `/admin`,
`/admin/login`, `/admin/dashboard`, `/admin/companies`, `/admin/users`,
`/admin/roles`, `/admin/permissions`, `/admin/reference-data`,
`/admin/audit`, `/admin/backups`, `/admin/settings`.

## Security Invariants

Non-negotiable:

1. A normal company user cannot obtain a System Admin token.
2. A normal company user cannot access `/api/admin/*`.
3. A company role cannot grant system permissions.
4. A company administrator cannot assign a system role.
5. System Admin authorization does not depend on the target company's status
   (a suspended company remains administrable).
6. Company APIs continue using existing tenant isolation.
7. System Admin APIs use an explicit cross-tenant authorization boundary.
8. Platform actions remain auditable.
9. Backups are never accessible to company users.
10. No client-supplied `company_id` can elevate privileges.

## Implementation Roadmap

- **Phase 0 (this ADR):** decisions fixed; no code.
- **Phase 1:** platform identity + authorization boundary (see below).
- **Phase 2:** admin API authorization + platform audit wiring.
- **Phase 3:** admin frontend shell (`AdminAuthContext`/`AdminRoute`/`AdminShell`).
- **Phase 4:** company provisioning (transactional).
- **Phase 5:** user management.
- **Phase 6:** roles & permissions management (scope-guarded).
- **Phase 7:** reference-data writes.
- **Phase 8:** system-wide audit & security events.
- **Phase 9:** backups.
- **Phase 10:** production hardening (admin MFA, IP allowlist, stricter
  throttles, secret management, `/admin/` policy).

## Phase 1 Boundary

Smallest safe first implementation, proving the boundary before powerful
capabilities:

1. Seed system permission codes (e.g. `system.companies.manage`,
   `system.users.manage`, `system.roles.manage`, `system.reference.manage`,
   `system.audit.read`, `system.backups.manage`, `system.settings.manage`) via a
   data migration.
2. Provision the reserved `GRM Platform` company.
3. Provision the first System Admin out of band (management command).
4. Reserved `System Admin` role (`company = NULL`, `scope = system`).
5. `IsSystemAdmin` authorization boundary.
6. Read-only `GET /api/admin/authentication/me/`.
7. Exhaustive boundary tests.

Phase 1 must **not** include: company CRUD, user management, role management,
reference-data writes, audit administration, backups, settings, or any frontend
Admin Panel.

## Rejected Alternatives

- **Django `is_staff`/`is_superuser` + `PermissionsMixin` + `ModelBackend`.**
  Introduces a second permission system, contradicts the deliberate
  `AbstractBaseUser`/company-scoped design, and `create_superuser` only makes
  the CLI work.
- **Nullable `User.company`.** Breaks composite-FK targets, audit joins, and
  tenant-scoping assumptions.
- **Separate `SystemAdmin` model.** Strong isolation, but duplicates the auth
  stack and forces an audit redesign; retained as fallback only.
- **Naming convention alone (`system.*`).** Cannot prevent privilege
  escalation; unsafe.
- **Django Admin as the product panel.** Wrong authorization model; separate,
  weaker surface.
- **Nullable audit `company` / separate platform audit store.** More invasive;
  fragments the append-only audit trail.

## Consequences

Positive:
- Tenant isolation path is untouched; platform access is a single, testable
  boundary.
- Reuses JWT, RBAC, and audit; minimal schema surface (scope fields + seeds).
- Clear separation of company token vs system-admin token.

Negative / costs:
- `Permission.scope` and `Role.scope` are additive model changes requiring
  migrations and enforcement (trigger + service validation).
- A platform company and its identification must be provisioned and protected.
- Platform actions are attributed to the platform company and must record the
  target company explicitly in payloads.

## Open Questions

These are implementation details, not architectural blockers (the five required
questions are decided above):

- The exact identification mechanism for the reserved platform company (a
  reserved constant validated by tests vs an additive `Company.is_platform`
  flag) — to be settled at Phase 1.
- Whether a future phase adds explicit `actor_company_id` / `target_company_id`
  columns to `AuditLog` (Decision 7 leaves this open by design).
- Whether System Admin accounts should be blocked from the company login
  endpoint entirely, or merely denied `/api/admin/*` when using a company token.
- Exact backup tooling, retention, and storage (no infra exists today).
- Whether admin MFA is mandatory from Phase 1 or Phase 10.
