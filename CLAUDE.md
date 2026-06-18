# CLAUDE.md

Guidance for AI coding agents (Claude Code and others) working in this repository.

## What this project is

**Notification Sender** is a test harness for **accurate background task execution at dynamic, user-changeable times**. The central problem it explores: schedule a notification to fire at time T, let a user change T at any moment, and still have the task fire accurately at the new time — with no process restart.

The mechanism is **Celery + django-celery-beat's `DatabaseScheduler`**: schedules live in PostgreSQL and beat re-reads them continuously, so they are mutable at runtime. The "send" action in this harness is intentionally simple — it writes a **log line + a `NotificationLog` DB row** (recording scheduled vs. actual fire time) rather than hitting a real channel.

- **Design spec:** [docs/plans/dynamic-notification-scheduler.md](docs/plans/dynamic-notification-scheduler.md)
- **Concept explainer:** [docs/explanations/dynamic-scheduling.md](docs/explanations/dynamic-scheduling.md)
- **Architecture:** [docs/explanations/architecture.md](docs/explanations/architecture.md)

## Layout

```
backend/   Django REST API + Celery (Python 3.13, uv, PostgreSQL, Redis)
  core/    settings/ (base|dev|prod|test), urls.py, celery.py
  apps/    accounts/ (CustomUser, JWT), pages/ (health + ad-hoc task demo)
           notifications/ (Event model + generate_events / fire_events tasks)
           tasks/ (SCHEDULED_TASKS source of truth + sync_scheduled_tasks + schedule/result API)
frontend/  React 19 SPA (Vite 8, TS, TanStack Router/Query, Tailwind v4, shadcn/base-ui, Zustand)
docs/      standards/ guides/ plans/ explanations/  — single source of truth, keep in sync
justfile   task runner — `just --list`
```

## Commands

| Task | Command |
|------|---------|
| Start everything (api, worker, beat, redis, db, frontend) | `docker compose up` |
| Backend dev server (local) | `just be-dev` |
| Backend tests / coverage | `just be-test` / `just be-test-cov` |
| Make / apply migrations | `just be-makemigrations` / `just be-migrate` |
| Sync periodic schedules from code | `just be-sync-tasks` (see [docs/guides/background-tasks.md](docs/guides/background-tasks.md)) |
| Backend lint / format | `just be-lint` / `just be-fmt` |
| Backend type check | `cd backend && uv run mypy .` |
| Scaffold a Django app | `just be-startapp <name>` |
| Celery worker / beat / Flower | see [docs/guides/celery_setup.md](docs/guides/celery_setup.md) |
| Frontend dev / build / test | `just fe-dev` / `just fe-build` / `just fe-test` |

Host ports (from `docker-compose.yml`): backend `8005`, frontend `5174`, Postgres `5435`, Redis `6380`, Flower `5555`.

## Conventions (read before editing)

The detailed, authoritative conventions live in [.github/copilot-instructions.md](.github/copilot-instructions.md) and the per-area agent guides in [.github/agents/](.github/agents/). Highlights:

**Backend**
- Endpoints prefixed `/api/`; business logic in `services.py`, serializers in `serializers.py` — never in views.
- Use `get_user_model()` — `AUTH_USER_MODEL = "accounts.CustomUser"` (email is the username; no `username` field).
- Models use UUID primary keys. Always `makemigrations` after model changes; **never** edit/delete existing migrations.
- Config via `django-environ` / `.env` — never hardcode secrets. Settings are split (`base`/`dev`/`prod`/`test`).
- Celery tasks go in each app's `tasks.py` (auto-discovered by `core/celery.py`). Schedules are DB rows (`django-celery-beat`), **not** a static `beat_schedule` dict.
- Periodic schedules are declared in code in `apps/tasks/scheduled_tasks.py` (`SCHEDULED_TASKS`) and applied to the DB with `just be-sync-tasks` (the `sync_scheduled_tasks` command) — **never** hand-edit `PeriodicTask` rows for managed tasks. `be-dev` runs the sync automatically.

**Frontend**
- Functional components only. Server state → TanStack Query; UI/global state → Zustand (never server data); routing → TanStack Router (file-based in `src/routes/`).
- All HTTP through `src/api/client.ts` (Axios + JWT interceptor). Query keys centralized in `src/api/queryKeys.ts`.
- No business logic in components — extract to `src/hooks/`. Use the `@/` import alias. Co-locate tests (`*.test.tsx`).
- Styling: Tailwind v4 (CSS-first, no config file) + shadcn `base-nova` style, built on `@base-ui/react` primitives — NOT Radix (`src/components/ui/`, added via `npx shadcn@latest add`, never hand-edited). Use `cn()` for class merging.
- Base UI has no `asChild`; compose via the `render` prop (e.g. `<Button render={<Link .../>} />`) or the `useRender` hook. Charts use `echarts` / `echarts-for-react` (lazy-loaded). Tests use Vitest + Testing Library + MSW (`src/test/mocks/`); `src/test/setup.ts` polyfills Web Storage for the current happy-dom/jsdom + Vitest combo.

**Docs & planning**
- Any feature/endpoint/architecture change updates the relevant `docs/` file in the same change.
- Non-trivial features get a phased plan in `docs/plans/<feature>.md` (Goal, Background, Phases, Testing, Risks) before implementation.

## Guardrails — never do without explicit user confirmation

- Git: `commit`, `push`, `reset --hard`, `rebase`/`merge` on shared branches, `branch -D`.
- Filesystem: `rm -rf` on non-temp dirs; deleting migration files.
- Infra: `docker compose down -v` (destroys the DB volume); editing committed `.env` files in place.
- Process: bypassing hooks (`--no-verify`); dropping/truncating DB tables directly.
</content>
