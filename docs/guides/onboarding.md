# Developer Onboarding

Welcome to the project. This guide gives you everything you need to understand the codebase and start contributing.

---

## Repository Layout

```
/
├── backend/          Django REST Framework API (Python 3.13)
├── frontend/         React SPA (TypeScript, Vite)
├── docs/             Project knowledge base
│   ├── standards/    API contracts, coding conventions
│   ├── guides/       How-to guides (setup, deployment)
│   ├── plans/        Architecture decisions, roadmaps
│   └── explanations/ Concept backgrounds, design rationale
└── docker-compose.yml  Local dev orchestration
```

Backend and frontend are **completely decoupled**. They communicate only via the HTTP API. Neither project imports code from the other.

---

## First Steps

1. **Get the stack running.** Follow [docs/guides/local-setup.md](local-setup.md) to start all services.
2. **Read the API contract.** All current endpoints are documented in [docs/standards/api-contracts.md](../standards/api-contracts.md).
3. **Understand the auth flow.** Read [docs/explanations/auth-flow.md](../explanations/auth-flow.md) — it explains how JWT tokens are obtained, stored, and refreshed.
4. **Understand the architecture.** Read [docs/explanations/architecture.md](../explanations/architecture.md) for the big picture.

---

## Backend Overview

- **Language / runtime:** Python 3.13, managed by [uv](https://github.com/astral-sh/uv)
- **Framework:** Django 5 + Django REST Framework
- **Auth:** JWT via `djangorestframework-simplejwt`
- **Database:** PostgreSQL 16 (SQLite fallback in dev)
- **Settings:** Split by environment — `core/settings/base.py`, `dev.py`, `prod.py`, `test.py`
- **Apps:** All domain apps live under `backend/apps/`

Key conventions:
- Views are class-based (`APIView`/`ViewSet`) — no function-based views
- Business logic lives in `services.py`, not in views
- Models use UUIDs as primary keys
- Config via `django-environ` — never hardcode secrets

---

## Frontend Overview

- **Language / runtime:** TypeScript, Node 20, bundled with Vite
- **Framework:** React 18
- **Routing:** TanStack Router (file-based, under `src/routes/`)
- **Server state:** TanStack Query v5 (`useQuery`, `useMutation`)
- **HTTP client:** Axios with a JWT interceptor (`src/api/client.ts`)
- **Styling:** Tailwind CSS v4 + shadcn/ui (`src/components/ui/`)
- **Forms:** React Hook Form + Zod (`src/schemas/`)
- **Global state:** Zustand with immer (`src/store/`)
- **Testing:** Vitest + React Testing Library (`just fe-test`)
- **Query keys:** Centralised in `src/api/queryKeys.ts`

Key conventions:
- Functional components only — no class components
- No business logic in components — extract to `src/hooks/`
- All API types defined in `src/types/` matching API contracts
- Zod schemas in `src/schemas/` — one file per domain
- Use `cn()` from `src/lib/utils.ts` for all conditional `className` merging
- `any` is banned — TypeScript strict mode

---

## Making Changes

### Adding a new backend endpoint

1. Identify the domain app under `backend/apps/`, or create a new one
2. Add model changes → run `python manage.py makemigrations`
3. Add serializer in `serializers.py`, business logic in `services.py`, view in `views.py`
4. Register the URL in `urls.py` and wire into `core/urls.py`
5. Update `docs/standards/api-contracts.md` with the new endpoint

### Adding a new frontend route

1. Create a file in `src/routes/` — TanStack Router auto-generates the route tree
2. Add any API call functions in `src/api/`
3. Add query keys to `src/api/queryKeys.ts`
4. Add TypeScript types to `src/types/`
5. If reusable logic is needed, extract to `src/hooks/`

### Changing the API contract

Any change to request/response shapes must be reflected in `docs/standards/api-contracts.md` as part of the same commit.

---

## Commit and Branch Conventions

- Branch names: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`
- Commit messages: imperative present tense — "Add user registration endpoint"
- Docs changes travel with code changes in the same commit

---

## Useful Commands

```bash
# Start everything
docker compose up
# or with the task runner:
just up

# Backend shell
docker compose exec backend python manage.py shell

# Run backend migrations
just be-migrate
# or directly:
docker compose exec backend python manage.py migrate

# Run backend tests
just be-test
# or directly:
cd backend && uv run pytest

# Create new migrations
just be-makemigrations

# Lint / format backend
just be-lint
just be-fmt

# Run frontend tests
just fe-test

# Frontend type check + bundle
just fe-build

# Frontend lint
just fe-lint
```
