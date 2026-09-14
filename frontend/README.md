# GRM CRM — Frontend

Frontend application for the GRM CRM Django backend.

Implemented so far:
- **Audit logs filtering & search** (Audit Logs Step 2): `/audit-logs` filters
  map 1:1 to the backend's supported query parameters (exact-match action /
  entity type / entity / user, timestamp bounds), kept in the URL with
  pagination integration.
- **Audit logs read-only list** (Audit Logs Step 1): `/audit-logs` shows the
  real audit records for the authenticated company (no detail/export — those
  are later steps).
- **PDF generation + download** (Phase 6.5): on `/documents/:documentId`, a
  generated document's DOCX version can be converted to PDF and the resulting
  file downloaded through the authenticated backend endpoints.
- **DOCX generation + download** (Phase 6.4): on `/documents/:documentId`, a
  generated document can be generated (synchronous DOCX) and the resulting file
  downloaded through the authenticated backend endpoints.
- **Generated document detail** (Phase 6.3): `/documents/:documentId` opens a
  document's metadata (number, document type, status, client/template
  references, created/updated, creator). The documents list links each document
  number to this page.
- **Generated document creation** (Phase 6.2): `/documents/new` keeps the form
  entirely local until the user clicks **Generate**, then creates a real
  generated document (client + document type + currency + optional line items)
  **and** generates its DOCX + PDF through the backend's atomic
  generate-from-input endpoint. No persistent draft is created beforehand; a
  failed generation leaves nothing behind.
- **Document preview** (Phase 6.6): on `/documents/new`, **Preview** renders the
  current form data through the authenticated non-persistent preview endpoint
  into a temporary `blob:` PDF shown in the browser — no document, version,
  line item, audit event, document number, or stored file is ever created.
  Changing a relevant input clears the stale preview and requires Preview again.
  **Generate** remains the only action that creates the persistent document.
- **Generated documents list** (Phase 6.1): `/documents` shows the real
  generated documents for the authenticated company (no search/filter/
  pagination — the backend supports none).
- **Document templates vertical slice** (Phase 5): template list with a
  document-type filter, create, detail (metadata, current file, upload/replace,
  download, file removal, version history, create/activate version, per-version
  detail links), metadata editing, read-only version detail, and soft-delete.
- **Clients vertical slice** (Phase 4): client list with search/filters, create,
  detail (with read-only nested data), edit, and soft-delete confirmation.
- **Application shell + dashboard** (Phase 3): authenticated shell (responsive
  sidebar, header, sign-out), real-data dashboard.
- **System Admin shell** (Admin Phase 3): a separate `/admin` surface with its
  own login, auth context, token storage, route guard, and permission-aware
  navigation. Placeholder section pages only — no admin CRUD yet.
- **Authentication vertical slice** (Phase 2): login, token storage, `/me`
  initialization, protected routes, automatic access-token refresh, logout.
- **Technical foundation** (Phase 1): routing, Tailwind, the generic API
  client, the typed error model.
- Document editing, deletion, regeneration (a dedicated UI action) and version
  management are not implemented yet — later Generated Documents tasks.

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

- **Sidebar** — navigation for Dashboard, Clients, Templates, Documents,
  Audit logs
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
| `GET /api/clients/:id/addresses/` | address list (plain array, **no pagination**) | `listClientAddresses(clientId)` |
| `POST /api/clients/:id/addresses/` | create address (201) | `createClientAddress(clientId, input)` |
| `PATCH /api/clients/:id/addresses/:addressId/` | partial address update (200) | `updateClientAddress(clientId, addressId, input)` |
| `DELETE /api/clients/:id/addresses/:addressId/` | **physical** address delete (204) | `deleteClientAddress(clientId, addressId)` |
| `GET /api/reference-data/address-types/` | address-type catalog for the form | `fetchAddressTypes()` |
| `GET /api/clients/:id/contacts/` | contact list (plain array, **no pagination**) | `listClientContacts(clientId)` |
| `POST /api/clients/:id/contacts/` | create contact (201) | `createClientContact(clientId, input)` |
| `PATCH /api/clients/:id/contacts/:contactId/` | partial contact update (200) | `updateClientContact(clientId, contactId, input)` |
| `DELETE /api/clients/:id/contacts/:contactId/` | **physical** contact delete (204) | `deleteClientContact(clientId, contactId)` |
| `GET /api/clients/:id/bank-accounts/` | bank account list (plain array, **no pagination**) | `listClientBankAccounts(clientId)` |
| `POST /api/clients/:id/bank-accounts/` | create bank account (201) | `createClientBankAccount(clientId, input)` |
| `PATCH /api/clients/:id/bank-accounts/:accountId/` | partial bank account update (200) | `updateClientBankAccount(clientId, accountId, input)` |
| `DELETE /api/clients/:id/bank-accounts/:accountId/` | **physical** bank account delete (204) | `deleteClientBankAccount(clientId, accountId)` |
| `GET /api/reference-data/banks/` | bank catalog for the form | `fetchBanks()` |

- **List** — search box (`search`), status and client-type filters, all mapped
  to the real backend query parameters and stored in the URL (refresh /
  back-forward preserve the state). Backend validation errors are rendered
  next to the matching fields. Cross-tenant or missing clients return 404, so
  the detail page shows one safe "Client not found" state for both.
- **Create** (`/clients/new`) — form with the real serializer fields
  (`client_type`, `status`, and the matching legal-entity / individual
  subtype). Required fields are marked; empty optional values are sent as
  `null`.
- **Detail** (`/clients/:clientId`) — displays the client and subtype.
  The nested resources below are managed through their dedicated endpoints
  rather than the embedded detail arrays.
- **Detail addresses** — managed through the dedicated nested
  endpoints (`src/pages/clients/ClientAddressesSection.tsx`): the section
  fetches its own collection (own loading/error/retry states), shows every
  serializer field (street, city, region, postal code, country, type code,
  primary marker), and supports add / edit / physical delete. The form uses
  the real serializer fields — required `address_type` (from the
  `address-types` reference-data catalog, never hardcoded) and `line1`,
  optional line 2 / city / region / postal code (sent as `null` when empty),
  `country_code` (omitted when empty so the backend default applies — it is
  not nullable), and the `is_primary` flag (the backend allows only one
  primary address per client and reports a field error otherwise). Mutations
  refetch the collection; delete requires explicit inline confirmation.
- **Detail contacts** — managed through the dedicated nested endpoints
  (`src/pages/clients/ClientContactsSection.tsx`) following the same
  architecture: independent collection fetch with own loading/error/retry
  states, every serializer field shown (name, position, email, phone,
  primary marker), add / edit / physical delete. The form uses the real
  serializer fields — required `full_name`, optional `position` / `phone` /
  `email` (sent as `null` when empty; email is validated as an email
  address), and the `is_primary` flag (one primary contact per client,
  backend field error otherwise). No reference data is involved. Mutations
  refetch the collection; delete requires explicit inline confirmation.
- **Detail bank accounts** — managed through the dedicated nested endpoints
  (`src/pages/clients/ClientBankAccountsSection.tsx`) following the same
  architecture: independent collection fetch with own loading/error/retry
  states, every serializer field shown (bank name, IBAN, currency code,
  default marker), add / edit / physical delete. The form uses the real
  serializer fields — optional `bank` (from the `banks` reference-data
  catalog, sent as `null` when unset), required `currency` (from the
  `currencies` catalog), required `iban` (unique per client, backend field
  error otherwise), optional `swift_bic`, and the `is_default` flag (one
  default account per client, backend field error otherwise). Mutations
  refetch the collection; delete requires explicit inline confirmation.
  All three nested-resource areas (addresses, contacts, bank accounts) are
  now implemented.
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
| `PATCH /api/document-templates/:id/` | partial metadata update (200) | `updateTemplate(id, input)` |
| `DELETE /api/document-templates/:id/` | **soft-delete** (204) | `deleteTemplate(id)` |
| `GET /api/document-templates/:id/file/` | authenticated file download (binary) | `downloadTemplateFile(id)` |
| `POST /api/document-templates/:id/file/` | upload / replace the `.docx` (201) | `uploadTemplateFile(id, file)` |
| `DELETE /api/document-templates/:id/file/` | remove the file (204) | `deleteTemplateFile(id)` |
| `GET /api/document-templates/:id/versions/` | version list | `listTemplateVersions(id)` |
| `GET /api/document-templates/:id/versions/:vid/` | **version detail** | `getTemplateVersion(id, vid)` |
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
  file download** button, an **Edit metadata** action, an upload/replace form,
  version creation, and the version history. The backend returns 404 for both
  missing and cross-tenant templates, so both render one safe "Template not
  found" state. After a successful metadata edit the detail page refetches the
  template from the backend and shows a confirmation notice. Detail and version
  fetches are sequence-guarded so a stale in-flight response can never
  overwrite newer template state when navigating between templates.
- **Edit** (`/templates/:templateId/edit`) — pre-filled PATCH form for the real
  writable metadata fields (`name`, `document_type` from the reference-data
  catalog, `is_active`); everything else (template ID, current file,
  timestamps) is shown as read-only information and file uploads stay on the
  detail page. The company is never sent. On success the app returns to the
  detail page, which reloads the metadata from the backend.
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
- **Remove file** — the detail page shows a **Remove file** action only when
  the backend reports a current file (`file` non-null). It requires an
  explicit inline confirmation ("Remove the current file? The template itself
  stays." → **Yes, remove file** / **Cancel**; cancel sends no request) and
  calls `DELETE /api/document-templates/:id/file/` (204, empty body — the
  backend clears the database reference and deletes the stored file; the
  template row itself is untouched). While removal is in flight the action is
  disabled and duplicate DELETEs are prevented. On success the detail is
  refetched from the backend (source of truth), a confirmation notice appears,
  the file info/download/remove actions disappear, and the upload form stays
  available for a replacement (`has file → remove → no file → upload`).
  Failures (403 / 404 no-file / 429 with `Retry-After` / generic) keep the
  existing file state visible with the action available for retry. Detail and
  version refreshes are id-guarded so a late removal outcome can never
  overwrite a newer template after navigation.
- **Delete** — soft-delete with an explicit inline confirmation step; after
  success the app returns to the template list. (Removing just the *file* — not
  the row — is the `DELETE .../file/` operation surfaced as the **Remove file**
  action described above.)
- **Versioning** — `POST .../versions/` snapshots the template's **current
  file** as a new immutable version (the new version becomes the active one, as
  the backend contract dictates — the frontend does not invent this). Version
  activation uses the dedicated `.../versions/:vid/activate/` endpoint after an
  explicit confirmation step, then refetches the versions so the single-active
  invariant always reflects the server. A failed version section never takes
  down the rest of the page.
- **Version detail** (`/templates/:templateId/versions/:versionId`) — a
  strictly read-only page showing the backend `TemplateVersionSerializer`
  fields (version number, active status, file basename, file-stored flag,
  checksum, creator, created date, version/template IDs) fetched via
  `GET /api/document-templates/:id/versions/:vid/`. Every version-history row
  on the template detail page links there ("View details") without disturbing
  activation or the other file/version actions. The lookup is tenant-scoped
  and constrained to the parent template, so missing, cross-tenant, or
  mismatched versions render one safe "Version not found" state; 403 / 429 /
  generic failures render the existing safe error states with retry. The page
  issues no PATCH/POST/DELETE and offers no file download (the backend
  exposes no version-file download — only the template's current file is
  downloadable from the template detail page).
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
| `POST /api/generated-documents/` | **create** a document (201, draft) — retained API, no longer used by the form | `createGeneratedDocument(input)` |
| `POST /api/generated-documents/generate-from-input/` | **atomic Generate**: create + DOCX + PDF in one transaction (201) | `generateDocumentFromInput(input)` |
| `POST /api/generated-documents/preview/` | **non-persistent PDF preview** (200, `application/pdf`) | `previewGeneratedDocument(input)` |
| `POST /api/generated-documents/:id/generate/` | **generate DOCX** (201, synchronous) | `generateDocumentDocx(id)` |
| `POST /api/generated-documents/versions/:versionId/generate-pdf/` | **generate PDF** (synchronous) | `generateGeneratedDocumentPdf(versionId)` |
| `GET /api/generated-documents/:id/versions/` | version list (`storage.docx`/`storage.pdf`) | `listGeneratedDocumentVersions(id)` |
| `GET /api/generated-documents/versions/:versionId/docx/` | **authenticated DOCX download** | `downloadGeneratedDocumentDocx(versionId, fallback)` |
| `GET /api/generated-documents/versions/:versionId/pdf/` | **authenticated PDF download** | `downloadGeneratedDocumentPdf(versionId, fallback)` |

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
- Each row's document number links to `/documents/:documentId`, and a
  "New document" action (also in the empty state) links to `/documents/new`.
- Each row also loads its versions (`GET /api/generated-documents/:id/versions/`,
  the existing endpoint) and shows **file actions** for already-generated
  documents: **View** (links to `/documents/:documentId?view=pdf`), **Download
  DOCX**, and **Download PDF** — driven by the version's real
  `storage.docx`/`storage.pdf` booleans. Rows without generated files show
  "No generated files"; a failed version lookup shows a safe per-row error with
  a Retry action. Downloads reuse the authenticated version endpoints and never
  regenerate the document.

### Viewing and downloading generated files

Once a document is generated, its files stay accessible without regenerating:

- **View** — the Documents list's **View** link (or the detail page's **View
  PDF** button) opens the detail page's in-app PDF viewer: the stored PDF is
  fetched through `GET /api/generated-documents/versions/:versionId/pdf/` (the
  authenticated, tenant-scoped endpoint), turned into a temporary `blob:` URL,
  and rendered in a native `<iframe>`. The viewer has loading, error/retry
  (404 → "file is no longer available", 403 → permission, 429/5xx → safe
  messages) and a **Close viewer** action; the object URL is revoked on close,
  on a newer request, and on unmount. Opening via `?view=pdf` auto-opens the
  viewer once the version list is loaded. Never `/media/...`, never a token in
  a URL, never a storage path.
- **Download DOCX / Download PDF** — available on both the list and the detail
  page. They reuse the existing authenticated `.../versions/:versionId/docx/`
  and `.../versions/:versionId/pdf/` endpoints and stream the stored bytes as a
  download with the backend's `Content-Disposition` filename. They never call a
  generation endpoint, never create a document/version, and never change state.

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
retry action. No `company_id` is ever sent.

### DOCX and PDF generation/download (`/documents/:documentId`)

The backend stores a generated DOCX (and an optional PDF conversion) on a
**GeneratedDocumentVersion** (not on the document row), so the detail page also
fetches `listGeneratedDocumentVersions(id)` (`GET /api/generated-documents/:id/versions/`)
and exposes a "Generated file" section using the actual version state
(`storage.docx` / `storage.pdf`):

| Backend endpoint | Operation | API module fn |
|---|---|---|
| `POST /api/generated-documents/:id/generate/` | **generate a DOCX** (201, **synchronous**) | `generateDocumentDocx(id)` |
| `GET /api/generated-documents/versions/:versionId/docx/` | **authenticated DOCX download** | `downloadGeneratedDocumentDocx(versionId, fallback)` |
| `POST /api/generated-documents/versions/:versionId/generate-pdf/` | **generate a PDF** from a DOCX version (**synchronous**) | `generateGeneratedDocumentPdf(versionId)` |
| `GET /api/generated-documents/:id/versions/` | version list (`storage.docx`/`storage.pdf`) | `listGeneratedDocumentVersions(id)` |
| `GET /api/generated-documents/versions/:versionId/pdf/` | **authenticated PDF download** | `downloadGeneratedDocumentPdf(versionId, fallback)` |

- **DOCX generation** is synchronous: `POST .../generate/` renders and persists a
  DOCX and returns the created `GeneratedDocumentVersion` (no polling needed).
  Regenerating creates a new version. The detail page's "Generate DOCX" button
  appears when no version has a DOCX, disables while in flight (no duplicate
  requests), shows the backend result (`DOCX generated as version N.`), and then
  re-fetches the versions so the button flips to "Download DOCX".
- **PDF generation** converts an already-generated DOCX *version* to PDF:
  `POST .../versions/:versionId/generate-pdf/` runs synchronously (no body, no
  polling) and returns the same version with `storage.pdf` true. It appears as
  "Generate PDF"/"View PDF"/"Download PDF" driven by the version's real
  `storage.pdf` state, with its own loading state that does not block the DOCX
  actions. A 503 (LibreOffice runtime unavailable) or 400 (conversion failure)
  is surfaced as a safe message.
- **View PDF** (when a PDF exists) opens the in-app viewer described above —
  it fetches the stored PDF through the authenticated endpoint, renders it in a
  native `<iframe>` from a temporary `blob:` URL, and supports loading /
  close / retry with the object URL revoked when no longer needed.
- **Downloads** use the version-based authenticated endpoints via the shared API
  client's `raw` (bearer-token) capability — never `/media/...`, never a token
  in a URL, never a storage path. The `Blob` is saved with the filename from the
  response's `Content-Disposition` (backend returns
  `<document_number>-v<version_number>.docx/.pdf`), falling back to a
  document-based name. The temporary object URL is revoked after use.
- Errors: 403 → safe permission message, 404 → file unavailable, 429 → respects
  `Retry-After`, 5xx (and the PDF-specific 503) → safe message; generation and
  download failures never render binary or raw server content. DOCX and PDF
  loading states are independent.

### Creating a document (`/documents/new`)

`DocumentCreatePage` (`src/pages/documents/`) offers a **Preview / Generate**
workflow. The form state stays entirely local — opening the page, filling
fields, abandoning the form, or failing validation sends no request and
creates no persistent draft. `company_id` is never sent; the backend derives
the tenant from the authenticated user.

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

#### Preview (non-persistent)

**Preview** posts the current form state to the authenticated
`POST /api/generated-documents/preview/` endpoint, which renders the selected
company template with the real generation pipeline (same context builder,
placeholder engine, and DOCX → PDF converter as Generate) and returns the PDF
bytes. The page turns those bytes into a temporary `blob:` URL shown in a
native `<iframe>` — the user sees the actual layout/tables/placeholders, never
an HTML approximation and never a `/media/...` URL.

Preview is completely non-persistent: no `GeneratedDocument`, version, line
item, audit event, or stored file is created, and no document number is
consumed (the preview renders the provisional number `PREVIEW`). A preview
reflects a specific form state: changing any relevant input (client, document
type, currency, or any line-item field) clears and revokes the stale preview
and requires Preview to be clicked again. Preview errors (invalid data, no
active template/version, invalid placeholders, PDF conversion unavailable, 403/
404/429/5xx) render separately from Generate errors and leave nothing behind.

#### Generate (persistent)

**Generate** posts to the real atomic
`POST /api/generated-documents/generate-from-input/` endpoint using the same
form fields. The backend creates the document (status `generated`, version 1
with DOCX + PDF) in one transaction; a failure leaves no document, version,
number, or files behind. Generate disables the button, prevents duplicate
POSTs (exactly one request per generation), and on success navigates to the
created document's detail page using the document id returned by the backend.
On failure the form stays open with the backend message and navigates nowhere.
Backend field errors render next to the matching control, nested line-item
errors render on the offending row, and `detail` messages (e.g. missing active
template) render as a form-level message.

## Audit logs

`/audit-logs` (`src/pages/auditLogs/`) is a read-only audit history backed by
the existing Django `audit_logs` API — the company is always the
authenticated user's company (the frontend never sends `company_id`).

| Backend endpoint | Operation | API module fn |
|---|---|---|
| `GET /api/audit-logs/` | paginated list (`{ count, next, previous, results }`, newest first) | `listAuditLogs({ page?, page_size?, action?, entity_type?, entity_id?, user_id?, created_after?, created_before? })` |

- The list shows the fields the backend `AuditLogSerializer` actually
  returns: `created_at` (UTC, displayed as `YYYY-MM-DD HH:mm UTC` with an
  explicit zone label and a table caption stating newest-first/UTC),
  `action`, `entity_type` + `entity_id`, `user_id` (`User #<id>`, `—` when
  the user was deleted), `ip_address`, and `request_id` (visually truncated
  with the full value kept in the `title`). `previous_values` / `new_values`
  / `user_agent` are row payloads, not list columns, so they are not shown.
- **Filtering** maps 1:1 to the backend `AuditLogQuerySerializer` (the only
  accepted keys, all composable and tenant-scoped): exact-match `action` and
  `entity_type` (free-form text inputs — the backend defines no fixed
  choices), integer `entity_id` / `user_id`, and the `created_after`
  (`created_at >=`) / `created_before` (`created_at <=`) timestamp bounds
  (`datetime-local` inputs). There is **no** backend free-text search and no
  ordering parameter, so none is shown. Non-numeric IDs are omitted from the
  request instead of being sent; backend rejections that remain reachable
  (e.g. `created_after` later than `created_before` → 400) surface through
  the normal error state.
- Filter typing is debounced (250 ms, same as the client search) so typing
  does not fire a request per keystroke; one filtered request fires per
  change set. Filters live in the URL (`?action=&entity_type=&entity_id=&
  user_id=&created_after=&created_before=`, refresh / back-forward safe):
  changing a filter resets to page 1, paging keeps the active filters, and a
  **Clear filters** action (in the filter bar and in the filtered empty
  state) removes all filter parameters and reloads the unfiltered list.
- A filtered search with zero hits shows "No audit logs match your filters."
  (distinct from the unfiltered "No audit logs found."). A failed filtered
  request shows the normal error state with retry and keeps the filter values
  in place.
- **Pagination** follows the backend's `PageNumberPagination` contract
  (default size 50, max 100): Previous/Next buttons are driven by the
  envelope's `previous`/`next` presence, the total comes from `count`, and the
  current page is kept in the URL (`?page=`, omitted for page 1) so refresh /
  back-forward preserve the state. An out-of-range page is a backend 404 and
  renders a safe not-found state with a "Back to first page" action.
- States: loading (no fake rows/counts, plus an inline indicator while
  changing pages), empty ("No audit logs found."), and safe error states with
  a retry action — 403 a safe access-denied message (the backend owns the
  `audit_logs.read` permission check), 429 a friendly retry message, other
  failures a generic message. 401 is handled by the existing refresh flow.
- Read-only: no create/edit/delete/detail/export actions exist;
  advanced filtering beyond the six backend-supported parameters is a later
  step.
- Accessibility/responsive notes: every filter has an associated label, the
  filter form has an accessible name, loading indicators use `role="status"`,
  the table has a screen-reader caption, pagination buttons use `disabled`
  (not color alone), and the table scrolls horizontally inside its container
  on narrow screens instead of breaking the layout.

### Audit Log detail — backend-blocked

There is intentionally **no** `/audit-logs/:auditLogId` route and no
`getAuditLog()` API function: the backend exposes only the list endpoint
(`GET /api/audit-logs/`) and no retrieve/detail endpoint or detail
serializer, so a detail page would have nothing real to fetch. Audit rows do
not link anywhere. This stays blocked until the backend adds a real
tenant-scoped retrieve endpoint.

## API client

`src/api/client.ts` is the single HTTP entry point: GET/POST/PUT/PATCH/DELETE,
JSON and FormData bodies, automatic bearer-token header, 401 → refresh → retry
once, and conversion of every failed response into a typed `ApiError` (status,
payload, `fieldErrors`, `Retry-After`, safe message). `apiClient.raw` returns
the unparsed `Response` for authenticated binary downloads — it still carries
the bearer token and the same refresh/error handling. Small modules built on it
for the dashboard and features: `src/api/clients.ts`, `src/api/templates.ts`,
`src/api/documents.ts`, `src/api/auditLogs.ts`, `src/api/referenceData.ts`.

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
/templates/:templateId/edit → edit template metadata (protected, inside AppShell)
/templates/:templateId/versions/:versionId → template version detail (protected, inside AppShell)
/documents     → generated document list (protected, inside AppShell)
/documents/new → create generated document (protected, inside AppShell)
/documents/:documentId → generated document detail (protected, inside AppShell)
/audit-logs    → audit log list (protected, inside AppShell)

/admin/login            → System Admin sign-in (outside the admin guard)
/admin                  → redirects to /admin/dashboard (AdminRoute)
/admin/dashboard        → admin landing page (AdminRoute, inside AdminShell)
/admin/companies        → company list (AdminRoute, inside AdminShell)
/admin/companies/new    → provision a company + its initial administrator
/admin/companies/:companyId       → company detail (edit / activate / deactivate)
/admin/companies/:companyId/edit  → edit company metadata
/admin/users            → user list (AdminRoute, inside AdminShell)
/admin/users/:userId    → user detail (edit / activate / deactivate / roles)
/admin/users/:userId/edit → edit user metadata
/admin/roles            → role list (AdminRoute, inside AdminShell)
/admin/roles/new        → create a tenant role
/admin/roles/:roleId    → role detail (permission assignment / edit)
/admin/roles/:roleId/edit → edit role name
/admin/permissions      → permission catalog (read-only)
/admin/reference-data   → placeholder section
/admin/audit            → placeholder section
/admin/backups          → placeholder section
/admin/settings         → placeholder section
*              → not found
```

Route protection is UX-only; the Django backend remains the authoritative
authorization and tenant-isolation boundary. The company CRM and the System
Admin panel are **independent surfaces**: separate auth contexts, separate
token storage, and separate route guards.

## System Admin panel

The System Admin panel is a separate frontend surface under `/admin`, backed by
the Django admin API (`apps/system_admin`). It is additive: the company
`AuthContext`, `ProtectedRoute`, `/login`, and company token storage are
untouched.

### Backend admin API dependency

All Admin requests go through `/api/admin/` (see
`docs/architecture/ADR-system-admin.md`):

| Endpoint | Purpose |
|---|---|
| `POST /api/admin/authentication/token/` | `{ email, password }` → `{ access, refresh }` (no company id) |
| `POST /api/admin/authentication/token/refresh/` | `{ refresh }` → `{ access }` |
| `GET /api/admin/authentication/me/` | Admin identity + `scope` + system `permissions` |

The backend is authoritative: `/admin/*` requires `IsSystemAdmin` (a valid
`scope=system_admin` token plus a system-scoped RBAC role), and every future
admin endpoint will additionally require a specific `system.*` permission. The
frontend only mirrors this for UX.

### Admin authentication (separate from company auth)

- `AdminAuthProvider` (`src/contexts/AdminAuthContext.tsx`, context in
  `admin-auth-context.ts`) exposes `status`, `admin`, `permissions`,
  `hasPermission(code)`, `login`, `logout`.
- It bootstraps from `GET /api/admin/authentication/me/` using the **Admin**
  access token; a company token cannot initialize it.
- Admin tokens are stored under their own keys
  (`src/utils/adminAuthStorage.ts`: `grm_crm.admin_access_token`,
  `grm_crm.admin_refresh_token`) — distinct from the company keys, so the two
  sessions can never overwrite one another. Only tokens are persisted; identity
  and permissions are re-fetched from `/me`.
- `adminApiClient` (`src/api/adminClient.ts`) targets `/api/admin/`, attaches
  only the Admin bearer token, and performs a single-flight Admin refresh on
  401 (retry once), then clears Admin tokens and notifies the provider. It
  shares the typed `ApiError` behavior with the company client but never falls
  back to company auth.
- `AdminRoute` (`src/router/AdminRoute.tsx`) guards `/admin/*`; unauthenticated
  visitors (including company-authenticated users) go to `/admin/login`.
  `RedirectIfAdminAuthenticated` sends an authenticated Admin from
  `/admin/login` to `/admin/dashboard`.
- Admin logout clears only the Admin session; company logout likewise never
  touches the Admin session.

### Admin layout and permission-aware navigation

`AdminShell` (`src/components/layout/AdminShell.tsx`) provides the responsive
sidebar/overlay, a header with the Admin identity, and a sign-out action,
mirroring `AppShell`. Navigation is filtered by the Admin's actual system
permissions:

| Section | Route | Required system permission |
|---|---|---|
| Dashboard | `/admin/dashboard` | — |
| Companies | `/admin/companies` | `system.companies.manage` |
| Users | `/admin/users` | `system.users.manage` |
| Roles & Permissions | `/admin/roles` | `system.roles.manage` |
| Permission Catalog | `/admin/permissions` | `system.roles.manage` |
| Reference Data | `/admin/reference-data` | `system.reference.manage` |
| Audit & Security | `/admin/audit` | `system.audit.read` |
| Backups | `/admin/backups` | `system.backups.manage` |
| Settings | `/admin/settings` | `system.settings.manage` |

Sections the Admin lacks a permission for are hidden from navigation, and their
placeholder page shows a safe "no access" notice. This is UX only — the backend
enforces authorization.

### Admin company management (implemented)

Company management is the first fully implemented Admin section. It is backed by
the System Admin company API (`apps/system_admin/api/`) — entirely separate from
the tenant company APIs and gated by the `system.companies.manage` system
permission:

| Backend endpoint | Operation | API module fn |
|---|---|---|
| `GET /api/admin/companies/` | global company list | `listAdminCompanies()` |
| `GET /api/admin/companies/:id/` | company detail | `getAdminCompany(id)` |
| `POST /api/admin/companies/provision/` | provision company + initial administrator | `provisionAdminCompany(input)` |
| `PATCH /api/admin/companies/:id/` | update editable metadata | `updateAdminCompany(id, input)` |
| `POST /api/admin/companies/:id/activate/` | set status `active` | `activateAdminCompany(id)` |
| `POST /api/admin/companies/:id/deactivate/` | set status `suspended` | `deactivateAdminCompany(id)` |

- **List** (`/admin/companies`, `AdminCompaniesPage`) — loading, empty, and
  error/retry states; a responsive table with company / VOEN / status / type /
  created columns and a link to each detail. Real API data only (no fabricated
  counts). The **New company** action is hidden without
  `system.companies.manage`.
- **Provision** (`/admin/companies/new`, `AdminCompanyCreatePage`) —
  `POST .../provision/` collects the new company's details plus its initial
  administrator's email and password. Validation distinguishes field errors
  (e.g. duplicate VOEN, weak password) from business/API failures. The initial
  password is transient form state only — never persisted to storage, never put
  in the URL, and the page navigates to the new company's detail on success.
- **Detail** (`/admin/companies/:companyId`, `AdminCompanyDetailPage`) — shows
  the real serializer fields and status badge, links to edit, and offers
  **Activate** / **Deactivate** (deactivate requires an inline confirmation).
  Status transitions are never inferred on the client — the backend response is
  authoritative. The reserved platform company shows a note and offers no
  management actions.
- **Edit** (`/admin/companies/:companyId/edit`, `AdminCompanyEditPage`) —
  `PATCH` form for the backend-approved editable fields (`legal_name`,
  `display_name`, `voen`, `registration_number`, `default_language`,
  `default_timezone`). `status` and `is_platform` are not editable here, and the
  platform company cannot be edited.
- **Provisioning is atomic** on the backend: the company, its company-scoped
  administrator role (holding the tenant permission catalog), the initial user,
  and the platform audit event are created in one transaction; a failure rolls
  everything back. The operation never creates a second platform company or
  assigns a system-scoped role.

### Admin user management (implemented)

Global management of ordinary tenant users across all companies, backed by the
System Admin user API (`apps/system_admin/user_management.py` /
`apps/system_admin/api/user_serializers.py`) and gated by the
`system.users.manage` system permission:

| Backend endpoint | Operation | API module fn |
|---|---|---|
| `GET /api/admin/users/` | global user list | `listAdminUsers()` |
| `GET /api/admin/users/:id/` | user detail (+ assignable company roles) | `getAdminUser(id)` |
| `PATCH /api/admin/users/:id/` | update `first_name` / `last_name` / `email` | `updateAdminUser(id, input)` |
| `POST /api/admin/users/:id/activate/` | activate | `activateAdminUser(id)` |
| `POST /api/admin/users/:id/deactivate/` | deactivate | `deactivateAdminUser(id)` |
| `GET /api/admin/users/:id/roles/` | list assigned roles | `listAdminUserRoles(id)` |
| `POST /api/admin/users/:id/roles/` | assign a tenant role | `assignAdminUserRole(id, roleId)` |
| `DELETE /api/admin/users/:id/roles/:roleId/` | remove a tenant role | `removeAdminUserRole(id, roleId)` |

- **List** (`/admin/users`, `AdminUsersPage`) — loading, empty, and error/retry
  states; a responsive table with user (name + email), company, active status,
  and assigned roles. Real API data only (no fabricated counts).
- **Detail** (`/admin/users/:userId`, `AdminUserDetailPage`) — identity,
  company, active status, timestamps, assigned tenant roles, an **Edit
  metadata** link, **Activate/Deactivate** (deactivate requires an inline
  confirmation), and the tenant-role assignment controls.
- **Edit** (`/admin/users/:userId/edit`, `AdminUserEditPage`) — `PATCH` form for
  `first_name`, `last_name`, and `email`. Company, password, MFA state,
  lifecycle, and System Admin scope are never editable; a user cannot be moved
  between companies. Email uniqueness is per company (the backend enforces the
  existing company-scoped constraint).
- **Role assignment** — the detail page lists the user's assigned tenant roles
  (with **Remove**) and offers the user's company's remaining tenant roles in an
  **Add role** picker. System roles, global role templates, and other
  companies' roles are rejected by the backend and are never offered. The
  frontend filtering is UX only; the backend is authoritative.
- **System Admin protection** — accounts in the reserved platform company are
  a separate principal. They are excluded from the user list and return 404
  from every user-management endpoint, so a System Admin account can never be
  edited, activated/deactivated, or have tenant roles assigned/removed here.

### Admin roles & permissions (implemented)

RBAC administration backed by `apps/system_admin/role_management.py` and
`apps/system_admin/api/role_serializers.py`, gated by the `system.roles.manage`
system permission:

| Backend endpoint | Operation | API module fn |
|---|---|---|
| `GET /api/admin/permissions/` | permission catalog (`?scope=tenant\|system`) | `listAdminPermissions(params)` |
| `GET /api/admin/roles/` | role list (`?scope=`, `?company_id=`) | `listAdminRoles(params)` |
| `POST /api/admin/roles/` | create a **tenant** role | `createAdminRole(input)` |
| `GET /api/admin/roles/:id/` | role detail (+ assignable permissions) | `getAdminRole(id)` |
| `PATCH /api/admin/roles/:id/` | rename a tenant role | `updateAdminRole(id, input)` |
| `GET /api/admin/roles/:id/permissions/` | list assigned permissions | `listAdminRolePermissions(id)` |
| `POST /api/admin/roles/:id/permissions/` | assign a tenant permission | `assignAdminRolePermission(id, pid)` |
| `DELETE /api/admin/roles/:id/permissions/:pid/` | remove a permission | `removeAdminRolePermission(id, pid)` |

**Scope model (tenant vs system).** Roles and permissions carry an explicit
`scope`:

- **Tenant** roles (`scope=tenant`) — global templates (`company=NULL`) and
  company-specific roles — are the ordinary CRM RBAC domain. They may only
  receive **tenant-scoped** permissions. Company-specific roles are listed with
  their company; global templates show "Global template".
- **System** roles (`scope=system`) are the platform-administration domain. The
  reserved `System Admin` role is **protected**: it is listed and its
  permissions are shown read-only, but it cannot be renamed, deleted, or have
  permissions mutated through this UI/API.

The two scopes are never mixed. A tenant role cannot receive a system
permission (rejected with a 400, and blocked by the database trigger
`trg_role_permission_scope_match`), and system roles cannot be mutated.

- **Permission catalog** (`/admin/permissions`, `AdminPermissionsPage`) — a
  **read-only** list of the application-defined catalog (code, description,
  scope) with a `scope` filter. There is no permission create/delete; the
  System Admin manages *role → permission assignments*, not the capability
  definitions.
- **Role list** (`/admin/roles`, `AdminRolesPage`) — all roles with scope,
  company (or "Global template" / "Platform (protected)"), and permission
  count; filters by `scope` and `company_id` are kept in the URL.
- **Create tenant role** (`/admin/roles/new`, `AdminRoleCreatePage`) — choose a
  tenant company (the platform company is never offered) and a name. The
  backend always creates a `scope=tenant` role; a client cannot request system
  scope. Permissions are assigned afterwards on the detail page.
- **Role detail** (`/admin/roles/:roleId`, `AdminRoleDetailPage`) — identity,
  scope, company, creation date, and permissions. For tenant roles it offers
  permission assignment (an **Add permission** picker limited to tenant
  permissions) and removal. For system roles it shows a protected notice and
  **no** mutation controls.
- **Edit role** (`/admin/roles/:roleId/edit`, `AdminRoleEditPage`) — renames a
  tenant role only. `scope` and `company` are immutable; system roles cannot be
  edited.
- **Platform company protection** — a tenant role can never be created for the
  platform company, and a role's `company` can never be changed through the
  API.
- Frontend filtering (tenant-only roles/permissions, no platform company) is UX
  only; the backend is authoritative and enforces every rule.

### Current status

Companies, Users, and Roles & Permissions are implemented as above. The
remaining Admin sections (Reference Data, Audit & Security, Backups, Settings)
are **placeholder pages** that state their functionality arrives in a later
phase. There are no fabricated dashboard statistics.

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
the templates + reference-data API modules (methods, bodies, partial PATCH
update incl. validation-error surfacing, version detail GET, file-removal
DELETE incl. 204/404/403 propagation, FormData upload,
query params, binary download), the template list (loading / data / empty /
error/retry / document-type filter / navigation), the create form (fields,
validation, success, backend errors, duplicate-submission guard, redirect), the
detail page (metadata, active version, version history, empty versions, 404 /
403 / 5xx, upload incl. `.docx` validation and backend errors, authenticated
  download with filename handling, create/activate version incl. in-flight
  activation state and activation error, file removal (confirm/cancel,
  single-DELETE guard, refresh + success notice, no-file state, 403 / 404 /
  429 / generic errors with preserved state and retry, stale-outcome guard),
  delete confirmation, edit-metadata link
+ post-edit confirmation notice, stale-response protection when navigating
between templates), the edit page (pre-filled metadata, read-only information,
required-field validation, PATCH body incl. no `company_id`, success redirect
to the detail page, cancel without saving, duplicate-submission guard,
backend field / generic / 403 / 404 / 429 errors with preserved values,
load-error retry, stale-response protection), the version detail page
(read-only serializer fields incl. absent-file fallbacks, loading, 403 / 404 /
429 / generic error + retry, invalid ids without fetching, back navigation,
stale-response protection, no-mutation guarantee, opening from the template
detail version list alongside the untouched activation action), and the generated
 documents slice: the documents API module (endpoint, no query params, detail,
 create payload incl. no `company_id`, atomic generate-from-input request +
 failure mapping, typed errors), the reference-data
 currency API, the documents list page (loading, data rendering, count, empty
 state, error/retry, no invented search/filter/pagination controls, detail
 links), the create page (loading, per-dependency errors + retry, client /
 document-type / currency options, only document types with an active template,
 line-item add/edit/remove and submission, form validation, no request before
 Generate, exactly one atomic request, successful generation + redirect to the
 created detail page, generation failure without navigation, list → create /
 create → detail / list → detail / detail → list navigation,
 duplicate-submit prevention, backend field / nested line-item / non-field
errors, cancellation), preview (no preview request before clicking Preview,
 exactly one authenticated preview POST with the current form state, `blob:`
 iframe rendering, preview failure without navigation or Generate request,
 stale-preview invalidation + object-URL revocation on input changes,
 duplicate-preview prevention while in flight), the documents list file actions
 (per-row version loading, View link to `?view=pdf`, Download DOCX/PDF via the
 authenticated version endpoints with no POST/generation, per-row loading and
 error/retry, "No generated files" for drafts), the detail page
 (loading, metadata
 rendering incl. status badge and client/template links, non-numeric id, 404 /
 403 / generic error / retry, back navigation), the PDF viewer (View PDF button
 and auto-open from `?view=pdf`, authenticated PDF fetch to a `blob:` iframe,
 loading state, close + object-URL revocation, unmount revocation, 404/403/5xx
 error states, stale-request guard after closing, no generation requests),
 DOCX generation + download
(API: generate method/body/response, version list, DOCX download blob +
Content-Disposition filename + fallback + 404; page: Generate/Download button
appearance from `storage.docx`, generation loading + duplicate prevention +
success notice + state refresh + failures incl. 403/429, download loading +
successful blob download + safe failure), and PDF generation + download
(API: generate-pdf method/body/response + 503, PDF download blob + filename +
fallback + 404; page: Generate/Download PDF button appearance from
`storage.pdf`, PDF generation loading + duplicate prevention + success + state
refresh + 403/503 failures, independent DOCX/PDF loading, PDF download loading
+ success + safe failure), the audit logs slice: the audit logs API module
(endpoint, `?page=` / `?page_size=` / exact-match and timestamp-bound filter
params, envelope preservation, no `company_id`, typed errors incl. 400 for
rejected filter values), the audit logs list page (loading, data rendering,
count, empty state, error/retry, 403 access-denied, out-of-range-page 404 with
a back action, 429, pagination incl. URL state and loading during page
changes), the audit logs filters (all six backend-supported controls with
accessible labels, 250 ms debounce, URL persistence, filter-change resets
page 1, paging preserves filters, clear-filters action, filter-specific empty
state, filtered-error retry with preserved filter values, no invented
search/filter/write controls), plus protected routing for `/templates`,
`/templates/new`, `/templates/:templateId`, `/templates/:templateId/edit`,
`/templates/:templateId/versions/:versionId`, `/documents`, `/documents/new`,
`/documents/:documentId`, and `/audit-logs`.

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
 `document_templates.*` / `document_templates.version_*` permissions. The audit
 logs list requires the `audit_logs.read` backend permission; without it the
 page shows a safe access-denied state.)
- The template and client lists are not paginated (the backend returns plain
  arrays).
- The generated documents list is **not** paginated and supports **no**
  search/filter/ordering parameters (the backend returns a plain array, newest
  first, with no query parameters), so none are shown.
- The generated-document list and detail serializers expose only `client_id`
  and `template_id` (no client/template names), so those are shown as
  `Client #<id>` / `Template #<id>` links to the existing detail routes.
- The audit logs list shows no `previous_values` / `new_values` / `user_agent`
  columns (row payloads, not list columns) and no free-text search, ordering
  control, detail, or export actions — the backend supports none of these;
  filtering is limited to the six backend-accepted parameters
  (`action`, `entity_type`, `entity_id`, `user_id`, `created_after`,
  `created_before`).
- Document creation requires the company to have an **active document template
  with an active version** for the chosen document type and a currency for the
  initial version — otherwise the backend rejects creation with a clear
  `detail` message (surfaced by the create form).
- Document editing, deletion, regeneration (a dedicated UI action) and version
  management are not implemented — later Generated Documents phases. DOCX
  generation requires the document's template to have an **active version with a
  file**; PDF generation additionally requires an already-generated DOCX version
  and the LibreOffice conversion runtime on the server (otherwise the backend
  returns 400/503 and the frontend surfaces the safe message).
- The DOCX/PDF files live on a document *version*; the download/generate-pdf
  endpoints need a version id, so file availability (`storage.docx` /
  `storage.pdf`) is read from the versions list. There is no line-item/totals
  view yet (the detail serializer returns none).
- Nested client resources are fully implemented: addresses, contacts, and
  bank accounts each have a dedicated managed section on the client detail
  page. Unlike client soft-delete, nested-row deletion is a physical
  child-row delete on the backend.
- The template file **remove-only** action (`DELETE .../file/`, which clears
  the current file without deleting the template) is available on the template
  detail page whenever the backend reports a current file; the upload form
  stays available afterward for a replacement.
- Version *creation* requires the template to already have a current file (the
  backend rejects it otherwise), and validates placeholders in the document's
  text — invalid/unknown placeholders are reported as a version-creation error.
- There is no registration, password reset, or account management UI.