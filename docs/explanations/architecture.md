# Architecture

## Overview

This project is a **decoupled monorepo**: a Django REST Framework backend and a React SPA frontend, developed and deployed independently, communicating exclusively over HTTP. The backend is paired with a **Celery** worker and **beat** scheduler (Redis broker) that run background tasks — the core subject of this repo: firing notifications accurately at dynamic, user-changeable times.

```
┌────────────────────────────────────────────────────────────────────────┐
│                              Monorepo root                             │
│                                                                        │
│  ┌─────────────────────┐    HTTP/JSON    ┌────────────────┐            │
│  │   frontend/         │ ─────────────► │   backend/     │            │
│  │   React SPA         │ ◄──────────── │   DRF API      │            │
│  │   (Vite, TS)        │                │   (Django)     │            │
│  └─────────────────────┘                └───┬─────────┬──┘            │
│                                             │         │               │
│                                   ┌─────────▼──┐  ┌───▼──────────┐    │
│                                   │ PostgreSQL │  │    Redis     │    │
│                                   │ (data +    │  │   (broker)   │    │
│                                   │  schedules)│  └───┬──────────┘    │
│                                   └─────▲──────┘      │               │
│                                         │      ┌──────▼───────┐       │
│                            results,     │      │ Celery beat  │       │
│                            schedule     │      │ (scheduler)  │       │
│                            reads/writes │      └──────┬───────┘       │
│                                         │      ┌──────▼───────┐       │
│                                         └──────┤ Celery worker│       │
│                                                │ (runs tasks) │       │
│                                                └──────────────┘       │
└────────────────────────────────────────────────────────────────────────┘
```

`beat` reads schedules from PostgreSQL (via `django-celery-beat`'s `DatabaseScheduler`) and enqueues due tasks onto Redis; the `worker` consumes them and writes results back to PostgreSQL (via `django-celery-results`). Because schedules live in the database and beat re-reads them continuously, **a schedule's time can be changed at runtime** — no process restart required.

The two applications **share no code**. The API contract (documented in `docs/standards/api-contracts.md`) is the only interface between them.

---

## Backend Structure

```
backend/
├── core/                  Django project package
│   ├── settings/
│   │   ├── base.py        Shared settings for all environments
│   │   ├── dev.py         Development overrides (SQLite fallback, DEBUG=True)
│   │   ├── prod.py        Production overrides
│   │   └── test.py        Test runner settings
│   ├── urls.py            Root URL configuration
│   ├── wsgi.py
│   └── asgi.py
├── apps/                  All domain applications
│   ├── accounts/          User model, registration, profile
│   │   ├── models.py      CustomUser (UUID PK, extends AbstractUser)
│   │   ├── serializers.py Request/response shapes
│   │   ├── services.py    Business logic (user creation, etc.)
│   │   ├── views.py       Class-based API views
│   │   └── urls.py
│   ├── pages/             Infrastructure endpoints
│   │   ├── views.py       /api/health/ liveness + ad-hoc task trigger/status/revoke
│   │   └── tasks.py       Demo Celery tasks (add, process_data)
│   ├── notifications/     Event model + exact-time scheduling/firing tasks
│   │   ├── models.py      Event (UUID PK, scheduled_time, status, fired_at, dispatch_task_id)
│   │   ├── services.py    generate_future_events / sync_event_window / _arm_event / _disarm_event / retime_event / fire_single_event / cleanup
│   │   ├── tasks.py       generate_events / fire_event / sync_event_window_task / cleanup_fired_clocked_tasks_task
│   │   ├── signals.py     post_save re-settle clocked schedule on scheduled_time change (window-aware)
│   │   └── views.py       /api/notifications/events/ (list, detail, generate)
│   └── tasks/             Periodic-schedule management (no models of its own)
│       ├── scheduled_tasks.py   SCHEDULED_TASKS — source of truth, in git
│       ├── management/commands/sync_scheduled_tasks.py   applies it to the DB
│       └── views.py       /api/tasks/ schedules + results API
├── core/
│   └── celery.py          Celery app — autodiscovers tasks.py in each app
├── manage.py
├── pyproject.toml         Python dependencies (managed by uv)
└── .env.example
```

### Key design decisions

**One app per domain.** Each `apps/<name>/` package owns a single bounded domain. Cross-domain dependencies go through service functions, not direct model imports from another app.

**Business logic in `services.py`.** Views delegate to service functions — they never contain business rules. This keeps views thin and services testable in isolation.

**Split settings.** `base.py` contains all environment-agnostic config. Each environment file imports from `base` and overrides only what it needs. The active settings module is selected via `DJANGO_SETTINGS_MODULE`.

**UUID primary keys.** All models use `UUIDField(default=uuid4)` as the primary key to avoid exposing sequential integer IDs in the API.

**Database-backed scheduling.** Background work runs through Celery. The beat scheduler is configured with `django_celery_beat.schedulers:DatabaseScheduler` (see `CELERY_BEAT_SCHEDULER` in `core/settings/base.py`), so periodic/clocked schedules are stored as rows in PostgreSQL rather than in a static `beat_schedule` dict. This is what makes schedule times **editable at runtime**: writing to a `PeriodicTask` row (directly, via the Django admin, or via the `/api/tasks/schedules/` API) changes when a task next fires, with no restart. Periodic schedules are defined in code in `apps/tasks/scheduled_tasks.py` and applied with the `sync_scheduled_tasks` command (see [background-tasks.md](../guides/background-tasks.md)). Task results are persisted via `django-celery-results` (`CELERY_RESULT_BACKEND = "django-db"`) so every run — and its accuracy — is auditable. See [dynamic-scheduling.md](dynamic-scheduling.md).

---

## Frontend Structure

```
frontend/
├── src/
│   ├── api/
│   │   ├── client.ts      Axios instance — base URL, JWT interceptor
│   │   ├── auth.ts        Auth API call functions
│   │   ├── health.ts      /api/health/ liveness call
│   │   ├── events.ts      Notifications: list + generate events
│   │   ├── tasks.ts       Periodic schedules + ad-hoc task status
│   │   └── queryKeys.ts   Centralised TanStack Query key constants
│   ├── components/        Shared / reusable UI components
│   │   ├── ui/            shadcn/ui copy-paste components (Button, Input, Card, ThemeToggle…)
│   │   ├── charts/        EChartsChart wrapper (lazy-loaded, takes an `option`)
│   │   ├── layout/        App shell: AppLayout, Navbar, Sidebar, navItems
│   │   ├── home/          HeroBanner (public landing)
│   │   ├── events/        EventsChart (timeline), EventsTable
│   │   ├── tasks/         SchedulesTable (toggle/trigger periodic tasks)
│   │   └── TaskTrigger.tsx  Ad-hoc task trigger + status poller demo
│   ├── hooks/             Custom hooks encapsulating business logic
│   │   ├── useAuth.ts     Auth state, login, logout, current user
│   │   ├── useEvents.ts   List events + generate-events mutation
│   │   ├── useSchedules.ts  List + toggle/trigger periodic schedules
│   │   ├── useTaskPoller.ts Polls a Celery task id until terminal
│   │   └── useTheme.ts    Applies light/dark/system theme from the UI store
│   ├── lib/
│   │   ├── utils.ts       cn() helper (clsx + tailwind-merge)
│   │   └── date.ts        date-fns wrappers (formatDate, formatRelative)
│   ├── routes/            TanStack Router file-based routes
│   │   ├── __root.tsx     Root: app shell for app routes, bare Outlet for public ones
│   │   ├── index.tsx      Public landing (HeroBanner); redirects signed-in users
│   │   ├── login.tsx      Login page
│   │   ├── signup.tsx     Registration page
│   │   ├── demo.chart.tsx Dashboard / ECharts chart demo
│   │   ├── events.tsx     Events page (timeline chart + table + generate)
│   │   └── schedules.tsx  Scheduled tasks page (periodic schedule control)
│   ├── schemas/           Zod validation schemas (one file per domain)
│   │   └── auth.ts        Login and register schemas
│   ├── store/             Zustand global state (one file per concern)
│   │   ├── ui.ts          UI flags (sidebar open, theme)
│   │   └── auth.ts        Client-side auth flags
│   ├── test/
│   │   └── setup.ts       Vitest setup (jest-dom + Web Storage polyfill); MSW in test/mocks/
│   ├── types/
│   │   ├── auth.ts        Auth types matching API contracts
│   │   ├── events.ts      NotificationEvent + generate payload/response
│   │   └── tasks.ts       Schedule + task-result/status types
│   └── main.tsx           App entry point (QueryClient, RouterProvider)
├── vite.config.ts
└── package.json
```

### Key design decisions

**TanStack Router for routing.** Routes are file-based under `src/routes/`. The router generates a fully type-safe route tree. Route loaders prefetch data via the QueryClient before the component renders. The root route splits two shells: public paths (`/`, `/login`, `/signup`) render a bare `Outlet`, while every other route is wrapped in `AppLayout` (Navbar + Sidebar driven by `navItems`).

**Feature pages mirror the backend domains.** The two domain pages are the UI over the scheduling harness: `/events` lists `Event` rows as a status-split timeline chart and table and can dispatch `generate_events` on demand; `/schedules` lists the periodic `PeriodicTask` rows and can toggle or trigger them. All their data flows through `useEvents` / `useSchedules` hooks over TanStack Query — never local state.

**TanStack Query for server state.** All data fetched from the API lives in the Query cache. Components never manage async loading/error state manually — they call `useQuery` or `useMutation`.

**Axios interceptor for JWT.** A single Axios instance in `client.ts` attaches `Authorization: Bearer <token>` headers and handles silent token refresh on 401 responses. No component ever touches tokens directly.

**No business logic in components.** Components render UI. All logic (auth checks, data transformation, API calls) lives in hooks under `src/hooks/`.

**Tailwind CSS v4 + shadcn/ui for styling.** All components use Tailwind utility classes. shadcn/ui components are copied into `src/components/ui/` via `npx shadcn@latest add <component>` and never modified directly; this project uses the `base-nova` style built on `@base-ui/react` primitives (not Radix), which has no `asChild` — composition is done via the `render` prop or `useRender` hook. The `cn()` helper in `src/lib/utils.ts` (backed by `clsx` + `tailwind-merge`) handles conditional class merging.

**React Hook Form + Zod for forms.** Form schemas are defined in `src/schemas/` (one file per domain) using Zod. Components use `useForm` with `zodResolver`. shadcn/ui `Form`, `FormField`, `FormItem`, and `FormMessage` primitives wrap the RHF context.

**Zustand for global UI state.** Lightweight slices in `src/store/` (one file per concern) hold UI flags that don't belong in TanStack Query (e.g. sidebar open/close, logout-in-progress). The `immer` middleware is used for all mutations. Server-fetched data stays in TanStack Query — never in Zustand.

**Vitest + React Testing Library for tests.** Tests run in a `happy-dom` environment configured in `vite.config.ts`, with `src/test/setup.ts` loading jest-dom matchers and a Web Storage polyfill. API calls are mocked with MSW handlers under `src/test/mocks/`. Test files are co-located with the source file they test (e.g. `useAuth.test.tsx` next to `useAuth.ts`).

---

## Data Flow

### Authenticated request flow

```
Component
  └─► useQuery / useMutation
        └─► API function (src/api/)
              └─► Axios client (src/api/client.ts)
                    ├─ attaches Authorization header
                    └─► /api/<endpoint>/ (Django backend)
                              └─► DRF view
                                    └─► service function
                                          └─► Django ORM → PostgreSQL
```

### Response flows back up the same chain, populating the Query cache, which triggers React re-renders.

---

## Environment Configuration

| Variable | Where | Purpose |
|----------|-------|---------|
| `SECRET_KEY` | `backend/.env` | Django secret key |
| `DATABASE_URL` | `backend/.env` | PostgreSQL connection string |
| `DJANGO_SETTINGS_MODULE` | `backend/.env` | Which settings file to load |
| `CORS_ALLOWED_ORIGINS` | `backend/.env` | Frontend origin(s) allowed cross-origin |
| `VITE_API_BASE_URL` | `frontend/.env` | Backend base URL for Axios |

All secrets and environment-specific config live in `.env` files that are **never committed**. Use `.env.example` as the template.
