# Django + React Monorepo — Justfile
# Run `just` or `just --list` to see all available commands.

set dotenv-load := false

# Clear any shell-activated virtualenv so uv uses the project's own .venv
# (avoids "VIRTUAL_ENV does not match project environment path" warning)

export VIRTUAL_ENV := ""

# ── Default ────────────────────────────────────────────────────────────────────

# Show available commands
default:
    @just --list

# ── Docker ─────────────────────────────────────────────────────────────────────

# Start all services (db, backend, frontend)
up:
    docker compose up

# Start all services in the background
up-d:
    docker compose up -d

# Stop all services
down:
    docker compose down

# Stop all services and remove volumes
down-v:
    docker compose down -v

# Rebuild all images
build:
    docker compose build

# Rebuild a specific service: just build-svc backend
build-svc svc:
    docker compose build {{ svc }}

# Tail logs for all services
logs:
    docker compose logs -f

# Tail logs for a specific service: just logs-svc backend
logs-svc svc:
    docker compose logs -f {{ svc }}

# ── Backend ────────────────────────────────────────────────────────────────────

# Install backend dependencies (uv)
be-install:
    cd backend && uv sync --group dev

# Run the Django dev server locally
be-dev: be-makemigrations be-migrate
    cd backend && uv run python manage.py runserver 0.0.0.0:8005

# Apply database migrations
be-migrate:
    cd backend && uv run python manage.py migrate

# Create new migrations after model changes
be-makemigrations app="":
    cd backend && uv run python manage.py makemigrations {{ app }}

# Show pending migrations
be-showmigrations:
    cd backend && uv run python manage.py showmigrations

# Open the Django shell
be-shell:
    cd backend && uv run python manage.py shell

# Create a Django superuser
be-superuser:
    cd backend && uv run python manage.py createsuperuser --noinput

# Collect static files
be-collectstatic:
    cd backend && uv run python manage.py collectstatic --noinput

# Run backend test suite
be-test:
    cd backend && uv run pytest

# Run backend tests with coverage
be-test-cov:
    cd backend && uv run pytest --cov=apps --cov-report=term-missing

# Lint backend code (ruff, if available)
be-lint:
    cd backend && uv run ruff check .

# Format backend code (ruff, if available)
be-fmt:
    cd backend && uv run ruff format .

# Create a new Django app: just be-startapp myapp
be-startapp name:
    mkdir -p backend/apps/{{ name }}
    cd backend && uv run python manage.py startapp {{ name }} apps/{{ name }}

# ── Frontend ───────────────────────────────────────────────────────────────────

# Install frontend dependencies
fe-install:
    cd frontend && npm install

# Run the Vite dev server locally
fe-dev:
    cd frontend && npm run dev -- --host 0.0.0.0 --port 5174

# Build the frontend for production
fe-build:
    cd frontend && npm run build

# Preview the production build
fe-preview:
    cd frontend && npm run preview

# Lint frontend code
fe-lint:
    cd frontend && npm run lint

# Run frontend tests
fe-test:
    cd frontend && npm test

# Run frontend tests in watch mode with Vitest UI
fe-test-ui:
    cd frontend && npm run test:ui

# ── Dev ────────────────────────────────────────────────────────────────────────

# Install all dependencies (backend + frontend)
install: be-install fe-install

# Start the db container if not already running
db-up:
    @docker compose ps --status running db | grep -q db \
        && echo "DB already running." \
        || (echo "Starting DB..." && docker compose up -d db && echo "Waiting for DB to be ready..." && sleep 3)

# Start the Redis + Celery worker + beat containers if not already running
celery-up:
    #!/usr/bin/env bash
    _redis_up=$(docker compose ps --status running redis | grep -c redis || true)
    _worker_up=$(docker compose ps --status running celery_worker | grep -c celery_worker || true)
    if [[ "$_redis_up" -gt 0 && "$_worker_up" -gt 0 ]]; then
        echo "Redis + Celery worker already running."
    else
        echo "Starting Redis + Celery worker + beat..."
        docker compose up -d redis celery_worker celery_beat
    fi

# Run the Celery worker locally (outside Docker) — useful for debugging tasks
celery-worker:
    cd backend && uv run celery -A core worker --loglevel=info --concurrency=2

# Run Flower monitoring UI locally (port 5555)
flower:
    cd backend && uv run celery -A core flower --port=5555

# Tail Celery worker logs
celery-logs:
    docker compose logs -f celery_worker

# Run backend and frontend dev servers concurrently (uses overmind if available)
dev: db-up celery-up
    #!/usr/bin/env bash
    echo "Starting backend and frontend dev servers..."
    echo "  Backend : http://localhost:8005"
    echo "  Frontend: http://localhost:5174"
    _pids=()
    _cleanup() {
        echo ""
        for pid in "${_pids[@]}"; do kill "$pid" 2>/dev/null || true; done
        wait 2>/dev/null || true
    }
    trap _cleanup INT TERM EXIT
    if command -v overmind &>/dev/null; then
        overmind start
    else
        just be-dev &
        _pids+=($!)
        just fe-dev &
        _pids+=($!)
        wait "${_pids[@]}"
    fi

# ── Database ───────────────────────────────────────────────────────────────────

# Open a psql session via Docker
db-shell:
    docker compose exec db psql -U appuser -d appdb

# Reset the database (drops volumes and re-applies migrations)
db-reset: down-v up-d be-migrate
    @echo "Database reset complete."

# ── Utilities ──────────────────────────────────────────────────────────────────

# Print configured environment files
env:
    @echo "=== backend/.env ===" && cat backend/.env 2>/dev/null || echo "(not found)"
    @echo "=== frontend/.env ===" && cat frontend/.env 2>/dev/null || echo "(not found)"

# Copy .env.example files to .env (safe — skips if already exists)
env-init:
    @[ -f backend/.env ] || cp backend/.env.example backend/.env && echo "Created backend/.env"
    @[ -f frontend/.env ] || cp frontend/.env.example frontend/.env && echo "Created frontend/.env"

# Clean Python bytecode and cache files
clean:
    find backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
    find backend -name "*.pyc" -delete 2>/dev/null || true

# Clean everything including node_modules and build artefacts
clean-all: clean
    rm -rf frontend/node_modules frontend/dist
