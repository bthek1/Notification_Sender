# Notification Sender

A test harness for **accurate background task execution at dynamic, user-changeable times**.

The goal of this repo is to prove out a scheduling system where a notification can be scheduled to fire at a specific time, and a user can **change that time at any point** — without restarting any process — and have the task still fire accurately at the new time. It is built on Django + Celery + [django-celery-beat](https://github.com/celery/django-celery-beat), whose database-backed scheduler re-reads schedules at runtime, making schedules editable on the fly.

- **`backend/`** — Django REST Framework API (Python 3.13, PostgreSQL) + Celery worker & beat
- **`frontend/`** — React 18 SPA (TypeScript, Vite, TanStack Router, TanStack Query)

> **Design status:** the dynamic scheduling system is currently specified in
> [docs/plans/dynamic-notification-scheduler.md](docs/plans/dynamic-notification-scheduler.md)
> and explained in [docs/explanations/dynamic-scheduling.md](docs/explanations/dynamic-scheduling.md).
> The current code provides the Celery foundation (worker, beat, result backend, Flower) and a
> generic task trigger/status API — the `notifications` app is the next build step.

---

## Why this stack

Accurate, *mutable* scheduling is the hard part. A naive `sleep`-until-fire approach breaks the moment the time changes or the process restarts. This project leans on infrastructure that already solves those problems:

| Requirement | How it's met |
|-------------|--------------|
| Fire at a precise wall-clock time | `django-celery-beat` `ClockedSchedule` (one-off) / `CrontabSchedule` (recurring) |
| Change the time at runtime, no restart | Beat uses the **DatabaseScheduler** — schedules live in Postgres and are re-read every few seconds |
| Survive worker/beat restarts | Schedules and results are persisted in the database, not in memory |
| Observe accuracy (scheduled vs actual fire time) | `django-celery-results` records every run; a `NotificationLog` row captures the delta |

See [docs/explanations/dynamic-scheduling.md](docs/explanations/dynamic-scheduling.md) for the full rationale.

---

## Quick Start

```bash
# 1. Clone
git clone <repo-url> && cd Notification_Sender

# 2. Create env files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 3. Start everything (API, worker, beat, redis, db, frontend)
docker compose up

# 4. Run migrations (first time)
docker compose exec backend python manage.py migrate
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5174 |
| Backend API | http://localhost:8005/api/ |
| Django admin | http://localhost:8005/admin/ |
| Health check | http://localhost:8005/api/health/ |
| Flower (Celery monitoring) | http://localhost:5555 (`just flower`) |

> Host ports are set in [docker-compose.yml](docker-compose.yml) (`8005` backend, `5174` frontend,
> `5435` Postgres, `6380` Redis) to avoid clashing with other local services.

---

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/plans/dynamic-notification-scheduler.md](docs/plans/dynamic-notification-scheduler.md) | **Design** for the dynamic, user-editable notification scheduler |
| [docs/explanations/dynamic-scheduling.md](docs/explanations/dynamic-scheduling.md) | **How** runtime-mutable scheduling works with django-celery-beat |
| [docs/guides/celery_setup.md](docs/guides/celery_setup.md) | Celery worker / beat / Flower setup |
| [docs/guides/local-setup.md](docs/guides/local-setup.md) | Full local dev setup (Docker + without Docker) |
| [docs/guides/onboarding.md](docs/guides/onboarding.md) | New developer orientation |
| [docs/standards/api-contracts.md](docs/standards/api-contracts.md) | All API endpoints, request/response shapes |
| [docs/explanations/architecture.md](docs/explanations/architecture.md) | Monorepo structure and design decisions |
| [docs/explanations/auth-flow.md](docs/explanations/auth-flow.md) | JWT auth flow end to end |
| [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) | Guide for AI coding agents working in this repo |

---

## Project Structure

```
/
├── backend/          Django REST API + Celery
│   ├── core/         Settings, URLs, WSGI, Celery app
│   ├── apps/         Domain applications
│   │   ├── accounts/ User model (email-based), registration, JWT auth
│   │   └── pages/    Health check + generic task trigger/status/revoke API
│   └── manage.py
├── frontend/         React SPA
│   └── src/
│       ├── api/      Axios client, query keys, API functions
│       ├── components/ui/  shadcn/ui components
│       ├── hooks/    Custom hooks (auth, task polling, etc.)
│       ├── lib/      cn() helper, date-fns wrappers
│       ├── routes/   TanStack Router file-based routes
│       ├── schemas/  Zod validation schemas
│       ├── store/    Zustand global state slices
│       └── types/    TypeScript types from API contracts
├── docs/             Project knowledge base
└── docker-compose.yml
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend language | Python 3.13 |
| Backend framework | Django 5 + Django REST Framework |
| Background tasks | Celery 5 (Redis broker) |
| Scheduling | django-celery-beat (DatabaseScheduler) — runtime-editable schedules |
| Task results | django-celery-results (`django-db` backend) |
| Task monitoring | Flower |
| Auth | JWT (`djangorestframework-simplejwt`) |
| Database | PostgreSQL 16 |
| Dependency manager | [uv](https://github.com/astral-sh/uv) |
| Frontend language | TypeScript |
| Frontend bundler | Vite |
| UI framework | React 18 |
| Routing | TanStack Router |
| Server state | TanStack Query v5 |
| HTTP client | Axios |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Forms | React Hook Form + Zod |
| Global state | Zustand |
| Testing (frontend) | Vitest + React Testing Library |
| Utilities | date-fns, Plotly.js |
| Container | Docker Compose |
| Task runner | [just](https://github.com/casey/just) |
</content>
</invoke>
