# GRM CRM — Frontend

Frontend application for the GRM CRM Django backend.

Implemented so far:
- **Generated document detail** (Phase 6.3): `/documents/:documentId` opens a
  document's metadata (number, document type, status, client/template
  references, created/updated, creator). The documents list links each document
  number to this page.
- **Generated document creation** (Phase 6.2): `/documents/new` creates a real
  generated document (client + document type + currency + optional line items)
  through the backend creation endpoint.
- **Generated documents list** (Phase 6.1): `/documents` shows the real
  generated documents for the authenticated company (no search/filter/
  pagination — the backend supports none).
- **Document templates vertical slice** (Phase 5): template list with a
  document-type filter, create, detail (metadata, current file, upload/replace,
  download, version history, create/activate version), and soft-delete.
- **Clients vertical slice** (Phase 4): client list with search/filters, create,
  detail (with read-only nested data), edit, and soft-delete confirmation.
- **Application shell + dashboard** (Phase 3): authenticated shell (responsive
  sidebar, header, sign-out), real-data dashboard.
- **Authentication vertical slice** (Phase 2): login, token storage, `/me`
  initialization, protected routes, automatic access-token refresh, logout.
- **Technical foundation** (Phase 1): routing, Tailwind, the generic API
  client, the typed error model.
- Document editing, deletion, DOCX/PDF generation/download, and document
  regeneration (and version management) are not implemented yet — later
  Generated Documents tasks.

## Stack

- React 19 + TypeScript (strict)
- Vite
- React Router
- Tailwind CSS v4
- Vitest + Testing Library

## Setup

```bash
npm install
cp .env.example .env.local   # optional; see below
```

`VITE_API_BASE_URL` defaults to `/api`. A development-only Vite proxy forwards
`/api` to `http://127.0.0.1:8000`, so local development works without CORS. Set
`VITE_API_BASE_URL` to a full origin (e.g. `http://localhost:8000/api`) to
bypass the proxy. It is configuration, not a secret — never put secrets in
`VITE_*` variables.

## Scripts

```bash
npm run dev         # development server (proxies /api to the Django dev server)
npm test            # run the test suite (Vitest)
npm run lint        # lint (oxlint)
npm run typecheck   # TypeScript check (tsc -b)
npm run build       # production build (typecheck + Vite build)
npm run preview     # preview the production build
```

## Application shell

The authenticated area renders through `AppShell` (`src/components/layout/`):

- **Sidebar** — navigation for Dashboard, Clients, Templates, Documents
  (all live router links; the active route is marked with `aria-current`). On
  mobile the sidebar becomes an overlay toggled from the header.
- **Header** — the authenticated company name, user display name, and email
  (from `AuthContext`), plus a **Sign out** button. Optional values are simply
  omitted when missing.
- Signing out clears both tokens and the in-memory auth state via
  `AuthContext.logout()`; the protected route then redirects to `/login`.

## Dashboard

`/dashboard` (`src/pages/dashboard/`) is a real, read-only dashboard. Every
number is derived from existing backend list endpoints for the caller's
company — nothing is fabricated:

| Section | Backend endpoint | Shape |
|---|---|---|
| Clients | `GET /api/clients/` | array of `ClientSummary` |
| Templates | `GET /api/document-templates/` | array of `DocumentTemplate` |
| Documents | `GET /api/generated-documents/` | array of `GeneratedDocument` |

It shows client/template/document counts (from `data.length`), a welcome line,
the company name, and the five most recent documents (newest first) with
number, type, status, and date. Each section has its own loading state, empty
state ("No clients yet."), and safe error state with a retry action; a failing
section never takes down the rest of the page. There is deliberately **no**
backend summary endpoint and no fabricated dashboard statistics.

## Clients

`/clients` (`src/pages/clients/`) is a full CRUD vertical slice backed by the
existing Django client API — the company is always the authenticated user's
company (the frontend never sends `company_id`).

| Backend endpoint | Operation | API module fn |
|---|---|---|
| `GET /api/clients/` | list (plain array, **no pagination**) | `listClients(params)` |
| `GET /api/clients/:id/` | detail | `getClient(id)` |
| `POST /api/clients/` | create (201) | `createClient(input)` |
| `PATCH /api/clients/:id/` | partial update (200) | `updateClient(id, input)` |
| `DELETE /api/clients/:id/` | **soft-delete** (204) | `deleteClient(id)` |

- **List** — search box (`search`), status and client-type filters, all mapped
  to the real backend query parameters and stored in the URL (refresh /
  back-forward preserve the state). Backend validation errors are rendered
  next to the matching fields. Cross-tenant or missing clients return 404, so
  the detail page shows one safe "Client not found" state for both.
- **Create** (`/clients/new`) — form with the real serializer fields
  (`client_type`, `status`, and the matching legal-entity / individual
  subtype). Required fields are marked; empty optional values are sent as
  `null`.
- **Detail** (`/clients/:clientId`) — displays the client, subtype, and the
  read-only nested data already present in the detail response (contacts,
  addresses, bank accounts). Nested *editing* uses separate backend endpoints
  and is out of scope for this phase.
- **Edit** (`/clients/:clientId/edit`) — pre-filled PATCH form. `client_type`
  is immutable (the backend enforces this), so it is shown disabled.
- **Delete** — soft-delete with an explicit inline confirmation step; after
  success the app returns to the client list.
- Errors use the typed `ApiError`: 400 field errors inline, 403 / 404 / 429 / 5xx
  as safe messages — never raw backend internals. 401 is handled by the
  existing refresh flow.

## Document templates

`/templates` (`src/pages/templates/`) is a Document Templates vertical slice
backed by the existing Django `document_templates` API — the company is always
the authenticated user's company (the frontend never sends `company_id`).

| Backend endpoint | Operation | API module fn |
|---|---|---|
| `GET /api/document-templates/` | list (plain array, **no pagination**) | `listTemplates(params)` |
| `GET /api/document-templates/?document_type=<id>` | filter by document type | `listTemplates({ document_type })` |
| `POST /api/document-templates/` | create (201) | `createTemplate(input)` |
| `GET /api/document-templates/:id/` | detail | `getTemplate(id)` |
| `DELETE /api/document-templates/:id/` | **soft-delete** (204) | `deleteTemplate(id)` |
| `GET /api/document-templates/:id/file/` | authenticated file download (binary) | `downloadTemplateFile(id)` |
| `POST /api/document-templates/:id/file/` | upload / replace the `.docx` (201) | `uploadTemplateFile(id, file)` |
| `DELETE /api/document-templates/:id/file/` | remove the file (204) | `deleteTemplateFile(id)` |
| `GET /api/document-templates/:id/versions/` | version list | `listTemplateVersions(id)` |
| `POST /api/document-templates/:id/versions/` | create a version from the current file (201) | `createTemplateVersion(id)` |
| `POST /api/document-templates/:id/versions/:vid/activate/` | activate a version | `activateTemplateVersion(id, vid)` |
| `GET /api/reference-data/document-types/` | document-type catalog for the form/filter | `fetchDocumentTypes()` |

- **List** (`/templates`) — a table of the backend's templates (name, document
  type, active status, current file basename, updated date). The only supported
  filter is the backend `document_type` query parameter, kept in the URL so
  refresh / back-forward preserve the state. The backend supports no search /
  ordering / pagination, so none is shown. The document-type filter options come
  from the read-only reference-data catalog; if that catalog call fails the
  list still works (only the filter is disabled).
- **Create** (`/templates/new`) — form with the real serializer fields:
  required `name` and `document_type` (from the reference-data catalog) plus
  the optional `is_active` flag. The backend does **not** require a file at
  creation time, so no file upload is collected here. The company is never sent.
- **Detail** (`/templates/:templateId`) — template metadata (document type,
  active status, current file basename, created/updated), the **authenticated
  file download** button, an upload/replace form, version creation, and the
  version history. The backend returns 404 for both missing and cross-tenant
  templates, so both render one safe "Template not found" state.
- **Authenticated download** — files are never fetched from `/media/...`;
  downloads go through `GET /api/document-templates/:id/file/` via the shared
  API client (which attaches the bearer token and runs the existing 401 →
  refresh → retry flow). The binary response is turned into a `Blob` and
  downloaded with the filename from the response's `Content-Disposition` header
  (falling back to `template.docx`). The raw storage path is never exposed or
  logged.
- **Upload / replace** — a single `.docx` file is uploaded to the dedicated
  file endpoint as `FormData` (multipart boundary left to the browser; no
  manual `Content-Type`). Validates the `.docx` extension client-side before
  sending and surfaces backend validation errors (size / not-a-valid-docx /
  forbidden) afterward. After a successful upload the template metadata and
  version history are refreshed from the backend.
- **Versioning** — `POST .../versions/` snapshots the template's **current
  file** as a new immutable version (the new version becomes the active one, as
  the backend contract dictates — the frontend does not invent this). Version
  activation uses the dedicated `.../versions/:vid/activate/` endpoint after an
  explicit confirmation step, then refetches the versions so the single-active
  invariant always reflects the server. A failed version section never takes
  down the rest of the page.
- **Delete** — soft-delete with an explicit inline confirmation step; after
  success the app returns to the template list. (Removing just the *file* — not
  the row — is a separate `DELETE .../file/` operation supported by the backend
  but intentionally not surfaced as a UI action in this phase.)
- Errors use the typed `ApiError`: 400 field/validation errors inline, 403 a
  safe access-denied state, 404 a safe not-found state, 429 a friendly retry
  message, and 5xx a generic message — never raw backend internals.

## Generated documents

`/documents` (`src/pages/documents/`) lists the generated documents for the
authenticated company, backed by the existing Django `generated_documents` API
— the company is always the authenticated user's company (the frontend never
sends `company_id`).

| Backend endpoint | Operation | API module fn |
|---|---|---|
| `GET /api/generated-documents/` | list (plain array, **no pagination**) | `listGeneratedDocuments()` / `fetchGeneratedDocuments()` (dashboard alias) |
| `GET /api/generated-documents/:id/` | **detail** | `getGeneratedDocument(id)` |
| `POST /api/generated-documents/` | **create** a document (201) | `createGeneratedDocument(input)` |

- The list shows the fields the backend actually returns: `document_number`,
  `document_type_code`, `client_id` (displayed as `Client #<id>` because the
  list serializer exposes only the id, never a client name), `status`, and
  `created_at`.
- The backend provides **no** search, status/type/client/date filters, ordering
  parameter, or pagination — the list endpoint always returns the caller's
  documents ordered newest-first. The page therefore renders that collection
  directly with no invented controls and no pagination UI.
- States: loading (no fake rows/counts), empty ("No documents yet."), and a
  safe error state with a retry action. Errors use the typed `ApiError`
  (403 → safe access-denied message, 429 → retry message, 5xx → generic
  message); 401 is handled by the existing refresh flow.
- Each row's document number links to `/documents/:documentId`.

### Document detail (`/documents/:documentId`)

`DocumentDetailPage` (`src/pages/documents/`) opens a single document via
`getGeneratedDocument(id)` (`GET /api/generated-documents/:id/`). The backend's
detail view uses the **same `GeneratedDocumentSerializer` as the list**, so the
detail page shows the metadata that serializer returns: document number
(heading), document type code, `status`, `client_id` and `template_id` (linked
to the existing client / template detail routes), `created_at`, `updated_at`,
and `created_by_id` (shown as `User #<id>`). The detail serializer returns no
nested client/template/version/line-item/totals data, so none is shown.

The backend returns 404 for missing and cross-tenant documents alike, so both
render one safe "Document not found" state. Other states: loading (no
fabricated data), 403 → safe access-denied message, and a generic error with a
retry action. No `company_id` is ever sent. Document generation and DOCX/PDF
download are **not** part of this scope and no such buttons are shown.

### Creating a document (`/documents/new`)

`DocumentCreatePage` (`src/pages/documents/`) creates a document through the
real `POST /api/generated-documents/` endpoint using the fields the backend
`GeneratedDocumentCreateSerializer` accepts:

- **Client** (required) — from `listClients()` (`GET /api/clients/`).
- **Document type** (required) — from `fetchDocumentTypes()`
  (`GET /api/reference-data/document-types/`). When the company's templates are
  known (`GET /api/document-templates/`), types without an active template are
  hidden from the dropdown; the backend stays authoritative and rejects
  unresolvable types/templates with a clear `detail` message.
- **Currency** (required in practice) — from `fetchCurrencies()`
  (`GET /api/reference-data/currencies/`). The backend service rejects
  creation without a currency for the initial version.
- **Line items** (optional) — dynamic rows with `description`, `quantity`,
  `unit`, `unit_price`, `discount_percent`, and `vat_rate_percent`. Users can
  add, edit, and remove rows. Totals (`subtotal`/`vat_amount`/`total`) and the
  document number are computed **server-side** and never submitted.

Dependencies load independently with their own retry; a failed catalog is shown
as an error, never as a silently empty list. Submission disables the button,
prevents duplicate POSTs, and navigates back to `/documents` on success.
Backend field errors render next to the matching control, nested line-item
errors render on the offending row, and `detail` messages (e.g. missing active
template) render as a form-level message. `company_id` is never sent; the
backend derives the tenant from the authenticated user.

## API client

`src/api/client.ts` is the single HTTP entry point: GET/POST/PUT/PATCH/DELETE,
JSON and FormData bodies, automatic bearer-token header, 401 → refresh → retry
once, and conversion of every failed response into a typed `ApiError` (status,
payload, `fieldErrors`, `Retry-After`, safe message). `apiClient.raw` returns
the unparsed `Response` for authenticated binary downloads — it still carries
the bearer token and the same refresh/error handling. Small modules built on it
for the dashboard and features: `src/api/clients.ts`, `src/api/templates.ts`,
`src/api/documents.ts`, `src/api/referenceData.ts`.

## Authentication flow

Backed by the Django API (`apps/authentication`) with company-scoped email
logins:

1. `POST /api/authentication/token/` with `{ company_id, email, password }` —
   `company_id` is required because email is unique per company. Success
   returns `{ access, refresh }`.
2. Tokens are stored in `localStorage` (see `src/utils/authStorage.ts`) and
   the client fetches `GET /api/authentication/me/` for the current user,
   company, and — when the backend provides them — permissions.
3. `AuthProvider` (React context) exposes `status`, `user`, `companyId`,
   `companyName`, `permissions`, `hasPermission(code)`, `login`, `logout`.
4. `ProtectedRoute` guards the application area (also during initialization);
   an authenticated visitor on `/login` is redirected to `/dashboard`.

### Automatic token refresh

The API client handles expired access tokens: a 401 triggers one refresh
(`POST /api/authentication/token/refresh/` with the stored refresh token) and
retries the original request exactly once; concurrent 401s share a single
in-flight refresh. If the refresh fails, both tokens are cleared, subscribers
are notified, and the user returns to `/login`. Login/refresh requests never
trigger the refresh flow.

## Routes

```text
/              → redirects to /dashboard
/login         → sign-in form (outside the authenticated shell)
/dashboard     → dashboard (protected, inside AppShell)
/clients       → client list (protected, inside AppShell)
/clients/new   → create client (protected, inside AppShell)
/clients/:clientId       → client detail (protected, inside AppShell)
/clients/:clientId/edit  → edit client (protected, inside AppShell)
/templates     → template list (protected, inside AppShell)
/templates/new → create template (protected, inside AppShell)
/templates/:templateId → template detail (protected, inside AppShell)
/documents     → generated document list (protected, inside AppShell)
/documents/new → create generated document (protected, inside AppShell)
/documents/:documentId → generated document detail (protected, inside AppShell)
*              → not found
```

Route protection is UX-only; the Django backend remains the authoritative
authorization and tenant-isolation boundary.

## Testing

```bash
npm test
```

Vitest + Testing Library (jsdom). Tests mock `fetch` at the API-client
boundary — no real backend needed. Coverage includes the API client, auth
state, login page, protected routing, the application shell, the dashboard
(loading / data / empty / error / partial-failure), the dashboard API modules,
the clients API module, the client list / create / detail / edit pages
(loading, success, empty, error/retry, validation, delete confirmation,
navigation, and URL search/filter behavior), the document-templates slice:
the templates + reference-data API modules (methods, bodies, FormData upload,
query params, binary download), the template list (loading / data / empty /
error/retry / document-type filter / navigation), the create form (fields,
validation, success, backend errors, duplicate-submission guard, redirect), the
detail page (metadata, active version, version history, empty versions, 404 /
403 / 5xx, upload incl. `.docx` validation and backend errors, authenticated
download with filename handling, create/activate version incl. in-flight
activation state and activation error, delete confirmation), and the generated
documents slice: the documents API module (endpoint, no query params, detail,
create payload incl. no `company_id`, typed errors), the reference-data
currency API, the documents list page (loading, data rendering, count, empty
state, error/retry, no invented search/filter/pagination controls, detail
links), the create page (loading, per-dependency errors + retry, client /
document-type / currency options, only document types with an active template,
line-item add/edit/remove and submission, form validation, successful creation
+ redirect, duplicate-submit prevention, backend field / nested line-item /
non-field errors, cancellation), and the detail page (loading, metadata
rendering incl. status badge and client/template links, non-numeric id, 404 /
403 / generic error / retry, back navigation), plus protected routing for
`/templates`, `/templates/new`, `/templates/:templateId`, `/documents`,
`/documents/new`, and `/documents/:documentId`.

## Known limitations

- The backend `/me` response currently **does not** include a permissions
  field, so `permissions` is empty and `hasPermission()` returns `false` — the
  frontend grants nothing. The wiring will light up if the backend starts
  returning `permissions` on `/me`.
- Tokens are stored in `localStorage` (standard bearer-token SPA model), which
  is subject to the usual XSS caveat; httpOnly-cookie auth would be a separate
  change.
- The dashboard and clients list depend on the `clients.read`,
  `document_templates.read`, and `generated_documents.read` backend
  permissions; unauthorized sections show a safe error state rather than the
  data. (The full client CRUD likewise requires the matching `clients.*`
  permissions, and the template operations require the corresponding
  `document_templates.*` / `document_templates.version_*` permissions.)
- The template and client lists are not paginated (the backend returns plain
  arrays).
- The generated documents list is **not** paginated and supports **no**
  search/filter/ordering parameters (the backend returns a plain array, newest
  first, with no query parameters), so none are shown.
- The generated-document list and detail serializers expose only `client_id`
  and `template_id` (no client/template names), so those are shown as
  `Client #<id>` / `Template #<id>` links to the existing detail routes.
- Document creation requires the company to have an **active document template
  with an active version** for the chosen document type and a currency for the
  initial version — otherwise the backend rejects creation with a clear
  `detail` message (surfaced by the create form).
- Document editing, deletion, **generation** (DOCX/PDF), regeneration, version
  management, and DOCX/PDF download UI are not implemented — these are later
  Generated Documents phases. The detail page shows only what the detail
  serializer returns (no line items/totals/versions), and detail/generate/
  versions/download endpoints are not surfaced as actions.
- Nested client editing (addresses / contacts / bank accounts) is a separate
  later phase; this phase only displays the read-only data already returned by
  the client detail endpoint.
- The template file **remove-only** endpoint (`DELETE .../file/`, which clears
  the current file without deleting the template) exists on the backend but is
  not surfaced as a UI action in this phase.
- Version *creation* requires the template to already have a current file (the
  backend rejects it otherwise), and validates placeholders in the document's
  text — invalid/unknown placeholders are reported as a version-creation error.
- There is no registration, password reset, or account management UI.