# GRM CRM — Frontend

Frontend application for the GRM CRM Django backend.

Implemented so far:
- **Application shell + dashboard** (Phase 3): authenticated shell (responsive
  sidebar, header, sign-out), real-data dashboard.
- **Authentication vertical slice** (Phase 2): login, token storage, `/me`
  initialization, protected routes, automatic access-token refresh, logout.
- **Technical foundation** (Phase 1): routing, Tailwind, the generic API
  client, the typed error model.
- No business features (client CRUD, template management, document
  generation/PDF UI) are implemented yet — those routes are placeholders.

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

## API client

`src/api/client.ts` is the single HTTP entry point: GET/POST/PUT/PATCH/DELETE,
JSON and FormData bodies, automatic bearer-token header, 401 → refresh → retry
once, and conversion of every failed response into a typed `ApiError` (status,
payload, `fieldErrors`, `Retry-After`, safe message). Small read-only modules
built on it for the dashboard: `src/api/clients.ts`, `templates.ts`,
`documents.ts` (no business features behind them yet).

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
/clients       → protected placeholder (inside AppShell)
/templates     → protected placeholder (inside AppShell)
/documents     → protected placeholder (inside AppShell)
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
(loading / data / empty / error / partial-failure), and the dashboard API
modules.

## Known limitations

- The backend `/me` response currently **does not** include a permissions
  field, so `permissions` is empty and `hasPermission()` returns `false` — the
  frontend grants nothing. The wiring will light up if the backend starts
  returning `permissions` on `/me`.
- Tokens are stored in `localStorage` (standard bearer-token SPA model), which
  is subject to the usual XSS caveat; httpOnly-cookie auth would be a separate
  change.
- The dashboard depends on the `clients.read`, `document_templates.read`, and
  `generated_documents.read` backend permissions; unauthorized sections show a
  safe error state rather than the data.
- There is no registration, password reset, or account management UI.