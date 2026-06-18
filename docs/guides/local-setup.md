# Local Development Setup

This guide walks through getting the full stack running on your local machine using Docker Compose, or without Docker for rapid backend/frontend iteration.

---

## Prerequisites

- **Docker** ≥ 24 and **Docker Compose** ≥ 2.20
- **Python** 3.13 + [uv](https://github.com/astral-sh/uv) (for running the backend locally without Docker)
- **Node.js** 20 + **npm** (for running the frontend locally without Docker)

---

## Option A — Full Stack with Docker Compose (recommended)

### 1. Clone the repo

```bash
git clone <repo-url>
cd django_react_template
```

### 2. Create environment files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

The default values in `.env.example` are pre-configured to work with Docker Compose (`db` hostname, etc.). No changes are needed for local development.

### 3. Start all services

```bash
docker compose up
```

This starts:
- `db` — PostgreSQL 16 on port `5432`
- `backend` — Django dev server on `http://localhost:8000`
- `frontend` — Vite dev server on `http://localhost:5173`

### 4. Run database migrations (first time only)

In a separate terminal:

```bash
docker compose exec backend python manage.py migrate
```

### 5. Create a superuser (optional)

```bash
docker compose exec backend python manage.py createsuperuser
```

### 6. Verify

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend API: [http://localhost:8000/api/health/](http://localhost:8000/api/health/)
- Django admin: [http://localhost:8000/admin/](http://localhost:8000/admin/)
- Flower (Celery monitoring): `just flower` then open [http://localhost:5555](http://localhost:5555)

---

## Option B — Backend Only (no Docker)

### 1. Set up environment

```bash
cd backend
cp .env.example .env
# Edit .env: set DATABASE_URL to SQLite or a local Postgres instance
```

### 2. Install dependencies

```bash
uv sync
```

### 3. Run migrations and start server

```bash
uv run python manage.py migrate
uv run python manage.py runserver
```

Backend is available at `http://localhost:8000`.

---

## Option C — Frontend Only (no Docker)

### 1. Set up environment

```bash
cd frontend
cp .env.example .env
# VITE_API_BASE_URL defaults to http://localhost:8000
```

### 2. Install dependencies and start

```bash
npm install
npm run dev
```

Frontend is available at `http://localhost:5173`.

---

## Running Tests

### Backend

```bash
cd backend
uv run pytest
```

### Frontend

```bash
# Run the test suite
just fe-test
# or directly:
cd frontend && npm test

# Type-check + bundle
just fe-build
# or directly:
cd frontend && npm run build
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `db` container not ready | Wait a few seconds and retry `migrate` — Postgres takes a moment to initialise |
| Port already in use | Change the host port in `docker-compose.yml` (e.g. `"8001:8000"`) |
| `uv: command not found` | Install uv: `curl -Ls https://astral.sh/uv/install.sh \| sh` |
| Hot reload not working in Docker | Ensure the volume mount for the source directory is configured in `docker-compose.yml` |
