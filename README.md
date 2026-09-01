# GRM CRM

A multi-tenant SaaS CRM and document-generation platform built with Python,
Django, and PostgreSQL.

The document below describes the **database architecture** as currently
modeled in Django, plus the **API layer** built on top of it. Only
implemented features are covered here; anything still in design is listed
under [Future modules](#future-modules).

## Project structure

```text
.
├── manage.py          # Django management entry point
├── config/            # Project configuration (Django project package)
│   ├── settings.py
│   ├── urls.py         # Main URLconf; mounts /admin/ and /api/
│   ├── api_urls.py     # Top-level API router (health + feature routers)
│   ├── asgi.py
│   └── wsgi.py
├── apps/              # Business applications
│   ├── companies/       # SaaS tenants, tenant settings and branding
│   ├── authentication/  # Users, roles, permissions (own RBAC)
│   │   ├── backends.py  # CompanyEmailBackend + active_user_rule
│   │   ├── rbac.py      # Permission resolution (global vs company roles)
│   │   ├── tenant.py    # Tenant-scoping helpers (isolation rules)
│   │   ├── tests/       # Health, auth, authorization test suites
│   │   └── api/         # Feature API: urls, views, serializers, permissions, authentication
│   ├── reference_data/  # Shared/global lookup and reference tables
│   ├── clients/         # Client management
│   │   ├── api/         # Client API: serializers, views, urls
│   │   └── tests/       # Client API test suite
│   ├── document_templates/  # Document templates and their versions
│   │   ├── api/         # Document Template API: serializers, views, urls
│   │   └── tests/       # Document Template API test suite
│   ├── company_document_counters/  # Per-company document numbering counters
│   ├── generated_documents/  # Generated documents, versions, and line items
│   └── audit_logs/  # Append-only audit trail
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

## API layer

A JSON API built on Django REST Framework (DRF). The foundation and the
company-aware JWT authentication system are implemented, along with the
Client Management and Document Template Management feature APIs. Further
business endpoints (documents, …) are intentionally **not** built yet.

### Per-feature structure

Every feature keeps its API code in an `api/` subpackage inside its own app:

```text
apps/authentication/
├── ...
├── backends.py       # Company-aware auth backend + active_user_rule
├── tests/            # Health + authentication tests
└── api/
    ├── authentication.py  # CompanyJWTAuthentication (DRF auth class)
    ├── serializers.py
    ├── views.py
    └── urls.py
```

Each implemented feature (`apps/clients`, `apps/document_templates`, …)
follows the same pattern and is mounted under `/api/<feature>/`.

### URL scheme

```text
/api/health/                      → liveness probe, returns {"status": "ok"}
/api/authentication/token/        → POST login: issue JWT access + refresh pair
/api/authentication/token/refresh/  → POST: rotate the access token
/api/authentication/token/verify/   → POST: validate a token
/api/authentication/me/           → GET current user + company (JWT required)
/api/clients/                     → client management (see below)
/api/document-templates/          → document template management (see below)
/api/documents/                   → planned
```

The top-level router lives in `config/api_urls.py` and is mounted from
`config/urls.py` under `/api/`.

### Health endpoint

`GET /api/health/` returns `{"status": "ok"}` as JSON. It is deliberately not
connected to authentication or business logic — it exists only to verify that
Django is running, DRF is installed, URL routing works, and JSON responses
work. Covered by an automated test in `apps/authentication/tests/`.

### DRF configuration

Configured in `config/settings.py` under `REST_FRAMEWORK`:

```text
DEFAULT_RENDERER_CLASSES        = [rest_framework.renderers.JSONRenderer]
DEFAULT_PARSER_CLASSES          = [rest_framework.parsers.JSONParser]
DEFAULT_AUTHENTICATION_CLASSES  = [CompanyJWTAuthentication]
DEFAULT_PERMISSION_CLASSES      = [rest_framework.permissions.IsAuthenticated]
```

JSON-only renderer/parser (no browsable API). New API views require an
authenticated user by default (fail-closed); public endpoints
(`/api/health/` and the JWT token endpoints) opt out explicitly.

## Authentication & JWT

Production-oriented, company-aware authentication built on
`djangorestframework-simplejwt`. It uses the project's own
`authentication.User` (wired via `AUTH_USER_MODEL`); Django's stock
`ModelBackend` is deliberately **never** used.

### Company-aware login

```text
POST /api/authentication/token/   {"company_id": 1, "email": "...", "password": "..."}
```

`email` is unique per company, not globally, so the login request carries a
`company_id` to disambiguate which tenant the credentials belong to. The
company identifier is a **lookup key only**: it is used to resolve the user
row during authentication and is never trusted again. After authentication,
every authorization derives from `request.user` (and its owning company),
never from a client-supplied company ID.

All authentication failures — wrong password, unknown user, unknown company,
inactive user, suspended/cancelled company — return the same generic 401, so
credentials cannot be enumerated. Users of `trial` and `active` companies may
log in; `suspended`/`cancelled` companies and deactivated or soft-deleted
users are rejected. Passwords are stored via Django's password hashing
(PBKDF2) and never appear in any response.

### JWT claims

Access/refresh tokens carry only `user_id` and `company_id`, plus the standard
`iat`/`exp`/`jti`/`token_type` claims. No passwords, hashes, MFA secrets, or
other sensitive data is placed in a token. Access tokens live 15 minutes;
refresh tokens 1 day. The signing key is read from `JWT_SIGNING_KEY`,
falling back to `DJANGO_SECRET_KEY`, so secrets stay in `.env`.

### Access revocation

A custom `CompanyJWTAuthentication` re-validates, on **every** authenticated
request, that the token's user is still active and still belongs to an
authenticatable company. Deactivating a user or suspending a company
immediately revokes access, even for already-issued tokens. The same rule
(`active_user_rule` in `apps/authentication/backends.py`) also gates login and
token refresh.

### Endpoints summary

```text
POST /api/authentication/token/          issue access + refresh pair   (public)
POST /api/authentication/token/refresh/  rotate the access token       (public)
POST /api/authentication/token/verify/   validate a token              (public)
GET  /api/authentication/me/             current user + company        (JWT required)
```

### Request & response reference

#### POST `/api/authentication/token/`

Login with credentials scoped to a company.

Request body:

```json
{
    "company_id": 1,
    "email": "user@example.com",
    "password": "your-password"
}
```

Response `200 OK`:

```json
{
    "refresh": "<jwt-refresh-token>",
    "access": "<jwt-access-token>"
}
```

Response `401` — every authentication failure (wrong password, unknown user,
unknown company, inactive user, suspended/cancelled company) returns this
identical body so accounts cannot be enumerated:

```json
{
    "detail": "No active account found with the given credentials"
}
```

Response `400` — missing or invalid fields (e.g. `company_id` omitted):

```json
{
    "company_id": ["This field is required."]
}
```

#### POST `/api/authentication/token/refresh/`

Rotate a refresh token into a fresh access token.

Request body:

```json
{
    "refresh": "<jwt-refresh-token>"
}
```

Response `200 OK`:

```json
{
    "access": "<new-jwt-access-token>"
}
```

Response `401` — invalid or expired refresh token:

```json
{
    "detail": "Token is invalid or expired",
    "code": "token_not_valid"
}
```

#### POST `/api/authentication/token/verify/`

Whether a token is cryptographically valid (access or refresh; only checks
the token itself, not the account's current state).

Request body:

```json
{
    "token": "<jwt-access-or-refresh-token>"
}
```

Response `200 OK`:

```json
{}
```

Response `401` — invalid or expired token (same shape as refresh above).

#### GET `/api/authentication/me/`

The authenticated user and their company. Requires the header
`Authorization: Bearer <access-token>`.

Response `200 OK`:

```json
{
    "id": 1,
    "email": "user@example.com",
    "first_name": "Dev",
    "last_name": "User",
    "is_active": true,
    "mfa_enabled": false,
    "company_id": 1,
    "company_name": "Dev Co"
}
```

Response `401` — no token: `{"detail": "Authentication credentials were not
provided."}`; invalid/expired token: 401 `token_not_valid` (password/hash is
never part of any response).

### Development users

No users are seeded by migrations; `apps/authentication/tests/` creates its
own fixtures per test. For manual testing against the local PostgreSQL
database one development account was created once:

```text
company_id: 1   display: "Dev Co"   (status: active)
email:      dev@example.com
password:   Dev-pass-123!
```

This is local development data only — it lives in your database, not in the
codebase. To re-create it (e.g. after a database reset), run:

```bash
python manage.py shell <<'PY'
from apps.companies.models import Company
from apps.authentication.models import User

company, _ = Company.objects.get_or_create(
    legal_name="Dev Company",
    display_name="Dev Co",
    defaults={"status": Company.Status.ACTIVE},
)
user, created = User.objects.get_or_create(
    company=company,
    email="dev@example.com",
    defaults={"first_name": "Dev", "last_name": "User"},
)
if created:
    user.set_password("Dev-pass-123!")
    user.save(update_fields=["password"])
print(f"company_id={company.id} user_id={user.id} created={created}")
PY
```

### Tests

Authentication behaviour — login success/failure, tenant isolation, token
expiry and revocation, password security, and `/me/` — is covered in
`apps/authentication/tests/` and runs with `python manage.py test`.

---

## Tenant isolation & authorization

A reusable authorization foundation that every future feature API
(clients, templates, documents, …) uses to enforce the core rule:

> **An authenticated user can only access data belonging to their own
> company.**

### The rules

```text
Rule A  Never trust frontend company IDs for authorization.
Rule B  request.user.company is the authoritative tenant context
        (JWT → authenticated User → User.company).
Rule C  Querysets are tenant-scoped: Model.objects.filter(company_id=...).
Rule D  Single-object access is tenant-scoped too — a cross-tenant object
        is indistinguishable from a missing one (HTTP 404).
Rule E  Nested relationships must reach the tenant boundary through their
        parent chain; a company cannot be crossed by guessing child IDs.
```

The authenticated user's company is the source of truth, so the frontend
never needs to tell the API which company it belongs to. A request like
`{"company_id": 999}` can never move data into (or out of) another tenant.

### Reusable pieces

- `apps/authentication/tenant.py` — tenant-scoping helpers:
  - `tenant_queryset(Model, company)` → queryset restricted to the company
    (Rule C)
  - `get_tenant_object_or_404(Model, company, pk=...)` → fetches an object
    that MUST belong to the company; raises `404` for cross-tenant or missing
    objects, so another company's existence is never revealed (Rule D, IDOR)
  - `belongs_to_company(company, obj)` → object-level company check
- `apps/authentication/api/permissions.py` — reusable DRF permission classes:
  - `IsCompanyMember` — authenticated user of an active/trial company
  - `permission_required("clients.read")` — RBAC permission factory
  - `IsSameCompanyObject` — object-level ownership check (object-level
    fallback; preferred pattern is queryset scoping)
- `apps/authentication/rbac.py` — RBAC resolution:
  - `user_has_permission(user, code)`, `permission_codes_for(user)`
  - resolves permissions through the user's assigned roles, respecting role
    scope: global roles apply everywhere, company-specific roles apply only
    within that company (a `trg_user_role_company_match` DB trigger already
    blocks cross-company role assignment as a second line of defense)

### Intended usage in feature views

```python
class ClientView(APIView):
    permission_classes = [IsCompanyMember, permission_required("clients.read")]

    def list(self, request):
        # Rule C — queryset scoped to the tenant.
        return Response(tenant_queryset(Client, request.user.company))

    def get_object(self, pk):
        # Rule D — 404 if the object is not in the caller's tenant.
        return get_tenant_object_or_404(Client, request.user.company, pk=pk)

    def create(self, request):
        # Company is derived from the authenticated user, never from body data.
        client = Client.objects.create(company=request.user.company, ...)
```

Cross-company reads, updates and deletes all resolve to `404` regardless of
HTTP method, client-supplied `company_id`, or guessed object IDs. Creation
always binds the object to `request.user.company`.

### Tests

`apps/authentication/tests/test_authorization.py` covers the foundation:
queryset/object helper behaviour, read/create/update/delete isolation,
client-supplied `company_id` being ignored, cross-company `404`s
indistinguishable from missing objects, the RBAC permission factory, global
vs company-scoped roles, cross-company role assignment being blocked, and the
`IsCompanyMember` / `IsSameCompanyObject` permission classes. The small
client views used there are **test-only fixtures** — a full Client API is a
later step.

---

## Client Management API

The first feature API built on the authentication and tenant-isolation
foundations. All endpoints are JSON-only, JWT-protected, and tenant-scoped to
`request.user.company`.

### Endpoints

```text
GET    /api/clients/                              list clients (tenant-scoped)
POST   /api/clients/                              create client (+subtype)
GET    /api/clients/<id>/                         retrieve client + subtype + nested
PATCH  /api/clients/<id>/                         update client / subtype
DELETE /api/clients/<id>/                         soft-delete client

GET    /api/clients/<id>/addresses/               list / create addresses
GET    /api/clients/<id>/addresses/<aid>/         get / patch / delete address
GET    /api/clients/<id>/contacts/                list / create contacts
GET    /api/clients/<id>/contacts/<cid>/          get / patch / delete contact
GET    /api/clients/<id>/bank-accounts/           list / create bank accounts
GET    /api/clients/<id>/bank-accounts/<bid>/     get / patch / delete bank account
```

- `GET /api/clients/` supports `client_type`, `status`, and `search`
  (subtype legal name / individual first+last name) query parameters.
- Database status codes follow DRF conventions: 200 / 201 / 204 / 400 /
  401 / 403 / 404.

### Permissions

Seeded (data migration `authentication.0002`) permission codes:

```text
clients.read    clients.create    clients.update    clients.delete
```

Views require `IsCompanyMember` plus the code matching the HTTP method
(`permission_required(...)` from the Step-2 foundation); nested-record writes
require `clients.update`. Codes are granted to users through `Role` /
`UserRole` as usual.

### Subtype validation

`client_type` decides which subtype the payload may/must carry:

```text
client_type = individual    →  individual required, legal_entity forbidden
client_type = legal_entity  →  legal_entity required, individual forbidden
```

`client_type` is immutable after creation (matches the DB type-change guard).
VOEN is unique within a company (cross-company VOEN reuse is allowed; tested).

### Deletion

`DELETE` **soft-deletes** by setting `deleted_at` — the row and its subtype /
nested history are preserved. Soft-deleted clients disappear from the normal
list and resolve to 404 on detail / nested operations.

### Tenant isolation

Every lookup goes through the Step-2 helpers:

```python
tenant_queryset(Client, request.user.company)          # Rule C (listing)
get_tenant_object_or_404(Client, request.user.company, # Rule D (single)
                         pk=pk, deleted_at__isnull=True)
```

Creation binds the client to `request.user.company` (a body `company_id` is
ignored). Nested children are doubly scoped: they must belong to the caller's
company **and** to the parent client, otherwise 404. This blocks IDOR attempts
such as a Company-A user reaching a Company-B client or one of its children
by guessing IDs.

### Tests

`apps/clients/tests/test_api.py` (43 tests): access/RBAC matrix across the
four permission codes, tenant isolation (read/update/delete cross-company →
404), creation ownership and `company_id`-ignored, individual & legal-entity
subtypes, nested address/contact/bank-account CRUD + cross-company isolation,
soft-deletion behaviour, and validation (client type, VOEN, primary address /
default bank account, IBAN).

---

## Document Template Management API

The second feature API built on the authentication and tenant-isolation
foundations. It manages a company's document templates (`DocumentTemplate`):
their **metadata** (Step 1), their **`.docx` file** (Step 2), and their
controlled **template variables** and immutable **version history** (Step 3).
Actual placeholder *replacement*, DOCX generation and PDF generation are later
steps and are deliberately not implemented here. All endpoints are
JWT-protected and tenant-scoped to `request.user.company`.

### Endpoints

```text
GET    /api/document-templates/                        list templates (tenant-scoped)
POST   /api/document-templates/                        create a template
GET    /api/document-templates/<id>/                   retrieve a template
PATCH  /api/document-templates/<id>/                   update metadata / activate or deactivate
DELETE /api/document-templates/<id>/                   soft-delete a template
GET    /api/document-templates/<id>/file/              download the template's .docx file
POST   /api/document-templates/<id>/file/              upload / replace the .docx file
DELETE /api/document-templates/<id>/file/              remove the template's file (not the template)
GET    /api/document-templates/<id>/versions/          list the template's versions
POST   /api/document-templates/<id>/versions/          create a new immutable version snapshot
GET    /api/document-templates/<id>/versions/<vid>/    retrieve a specific version
POST   /api/document-templates/<id>/versions/<vid>/activate/   activate a version
```

- `GET /api/document-templates/` supports a `document_type` query parameter to
  filter by the shared `DocumentType` reference.
- A template is created from the metadata fields only:
  `document_type` (the shared lookup id), `name`, and optionally `is_active`
  (defaults to `true`).
- Status codes follow DRF conventions: 201 on create/upload, 204 on delete,
  400 / 401 / 403 / 404 as appropriate.

### File upload & replacement

`POST /api/document-templates/<id>/file/` accepts `multipart/form-data` with a
single `file` part. Uploading to a template that already has a file **replaces**
the template's **current/working** file. Immutable history is captured by
creating a version snapshot from this file (see Versioning below). The
`document_templates.update` permission is required.

File validation (in `DocumentTemplateFileSerializer`):

```text
- a file part is required
- only .docx is accepted (extension checked)
- the size must not exceed MAX_TEMPLATE_FILE_SIZE (default 5 MB; overridable
  via the MAX_TEMPLATE_FILE_SIZE env var)
- the upload must be a real OOXML/Word package: it must be a valid ZIP archive
  exposing the standard members ([Content_Types].xml, word/document.xml, ...)
```

The extension/format check is deliberately lightweight — it does **not** parse
placeholders or build a full DOCX parser (placeholder validation happens when a
version is created).

### File retrieval

`GET /api/document-templates/<id>/file/` streams the stored bytes back as an
attachment (`Content-Disposition: attachment`). The template's storage path is
never exposed to clients; the API returns the file content only. Requires
`document_templates.read`. A request for a template with no file returns `404`
Not Found.

### File deletion

`DELETE /api/document-templates/<id>/file/` removes the template's file from
storage and clears the field — it does **not** delete the `DocumentTemplate`
row. Requires `document_templates.update`. Deleting the file of a template with
no file returns `404`.

### Permissions

Seeded (data migrations `authentication.0003` and `authentication.0004`)
permission codes:

```text
document_templates.read             document_templates.create
document_templates.update           document_templates.delete
document_templates.version_create   document_templates.version_activate
```

Views require `IsCompanyMember` plus the code matching the HTTP method
(`permission_required(...)` from the Step-2 foundation): `read` for list /
retrieve / file download / version list / version retrieve, `create` for
template POST, `update` for PATCH / file upload / file delete,
`version_create` for `POST .../versions/`, `version_activate` for
`POST .../versions/<vid>/activate/`, `delete` for DELETE. Codes are granted to
users through `Role` / `UserRole` as usual.

### Template variables (controlled placeholders)

Templates may reference a **controlled** set of variables — no arbitrary
Python/Django expressions are ever executed. The single authoritative catalog
lives in `apps/document_templates/variables.py`, shared by validation (later
Step 4 generation) so validation and resolution stay in sync.

Supported namespaces and variables (all map to fields that actually exist in
the current models):

```text
company.*    company.name, company.legal_name, company.voen,
             company.registration_number
client.*     client.name, client.voen, client.email, client.phone
document.*   document.number, document.date, document.type
```

Placeholder syntax is exactly `{{ namespace.field }}`, e.g.
`{{ company.name }}`, `{{ client.voen }}`, `{{ document.number }}`. Whitespace
around the key and key casing are normalized.

The validator (in `variables.py`) extracts placeholders from the template's
actual text, normalizes them, and reports:

- **valid** placeholders (recognized variable)
- **invalid** placeholders (unknown variable, unknown field in a known
  namespace, malformed syntax, or an expression / attribute chain such as
  `{{ company.name.__class__ }}` or `{{ 1 + 1 }}`)

Placeholder validation is **validation only** — nothing is ever replaced or
executed. Replacement and generation are explicitly deferred (Step 4).

### Versioning & activation

Templates keep immutable version history in `TemplateVersion`. Each version is
a snapshot of the working file; historical versions are never edited or
deleted (their DB row is also INSERT-only in intent, with a fixed
`version_number` unique per template and an immutable `company`).

- `POST /api/document-templates/<id>/versions/` snapshots the template's
  current `.docx` into a new `TemplateVersion` with version number
  `(highest + 1)`. The template's actual document text is read and validated
  first: unknown/malformed placeholders are rejected and no version is
  recorded. Requires `document_templates.version_create`.
- `GET /api/document-templates/<id>/versions/` lists the template's versions
  (ascending version number).
- `GET /api/document-templates/<id>/versions/<vid>/` retrieves one version.
- `POST /api/document-templates/<id>/versions/<vid>/activate/` makes a version
  the template's single active version. Only one version per template is
  active at a time; activating one automatically deactivates the others.
  Historical versions and their contents are preserved — activation only
  moves the `is_active` pointer. Requires `document_templates.version_activate`.

Version files are stored versioned (`templates/company_<id>/<template_id>/v<n>_<uuid>.docx`)
so a new version never overwrites a historical one. `storage_path` is never
exposed to clients — versions are served by URL through the serializer.

### Activation & deactivation

The model exposes an `is_active` boolean, so activation/deactivation uses the
regular update mechanism: `PATCH /api/document-templates/<id>/` with
`{"is_active": false}` deactivates and `{"is_active": true}` reactivates.
Templates are created active by default. The toggle is company-scoped — a
cross-company PATCH resolves to 404 and never mutates the other company's row.

### Deletion

`DELETE` **soft-deletes** by setting `deleted_at` — the row is preserved
(company and template history use `PROTECT`). Soft-deleted templates disappear
from the normal list and resolve to 404 on detail / update / delete operations.

### Tenant isolation & company binding

Every lookup goes through the Step-2 helpers:

```python
tenant_queryset(DocumentTemplate, request.user.company)          # Rule C (listing)
get_tenant_object_or_404(DocumentTemplate, request.user.company, # Rule D (single)
                         pk=pk, deleted_at__isnull=True)
```

Creation binds the template to `request.user.company` — `company` is not a
writable serializer field and a body `company_id` is ignored. The DB-level
`prevent_company_id_change()` trigger additionally guarantees a template never
changes companies. Cross-company list/retrieve/update/delete all resolve to
`404` (never revealing that the object exists).

### Tests

`apps/document_templates/tests/test_api.py` covers the template metadata, file,
and version API; `apps/document_templates/tests/test_variables.py` covers the
placeholder validator (valid / unknown / malformed / expression placeholders).
In total (73 tests for the app) the suite exercises: access/RBAC across the
permission codes, tenant isolation (list/retrieve/update/delete/version
cross-company → 404), creation ownership and `company_id`-ignored, update and
company immutability, activation/deactivation, soft-deletion, file upload /
invalid-type / oversized rejection / retrieval / replacement / deletion, and
version creation / numbering / historical preservation / single-active /
activation / cross-company isolation.

### What is intentionally deferred

```text
Placeholder replacement ({{ client.name }} → value)  → Step 4.2
Actual DOCX generation                                → Step 4.x
PDF generation                                        → Step 4.x
Data context builder for generation                    → Step 4.1 (below)
```

---

## Document Generation — Data Context Builder

Step 4.1 of document generation: a reusable backend service that collects the
data required to fill a template and converts it into the **controlled
template-variable context** defined in Step 3. It is consumed later by the
placeholder replacement engine.

The service lives in `apps/generated_documents/services/context.py` and is
independent of HTTP views — it takes plain model instances and is callable
from the future placeholder engine, document generation, preview, and tests.

### Context structure

```python
{
    "company": {"name", "legal_name", "voen", "registration_number"},
    "client":  {"name", "voen", "email", "phone"},
    "document": {"number", "date", "type"},
    "items": [{"line_number", "description", "quantity", "unit",
               "unit_price", "discount_percent", "vat_rate_percent",
               "subtotal", "vat_amount", "total"}, ...],
}
```

### Variable contract

The builder uses **only** the variables approved in Step 3
(`apps/document_templates/variables.py`). No new variables are introduced;
the produced context mirrors the `company.*` / `client.*` / `document.*`
namespaces exactly and the `items` collection contributes the `item.*`
variables (present only when the document has line items). A tracked test
asserts the built context never introduces unapproved keys (no
`client.secret_field`, no `company.internal_id`, etc.).

### Data sourcing

- **company.*** — from the `Company` row (display name, legal name, VOEN,
  registration number). The tenant is `document.company` unless an explicit
  company is passed.
- **client.*** — resolved from the `Client` subtype rows:
  - legal entity → `client.name` = `legal_name`, `client.voen` = `legal_entity.voen`
  - individual → `client.name` = `first [middle] last` name, `client.voen` = `None`
  - `client.email`/`client.phone` come from the client's **primary contact**
- **document.*** — from `GeneratedDocument`: number, date (ISO date of
  `created_at`), type (document type name).
- **items** — line items from the document's `GeneratedDocumentVersion`
  (default: the latest version) via `version.line_items`, in `line_number`
  order. An explicit `version` may be passed; it must belong to the document.
  A document with no version yields an empty `items` collection.

### Tenant safety

Before building the context the builder verifies (defense-in-depth, in
addition to the API-level isolation) that `company`, `client` and `document`
all belong to the same company. A mismatch raises `GenerationContextError`
rather than silently mixing data from two tenants.

### Missing values

- Optional data (company VOEN / registration number, client VOEN for
  individuals, email, phone, …) resolves to `None` and never crashes the
  builder.
- Required data (client name, document number/date/type) that cannot be
  resolved fails with a clear `GenerationContextError` — e.g. a document with
  no client cannot satisfy the required `client.name` unless `require_client`
  is disabled.

### What is intentionally deferred

```text
DOCX generation / PDF generation → future step
```

---

## Document Generation — Placeholder Replacement Engine

Step 4.2 of document generation: a reusable, dependency-light service that
takes an existing `.docx` template and the validated context from Step 4.1 and
produces a separate output `.docx` with every supported placeholder replaced
by its value. It lives in
`apps/generated_documents/services/placeholder_engine.py` and is independent
of HTTP views.

### Placeholder syntax

Only the `{{ path }}` form is recognized:

```text
{{ company.name }}
{{ client.voen }}
{{ document.number }}
```

Whitespace and key casing are normalized, so `{{client.name}}`,
`{{ client.name }}` and `{{   Company.Name   }}` all resolve to the same
variable.

### How placeholders are resolved

The engine uses **only** the single authoritative variable catalog in
`apps/document_templates/variables.py` (the same source Step 3 validation
uses) — it does not maintain its own list. Each `{{ namespace.field }}` key is
looked up as `context["namespace"]["field"]` against the Step 4.1 context.
There is no `eval`, no attribute traversal, and no placeholder is ever
executed as code.

### Supported namespaces

```text
company.*    company.name, company.legal_name, company.voen,
             company.registration_number
client.*     client.name, client.voen, client.email, client.phone
document.*   document.number, document.date, document.type
item.*       (inside repeating sections only) — see Repeating Line Items
```

### Value formatting

Values are converted deterministically: `None` → empty string, `date` /
`datetime` → ISO date (`YYYY-MM-DD`), `Decimal` → no trailing zeros, everything
else → its string form. No localization/currency formatting yet.

### Missing-value behavior

- **Optional** variables with no value (e.g. `{{ client.phone }}`) resolve to
  the empty string and never crash generation.
- **Required** variables (`client.name`, `document.number`/`date`/`type`) with
  no value raise `MissingRequiredValueError` instead of silently producing an
  incorrect document.

### Unknown-variable behavior

A malformed or unsupported placeholder (e.g. `{{ client.unknown_field }}`,
`{{ some_random_variable }}`, an expression like `{{ company.name.__class__ }}`)
raises `UnknownPlaceholderError`. It is never replaced or executed. The whole
document is validated before any replacement, so all problems are reported at
once and no output is produced when validation fails.

### DOCX locations currently supported

Normal body paragraphs, table cells (including nested tables), and existing
headers/footers. Only header/footer parts the template already contains are
processed — no empty parts are created.

### Split runs

DOCX text is commonly divided into multiple runs; a placeholder such as
`{{ client.name }}` may be split across them. The engine concatenates each
paragraph's run text to locate placeholders and rewrites only the affected
runs, so split placeholders are replaced while surrounding formatting is
preserved.

### Original template is preserved

The source template is opened read-only and never overwritten; the rendered
document is written to a separate output path/buffer.

### What is intentionally deferred

```text
Complete document-generation flow → Step 4.4 (next)
PDF generation                   → future step
```

---

## Document Generation — Repeating Line Items

Step 4.3 of document generation: the placeholder engine supports **repeating
line-item sections** so invoice/financial templates can render an arbitrary
number of line items from the document's `DocumentLineItem` rows. This remains
inside the same reusable service
(`apps/generated_documents/services/placeholder_engine.py`); no API, no
persistence workflow, and no PDF output yet.

### Repeating-section syntax

Controlled `{{#each items}} ... {{/each}}` markers — `items` is the *only*
supported collection name and maps to the document's line items.

```text
{{#each items}}
{{ item.description }} | {{ item.quantity }} | {{ item.unit_price }} | {{ item.total }}
{{/each}}
```

Table rows use the same markers inside a single **prototype row**: the row's
*first* cell starts with `{{#each items}}` and its *last* cell ends with
`{{/each}}`, with the `{{ item.* }}` placeholders in the other cells.

### The `items` collection and `item.*` variables

The context builder (`services/context.py`) reads line items from a
`GeneratedDocumentVersion` (defaulting to the document's latest version) in
`line_number` order and exposes them as `context["items"]`, a list of items.
Each item maps the `item.*` variables (all from the real `DocumentLineItem`
model — nothing is invented):

```text
item.line_number    item.description    item.quantity    item.unit
item.unit_price     item.discount_percent item.vat_rate_percent
item.subtotal       item.vat_amount     item.total
```

`{{ item.* }}` is only valid inside a repeating section.

### Table-row behavior

The row containing the markers is the **prototype row**: it is cloned once per
line item and the `{{#each items}}` / `{{/each}}` markers are stripped. The
header row and totals rows remain unchanged, and the prototype row does not
remain as an extra empty row.

### Empty-collection behavior

With zero line items (`items = []`), any repeating section produces **no
rows/paragraphs** — the prototype row is removed and no `{{ item.* }}` residue
is left behind.

### Formatting preservation

Cloned rows are deep copies of the prototype row's XML, so cell/paragraph/font
formatting, borders and alignment are preserved. Only the marker text is
stripped and the `{{ ... }}` placeholders replaced.

### Security restrictions

The template language remains data-only: no `eval`, no `exec`, no expression
execution. Only the approved variables and the fixed `items` collection are
resolved. `{{#each unknown_collection}}`, unbalanced/nested markers, and
`{{ item.* }}` outside a section all raise
`UnknownPlaceholderError` before anything is written.

### What is intentionally deferred

```text
Nested loops / conditionals / filters / arbitrary expressions → not supported
Complete document-generation flow                             → Step 4.4 (next)
PDF generation                                                → future step
```

### Document generation roadmap

```text
4.1 Data Context Builder       ✅
4.2 Placeholder Engine         ✅
4.3 Repeating Line Items       ✅
4.4 Complete Generation Flow  ← upcoming
```

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
DocumentTemplate
TemplateVersion
CompanyDocumentCounter
GeneratedDocument
GeneratedDocumentVersion
DocumentLineItem
AuditLog
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
  `(company, email)` for non-deleted users). Authentication is therefore
  company-aware: the company is resolved first (login payload, subdomain,
  company picker, etc.) and the user is looked up by the `(company, email)`
  pair. See [Authentication & JWT](#authentication--jwt) for the implemented
  flow.
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

## 5. Document Templates

App:

```text
apps/document_templates/
```

Models: `DocumentTemplate`, `TemplateVersion`.

```text
Company
   │
   └── DocumentTemplate
        │
        └── TemplateVersion
```

- Every document template belongs to exactly one company.
- **`DocumentTemplate`** represents a company's template for a given document
  type (consulting contract, invoice, etc.). It references the shared
  `DocumentType` lookup table.
- The template's current file is stored in a `file` `FileField` (a `.docx`,
  uploaded via the file API), persisted through Django's standard storage —
  `FileSystemStorage` under `MEDIA_ROOT` in development, swappable to object
  storage later via the `STORAGES` setting. Files are stored per-template under
  `templates/company_<id>/<id>.docx`.
- The table also stores metadata (`name`, `is_active`, timestamps, soft delete
  via `deleted_at`).
- There is an index optimized for `(company, document_type, is_active)`.
- **`TemplateVersion`** is an immutable edition of a template's file. Old
  versions are never deleted or edited, so `template` uses `PROTECT`
  (`ON DELETE RESTRICT`) to preserve template history.
- `version_number` is unique per template (unique constraint on
  `(template, version_number)`).
- A version records a `file` `FileField` holding the immutable .docx snapshot,
  `storage_path`, an optional `checksum`, and the user who created it
  (`created_by` → `User`, `SET_NULL`). `is_active` marks the template's single
  currently-active version (a pointer, not content). Placeholder validation is
  run against the snapshot's actual text at version-creation time.
- `TemplateVersion.company` is a **copy** of `DocumentTemplate.company` (same
  pattern as the client subtype tables): it exists to support a composite FK
  `(template_id, company_id)` → `document_templates(id, company_id)` and an
  immutability trigger proving the copy stays in sync.
- `created_by` also needs a composite FK `(created_by_id, company_id)` →
  `users(id, company_id)` so a template version can never be attributed to a
  user from another company.
- As in other apps, the composite FKs, the `UNIQUE(id, company_id)` target on
  `DocumentTemplate`, and the INSERT-only invariant on `TemplateVersion`
  require PostgreSQL composite foreign keys and triggers that Django cannot
  express natively; these are added via the raw-SQL migration
  `apps/database/migrations/0002_raw_sql_constraints.py` (see below).
- The **metadata** layer (create / list / retrieve / update / activate /
  deactivate / soft-delete a template), the **current `.docx` file** (upload /
  replace / download / delete), and the **controlled variables + immutable
  version history** (create / list / retrieve / activate a version) are
  implemented as the Document Template Management API (see [Document Template
  Management API](#document-template-management-api)). Placeholder replacement
  and document/PDF generation are later steps and are not yet implemented.

## 6. Company Document Counters

App:

```text
apps/company_document_counters/
```

Model: `CompanyDocumentCounter`.

- **`CompanyDocumentCounter`** is a strict 1-to-1 extension of `Company`
  (`OneToOneField`, `company_id` as the primary key) holding one row per
  company for handing out document numbers.
- It stores the last number handed out (`last_number`, `BigIntegerField`),
  which is atomically incremented to produce the next document number.
- It is deliberately **not** a per-company PostgreSQL `SEQUENCE` object,
  since that does not scale cleanly to hundreds/thousands of tenants each
  needing their own sequence.
- Incrementing is a single `UPSERT ... RETURNING` statement, not a
  read-then-write pair, so no interleaving window exists where two concurrent
  calls could be handed the same number.
- `on_delete=CASCADE`: this is pure operational state with no historical or
  legal significance (unlike clients/documents/audit logs), so it follows the
  same reasoning as `CompanySettings`/`CompanyBranding` rather than the
  `PROTECT` used on business-critical company children.
- The increment must happen inside the same transaction as the document
  creation it is numbering, so a failure afterwards rolls the increment back
  too.

## 7. Generated Documents

App:

```text
apps/generated_documents/
```

Models: `GeneratedDocument`, `GeneratedDocumentVersion`, `DocumentLineItem`.

```text
GeneratedDocument
       │
       ├── GeneratedDocumentVersion
       │
       └── DocumentLineItem
```

- **`GeneratedDocument`** is the logical document identity — a "folder", not
  its contents. It stores the document number, the `client`, the `company`,
  and the current `status` (draft / generated / sent / void). What was
  actually generated lives in `GeneratedDocumentVersion`; this table never
  holds anything that could legitimately differ between versions.
- Every generated document belongs to exactly one company (`PROTECT` — legal/
  financial retention). It may reference a `Client` (`PROTECT` — deleting a
  client must not touch its documents), the shared `DocumentType`, and the
  `DocumentTemplate` that produced it.
- `document_number` is unique per company (unique constraint on
  `(company, document_number)`). `created_by` → `User` (`SET_NULL`). Soft
  delete via `deleted_at`.
- There are indexes on `(company, status)` and `(company, client)`.
- **`GeneratedDocumentVersion`** is an immutable snapshot of a generated
  document. Line items belong **here**, not to `GeneratedDocument` directly:
  editing a document means creating a new version, never mutating an existing
  one's contents.
- `version_number` is unique per document. The version references the
  `TemplateVersion` used to generate it (`PROTECT` — reconstruction depends
  on this reference).
- It snapshots the `Currency` (shared), `exchange_rate_used`, and
  `vat_rate_used_percent`, capturing the values actually applied at
  generation time.
- `generation_snapshot` is a JSON field holding the full point-in-time
  rendering input (company/client/document/template/template variables) that
  must cover every value affecting rendered output. `generation_metadata`
  holds genuinely incidental technical data only (engine version, render
  duration).
- Output files are recorded via `storage_path_docx` and `storage_path_pdf`.
  `generated_by` → `User` (`SET_NULL`).
- `GeneratedDocumentVersion.company` is a **copy** of
  `generated_document.company`, existing purely to support composite FKs
  proving the version's document and template version belong to the same
  company (closing the gap where a Company-A document could reference a
  Company-B template version).
- **`DocumentLineItem`** belongs to a specific `GeneratedDocumentVersion`,
  not to the document directly — this is what makes "Version 1: 10 hours,
  Version 2: 20 hours" reconstructable. It is owned entirely by its version
  (`CASCADE`).
- Line items store `line_number` (unique within a version), `description`,
  `quantity`, `unit`, `unit_price`, `discount_percent`, `vat_rate_percent`,
  and the shared `Currency`, plus computed monetary totals (`subtotal`,
  `vat_amount`, `total`).
- `company` on the version and line item is the copied-company pattern used
  throughout the client/template chain, to support composite FKs.
- As in other apps, the composite FKs (`UNIQUE(id, company_id)` targets,
  `(client_id, company_id)`, `(template_id, company_id)`,
  `(template_version_id, company_id)`, and the user references) and the
  INSERT-only immutability triggers on versions and line items require
  PostgreSQL composite foreign keys and triggers that Django cannot express
  natively; these are planned as raw-SQL migration additions.
- One application-level rule (not DB-enforced): for version 1, a line item's
  currency should match its parent version's currency — the column stays
  flexible for future genuine multi-currency line items, but nothing should
  exercise that yet.

## 8. Audit Logging

App:

```text
apps/audit_logs/
```

Model: `AuditLog`.

```text
Company
   │
   └── AuditLog
```

- **`AuditLog`** is an **append-only** audit trail. It deliberately has no
  `updated_at`/`deleted_at` — audit rows are immutable by design, not
  soft-deletable business data.
- Every audit log row belongs to exactly one company. `company` uses
  `PROTECT`: audit history must outlive normal company lifecycle events.
  (Companies are soft-deactivated via `status`/`deleted_at` and never
  physically deleted, so this is a safety net that should never fire.)
- `user` references `User` with `SET_NULL` — deleting a user must never
  delete their audit trail.
- A row records the `action` (e.g. `client.created`, `user.role_changed`),
  the affected `entity_type` / `entity_id`, and optional `previous_values` /
  `new_values` JSON capturing the before/after state.
- Request context is stored as `ip_address`, `user_agent`, and an optional
  `request_id` correlation ID (tying multiple audit rows to a single
  operation).
- `created_at` is the only timestamp.
- There are indexes on `(company, -created_at)`, `(company, entity_type,
  entity_id)`, `user`, and `request_id`.
- Deferred to a raw-SQL migration: the composite FK
  `(user_id, company_id) → users(id, company_id)` (so a Company-A audit log
  can never be attributed to a Company-B user), a BEFORE UPDATE/DELETE
  trigger raising an exception as a second line of defense independent of
  role grants, and database-level `GRANT`/`REVOKE` so the application's
  runtime role has `INSERT`/`SELECT` only on this table.

## Future modules

The following are **designed but not yet implemented** in Django at this
point:

- PostgreSQL RLS policies

These are planned/future work and must not be treated as implemented.

### Implemented/modelled now

```text
companies / Company, CompanySettings, CompanyBranding
authentication / User, Role, Permission, UserRole, RolePermission
reference_data / Currency, VatRate, ExchangeRate, AddressType, DocumentType, Bank
clients / Client, ClientLegalEntity, ClientIndividual, ClientAddress, ClientContact, ClientBankAccount
document_templates / DocumentTemplate, TemplateVersion
company_document_counters / CompanyDocumentCounter
generated_documents / GeneratedDocument, GeneratedDocumentVersion, DocumentLineItem
audit_logs / AuditLog
```

### Planned/future

```text
PostgreSQL RLS policies
```

Note: the PostgreSQL **composite foreign keys, immutable-`company` triggers,
client-subtype exclusivity, RBAC role/company-match trigger, and version /
line-item / audit-log INSERT-only triggers** that the earlier sections
describe as "planned" were applied in
`apps/database/migrations/0002_raw_sql_constraints.py`. Only RLS policies
remain in the future-work list above.

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