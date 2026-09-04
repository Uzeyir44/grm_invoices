# GRM CRM — Frontend

Frontend application for the GRM CRM Django backend.

Implemented so far:
- **Authentication vertical slice** (Phase 2): login, token storage, `/me`
  initialization, protected routes, automatic access-token refresh, logout.
- **Technical foundation** (Phase 1): routing, Tailwind, the generic API
  client, the typed error model. No business features (clients, templates,
  generated documents, dashboard content) are implemented yet.

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

## Authentication flow

Backed by the Django API (`apps/authentication`) with company-scoped email
logins:

1. `POST /api/authentication/token/` with
   `{ company_id, email, password }` — `company_id` is required because email is
   unique per company, not globally. Success returns `{ access, refresh }`.
2. The tokens are stored in `localStorage` (see `src/utils/authStorage.ts`) and
   the client fetches `GET /api/authentication/me/` to load the current user,
   company, and — when the backend provides them — permissions.
3. `AuthProvider` (React context, `src/contexts/AuthContext.tsx`) exposes
   `status`, `user`, `companyId`, `companyName`, `permissions`,
   `hasPermission(code)`, `login`, and `logout`.
4. `ProtectedRoute` blocks the application area while signed out and during
   initialization; an authenticated visitor on `/login` is redirected to
   `/dashboard`.

### Automatic token refresh

The API client (`src/api/client.ts`) handles expired access tokens:

- an authenticated request returning **401** triggers one refresh
  (`POST /api/authentication/token/refresh/` with the stored refresh token) and
  retries the original request exactly once;
- concurrent 401s share a single in-flight refresh request;
- if the refresh fails, both tokens are cleared, `onUnauthorized` subscribers
  (the auth context) are notified, and the user returns to `/login`;
- login/refresh requests (`auth: false`) never trigger the refresh flow.

### Logout

`logout()` clears both tokens and the in-memory auth state. There is no backend
logout/revocation endpoint, so logout is client-side only (and still works when
the backend is unreachable).

### Routes

```text
/              → redirects to /dashboard
/login         → sign-in form (company ID, email, password)
/dashboard     → protected placeholder
/clients       → protected placeholder
/templates     → protected placeholder
/documents     → protected placeholder
*              → not found
```

Route protection is UX-only; the Django backend remains authoritative for
authorization and tenant isolation.

## API client

`src/api/client.ts` is the single HTTP entry point: GET/POST/PUT/PATCH/DELETE,
JSON and FormData bodies, automatic bearer-token header, and conversion of every
failed response into a typed `ApiError` (status, payload, `fieldErrors`,
`Retry-After`, safe message). UI code reacts to 400 / 401 / 403 / 404 / 413 /
429 / 500 via the `HTTP_STATUS` constants without parsing raw strings.

## Known limitations

- The backend `/me` response currently **does not** include a permissions
  field, so `permissions` is empty and `hasPermission()` returns `false` —
  the frontend grants nothing. The wiring will light up automatically if the
  backend starts returning `permissions` on `/me`.
- Tokens are stored in `localStorage` (standard bearer-token SPA model). This
  is subject to the usual XSS caveat; moving to httpOnly-cookie auth would be a
  separate, later change.
- There is no registration, password reset, or account management UI.