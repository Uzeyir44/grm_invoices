# GRM CRM — Frontend

Frontend application for the GRM CRM Django backend. This is the **technical
foundation** only: routing, styling, the API client, and the typed error model.
No business functionality (auth, dashboard, clients, templates, documents) is
implemented yet.

## Stack

- React 19 + TypeScript (strict)
- Vite
- React Router
- Tailwind CSS v4
- Vitest + Testing Library (unit/integration tests)

## Setup

```bash
npm install
cp .env.example .env.local   # set VITE_API_BASE_URL to the Django API root
```

`VITE_API_BASE_URL` defaults to `/api` when unset. It is configuration, not a
secret — never put secrets in `VITE_*` variables.

## Scripts

```bash
npm run dev         # development server
npm test            # run the test suite (Vitest)
npm run lint        # lint (oxlint)
npm run typecheck   # TypeScript check (tsc -b)
npm run build       # production build (typecheck + Vite build)
npm run preview     # preview the production build
```

## Structure

```text
src/
├── api/client.ts          # single HTTP entry point (JSON + FormData, auth header)
├── components/
│   ├── layout/            # AppShell + AuthLayout (placeholder shell)
│   └── ui/                # shared UI primitives (PageContainer)
├── pages/                 # per-section placeholder pages
├── router/                # route tree
├── types/                 # typed API error model + backend contract types
├── utils/authStorage.ts   # isolated JWT access-token storage
├── App.tsx
└── main.tsx
```

The API client converts failed backend responses into a typed `ApiError`
(status, payload, field errors, `Retry-After`) so future UI code can react to
400 / 401 / 403 / 404 / 413 / 429 / 500 without parsing raw strings.