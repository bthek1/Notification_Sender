# Monorepo Implementation Plan

## Overview

This plan covers the steps to migrate the current Django project into the full monorepo structure described in the Copilot instructions, including a Django REST Framework backend, a React/Vite frontend, and a `docs/` knowledge base.

---

## Current State

**Phase 1, 2, 3, 4 & 5 complete.** As of 2026-03-13:
- `backend/` is fully restructured: `core/` (settings, urls, wsgi), `apps/accounts/`, `apps/pages/`
- DRF API is live: JWT auth, `/api/accounts/`, `/api/token/`, `/api/health/` endpoints
- `django manage.py check` passes with no issues
- `frontend/` is fully scaffolded: Vite + React 18 + TypeScript, TanStack Router, TanStack Query, Axios
- Auth flow implemented: login route, JWT interceptor, silent token refresh
- `npm run build` passes (TypeScript + Vite)
- `docker-compose.yml` at repo root wiring `db`, `backend`, and `frontend` services
- `backend/Dockerfile` and `frontend/Dockerfile` created for local dev
- `docs/` fully populated: `standards/`, `guides/`, `explanations/`, `plans/`
- Root `README.md` created

---

## Target State

```
/
├── backend/
│   ├── core/                  # Django project (settings, urls, wsgi)
│   ├── apps/                  # Django apps (one per domain)
│   ├── manage.py
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── routes/
│   │   ├── types/
│   │   └── main.tsx
│   ├── vite.config.ts
│   ├── package.json
│   └── .env.example
├── docs/
│   ├── standards/
│   ├── guides/
│   ├── plans/
│   └── explanations/
├── docker-compose.yml
└── README.md
```

---

## Implementation Phases

### Phase 1 — Restructure the Backend

**Goal:** Move the existing Django project into `backend/` and align with conventions.

- [x] Create `backend/` directory
- [x] Move `manage.py` → `backend/manage.py`
- [x] Move `django_project/` → `backend/core/` (settings, urls, wsgi, asgi)
  - [x] Update `manage.py` to reference `core.settings`
  - [x] Update `wsgi.py` / `asgi.py` module paths
  - [x] Update `core/urls.py` import paths
  - [x] Update `ROOT_URLCONF` in `core/settings.py` to `core.urls`
- [x] Create `backend/apps/` directory
- [x] Move `accounts/` → `backend/apps/accounts/`
- [x] Move `pages/` → `backend/apps/pages/`
  - [x] Update `INSTALLED_APPS` in `core/settings.py` to use new paths (e.g. `apps.accounts`, `apps.pages`)
  - [x] Update all internal import paths in moved apps
- [x] `templates/` and `static/` already inside `backend/`
  - [x] Update `TEMPLATES` and `STATICFILES_DIRS` settings accordingly
- [x] Move/convert `pyproject.toml` deps → `backend/requirements.txt` (or keep `pyproject.toml`)
- [x] Create `backend/.env.example` with all required environment variables
- [x] Verify Django starts correctly: `python manage.py check`

---

### Phase 2 — Convert Backend to DRF API

**Goal:** Strip out server-rendered views and expose a pure REST API.

- [x] uv add:
  - `djangorestframework`
  - `djangorestframework-simplejwt`
  - `django-environ`
  - `django-cors-headers`
- [x] Add `rest_framework`, `rest_framework_simplejwt`, `corsheaders` to `INSTALLED_APPS`
- [x] Configure DRF default settings in `core/settings/base.py` (renderer, authentication, permissions)
- [x] Configure JWT settings (`SIMPLE_JWT` block)
- [x] Migrate settings to use `django-environ` — remove hardcoded secrets
- [x] Refactor `accounts` app:
  - [x] Replace form/template views with DRF `APIView` or `ViewSet`
  - [x] Create `accounts/serializers.py`
  - [x] Create `accounts/services.py` for business logic
  - [x] Update `accounts/urls.py` — all routes under `/api/accounts/`
  - [x] Update account models to use `UUIDField` as primary key
  - [x] Add JWT token endpoints (`/api/token/`, `/api/token/refresh/`)
- [x] Refactor `pages` app:
  - [x] Remove template views — replaced with `/api/health/` health check endpoint
- [x] Remove `templates/` and `static/` from backend (frontend will own UI)
- [x] Update root `core/urls.py` to include all API routes under `/api/`
- [x] Run and fix all migrations
- [x] Test all endpoints with a REST client

---

### Phase 3 — Scaffold the Frontend

**Goal:** Create a React/Vite/TypeScript SPA that consumes the backend API.

- [x] Scaffold frontend: `npm create vite@latest frontend -- --template react-ts`
- [x] Install dependencies:
  - `@tanstack/react-query`
  - `@tanstack/react-router`
  - `axios`
- [x] Set up project structure:
  - [x] `src/api/client.ts` — Axios instance with JWT interceptor (reads `VITE_API_BASE_URL`)
  - [x] `src/api/queryKeys.ts` — centralised query key constants
  - [x] `src/types/` — TypeScript types matching API contracts
  - [x] `src/hooks/` — custom hooks directory
  - [x] `src/components/` — shared UI components
  - [x] `src/routes/` — TanStack Router file-based routes
- [x] Configure TanStack Router with root route and basic layout
- [x] Configure TanStack Query `QueryClientProvider` in `main.tsx`
- [x] Implement auth flow:
  - [x] Login page and route (`/login`)
  - [x] JWT token storage and refresh logic in `client.ts`
  - [x] Protected route wrapper
- [x] Create `frontend/.env.example` with `VITE_API_BASE_URL`
- [x] Verify dev server runs: `npm run dev`

---

### Phase 4 — Docker Compose Integration

**Goal:** Wire backend, frontend, and database together for local development.

- [x] Update `docker-compose.yml`:
  - [x] `db` service — PostgreSQL 16
  - [x] `backend` service — build from `./backend`, run `manage.py runserver`
  - [x] `frontend` service — build from `./frontend`, run `npm run dev`
- [x] Create `backend/Dockerfile`
- [x] Create `frontend/Dockerfile`
- [x] Set `DATABASE_URL` in `backend/.env` to point to the `db` service
- [x] Set `VITE_API_BASE_URL` in `frontend/.env` to point to the `backend` service
- [ ] Test full stack: `docker compose up`

---

### Phase 5 — Docs Foundation

**Goal:** Establish the `docs/` structure and seed initial documentation.

- [x] Create `docs/standards/api-contracts.md` — document all API endpoints, request/response shapes
- [x] Create `docs/guides/local-setup.md` — step-by-step local dev setup
- [x] Create `docs/guides/onboarding.md` — new developer orientation
- [x] Create `docs/explanations/architecture.md` — explain the monorepo structure and separation of concerns
- [x] Create `docs/explanations/auth-flow.md` — explain JWT auth flow end to end
- [x] Update `README.md` at the root to reflect the new structure and link to relevant docs

---

## Definition of Done

- [ ] `docker compose up` starts all three services without errors
- [x] All backend API endpoints respond correctly and are documented in `docs/standards/`
- [ ] Frontend connects to backend, authenticates, and renders data
- [x] No hardcoded secrets anywhere — all config via env vars
- [x] All migrations are clean and tracked in version control
- [x] `docs/` is populated with at minimum: setup guide, API contract, architecture explanation
