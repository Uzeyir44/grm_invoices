# GRM CRM

A multi-tenant SaaS CRM and document-generation platform built with Python,
Django, and PostgreSQL.

The document below describes the **database architecture** as currently
modeled in Django. Only implemented/models covered here; anything still in
design is listed under [Future modules](#future-modules).

## Project structure

```text
.
├── manage.py          # Django management entry point
├── config/            # Project configuration (Django project package)
│   ├── settings.py
│   ├── urls.py
│   ├── asgi.py
│   └── wsgi.py
├── apps/              # Business applications
│   ├── companies/       # SaaS tenants, tenant settings and branding
│   ├── authentication/  # Users, roles, permissions (own RBAC)
│   ├── reference_data/  # Shared/global lookup and reference tables
│   └── clients/         # Client management
├── requirements/
│   └── base.txt
├── .env               # Local environment variables (gitignored)
├── .env.example       # Template for environment variables
└── README.md
```

## Setup

1. Create and activate a virtual environment:

   ```bash
   python -m venv .venv
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements/base.txt
   ```

3. Configure environment:

   ```bash
   cp .env.example .env   # then edit values as needed
   ```

4. Run checks:

   ```bash
   python manage.py check
   ```

## Requirements

- Python 3.13+
- PostgreSQL (create the database referenced by `DB_NAME` in `.env`)

---

# Database architecture

## Multi-tenancy architecture

The fundamental rule is:

```text
One Company = One Tenant
```

Tenant-owned data must be isolated by `company_id`.

Any table that belongs to a tenant carries a `company_id` foreign key that
points back to `Company`. This is the foundation of tenant isolation and is a
prerequisite for the planned PostgreSQL Row-Level Security (RLS), which will
eventually provide database-level tenant isolation in addition to
application-level filtering.

Some tables intentionally do **not** have `company_id`. These are shared,
global reference tables that are not owned by any tenant.

Tenant-owned tables:

```text
Company
User
Role (when company-specific)
Client
ClientAddress
ClientContact
ClientBankAccount
```

Shared/global tables:

```text
Currency
VatRate
ExchangeRate
AddressType
DocumentType
Bank
Permission
```

For `Role`, the presence (or absence) of `company_id` encodes its scope:

```text
company_id = NULL    → global/system role
company_id = value   → company-specific role
```

## 1. Companies

App:

```text
apps/companies/
```

Models: `Company`, `CompanySettings`, `CompanyBranding`.

- **`Company`** represents a SaaS tenant. Every tenant-owned entity will
  ultimately belong to a company.
- **`CompanySettings`** is a strict 1-to-1 extension (`OneToOneField`,
  `company_id` as primary key) containing tenant configuration such as the
  document numbering format.
- **`CompanyBranding`** is a strict 1-to-1 extension (`OneToOneField`,
  `company_id` as primary key) containing branding (logo storage path and
  colors) used by the CRM UI and generated documents.
- Companies use **soft deletion/deactivation** rather than normal physical
  deletion: `Company` has a `status` field (trial / active / suspended /
  cancelled) and a `deleted_at` timestamp.
- Company ownership is the foundation of tenant isolation.

## 2. Authentication and Authorization

App:

```text
apps/authentication/
```

Models: `User`, `Role`, `Permission`, `UserRole`, `RolePermission`.

```text
Company
   │
   └── Users
        │
        └── UserRole
              │
              └── Role
                    │
                    └── RolePermission
                          │
                          └── Permission
```

- Every user belongs to exactly one company. A company can have many users.
- User email is **unique per company, not globally** (unique constraint on
  `(company, email)` for non-deleted users). Authentication will therefore
  require company-aware authentication in the future: the company must be
  resolved first (subdomain, company picker, etc.) and the user looked up by
  the `(company, email)` pair.
- `User` uses Django `AbstractBaseUser`.
- Django's default `PermissionsMixin` is intentionally **not** used because
  the CRM has its own RBAC system based on `Role` / `Permission`.
- A user can have multiple roles (`UserRole` as the user↔role junction).
- A role can belong to many users.
- A role can contain multiple permissions (`RolePermission` as the role↔
  permission junction).
- A permission can belong to multiple roles.
- Roles with `company = NULL` represent **global/system roles**; company-
  specific roles have a `company` reference.
- `UserRole` and `RolePermission` use **surrogate primary keys** (an implicit
  `BigAutoField` row `id`) with unique constraints on their respective
  `(user, role)` and `(role, permission)` pairs.
- Cross-company role assignment ("a user may only be assigned a role whose
  `company` is NULL or matches the user's own company") is **not** yet
  enforced. It requires a PostgreSQL database-level trigger (BEFORE
  INSERT/UPDATE comparing two rows), which Django cannot express natively.
- Both `User` and `Role` use `on_delete=PROTECT` on `Company`, so company
  deletion is protected.

Note: `Permission` is a fixed, application-defined catalog of grantable
actions (e.g. `clients.delete`) and deliberately has no `company` column.

## 3. Reference Data

App:

```text
apps/reference_data/
```

Models: `Currency`, `VatRate`, `ExchangeRate`, `AddressType`, `DocumentType`,
`Bank`.

These are shared/global reference data and intentionally do **not** contain a
`company_id`.

### Currency

- Uses ISO 4217 currency codes (`code`, e.g. AZN, USD).
- Uses `SmallAutoField` as the primary key.
- Stores a name and the minor unit (decimal places).

### VatRate

- Stores reusable VAT rate definitions.
- Uses validity periods.
- Overlapping periods for the same VAT rate `name` are prevented using a
  PostgreSQL `ExclusionConstraint` that checks for overlapping `daterange`
  intervals.
- Uses a half-open date range `[valid_from, valid_to)`: `valid_to` is the
  first date the rate no longer applies.
- `NULL valid_to` represents an ongoing/current rate (handled via
  `COALESCE(valid_to, 'infinity')` in the range).
- The PostgreSQL `btree_gist` extension must be enabled in the Django
  migration (`BtreeGistExtension` operation) **before** creating the exclusion
  constraint; it cannot be expressed in `models.py` alone.

### ExchangeRate

- Shared/global rather than company-specific: no `company_id`.
- Stores a currency pair (`from_currency`, `to_currency`), the `rate`, and the
  `effective_at` time.
- Has an index optimized for `(from_currency, to_currency, effective_at)`.
- The rate actually used when generating a document will later be captured in
  the document generation snapshot/version; this table only reflects
  current/historical market rates.

### AddressType

- Shared lookup table for address classifications (legal / business /
  residential, …).
- Uses `SmallAutoField` as the primary key.

### DocumentType

- Shared lookup table for document classifications such as consulting
  contracts, purchase-sale contracts, invoices, and handover certificates.
- Uses `SmallAutoField` as the primary key.
- Referenced by both templates and generated documents so new document types
  don't require a schema change.

### Bank

- Shared, maintained bank directory.
- Used instead of free-text bank names on client bank accounts to avoid the
  same bank being entered as different string variants.
- Stores bank name, SWIFT/BIC where available (`swift_code`), and active
  status (`is_active`).

## 4. Client Management

App:

```text
apps/clients/
```

Models: `Client`, `ClientLegalEntity`, `ClientIndividual`, `ClientAddress`,
`ClientContact`, `ClientBankAccount`.

```text
Company
   │
   └── Client
        │
        ├── ClientLegalEntity
        │
        ├── ClientIndividual
        │
        ├── ClientAddress
        │
        ├── ClientContact
        │
        └── ClientBankAccount
```

- Every client belongs to exactly one company.
- A client is either a **legal entity** or an **individual**, indicated by the
  `client_type` field on `Client`.
- Legal entities and individuals use **separate subtype tables**
  (`ClientLegalEntity`, `ClientIndividual`) with a 1-to-1 link to `Client`,
  rather than one wide table with nullable columns. This maintains
  normalization.
- `ClientLegalEntity` stores legal-company information such as legal name,
  trading name, VOEN, registration number, and registration date.
- `ClientIndividual` stores personal information such as first name, last
  name, middle name, date of birth, and identification information.
- Individual identification numbers are **not stored as plaintext**: an
  application-encrypted value is stored separately from a keyed HMAC hash used
  for exact-match lookup.
- VOEN uniqueness is enforced within a company for legal entities
  (unique constraint on `(company, voen)`).
- A client can have multiple addresses (`ClientAddress`).
- A client can have multiple contacts (`ClientContact`).
- A client can have multiple bank accounts (`ClientBankAccount`).
- Only **one primary address** is allowed per client (partial unique
  constraint on `is_primary = True`).
- Only **one primary contact** is allowed per client (partial unique
  constraint on `is_primary = True`).
- Only **one default bank account** is allowed per client (partial unique
  constraint on `is_default = True`).
- Bank accounts reference the shared `Bank` and `Currency` tables.
- Client-related tables contain `company_id` where required for
  tenant/RLS purposes.
- Some tenant-integrity constraints require **PostgreSQL composite foreign
  keys and triggers** because Django cannot express composite foreign keys
  natively. In particular: a `UNIQUE(id, company_id)` target on `Client` (to
  support composite FKs from the subtype tables) and subtype-exclusivity
  triggers (a client of type `legal_entity` must reference a
  `ClientLegalEntity`, etc.), plus immutability of the copied `company` column
  in the subtype tables. These are planned as raw-SQL migration additions once
  all client tables exist.

## Future modules

The following modules are **designed but not yet implemented** in Django at
this point:

- Document templates
- Template versions/history
- Company document counters
- Generated documents
- Generated document versions
- Document line items
- Generation snapshots
- Audit logging
- PostgreSQL RLS policies
- PostgreSQL triggers for database-level integrity rules

These are planned/future work and must not be treated as implemented.

### Implemented/modelled now

```text
companies / Company, CompanySettings, CompanyBranding
authentication / User, Role, Permission, UserRole, RolePermission
reference_data / Currency, VatRate, ExchangeRate, AddressType, DocumentType, Bank
clients / Client, ClientLegalEntity, ClientIndividual, ClientAddress, ClientContact, ClientBankAccount
```

### Planned/future

```text
document templates, template versions/history, company document counters
generated documents, generated document versions, document line items
generation snapshots, audit logging
PostgreSQL RLS policies, PostgreSQL triggers for database-level integrity rules
```

## Architecture Rules

1. **PostgreSQL is the database.**
2. Django models are the primary schema representation.
3. Django migrations are used for schema changes.
4. PostgreSQL-specific functionality that the Django ORM cannot express should
   be implemented through Django migrations using raw SQL or PostgreSQL
   migration operations.
5. Tenant isolation is a core architectural requirement.
6. Do not silently introduce schema changes that contradict the approved
   architecture.
7. Any genuine schema change must be treated as an explicit architecture
   amendment.