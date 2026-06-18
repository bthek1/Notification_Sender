# API Contracts

All endpoints are prefixed with `/api/`. Authentication uses JWT Bearer tokens unless noted as public.

---

## Authentication

### `POST /api/token/`

Obtain a JWT access + refresh token pair.

**Auth:** Public

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "string"
}
```

**Response `200`:**
```json
{
  "access": "<jwt_access_token>",
  "refresh": "<jwt_refresh_token>"
}
```

**Errors:** `401` — invalid credentials

---

### `POST /api/token/refresh/`

Exchange a valid refresh token for a new access token.

**Auth:** Public

**Request body:**
```json
{
  "refresh": "<jwt_refresh_token>"
}
```

**Response `200`:**
```json
{
  "access": "<new_jwt_access_token>"
}
```

**Errors:** `401` — refresh token invalid or expired

---

## Accounts

### `POST /api/accounts/register/`

Create a new user account.

**Auth:** Public

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "string (min 8 chars)"
}
```

**Response `201`:**
```json
{
  "id": "<uuid>",
  "email": "user@example.com"
}
```

**Errors:** `400` — validation error (duplicate email, weak password)

---

### `GET /api/accounts/me/`

Retrieve the authenticated user's profile.

**Auth:** Bearer token required

**Response `200`:**
```json
{
  "id": "<uuid>",
  "email": "user@example.com",
  "first_name": "string",
  "last_name": "string",
  "date_joined": "2026-01-01T00:00:00Z"
}
```

**Errors:** `401` — missing or invalid token

---

### `PATCH /api/accounts/me/`

Update the authenticated user's profile fields.

**Auth:** Bearer token required

**Request body** (all fields optional):
```json
{
  "first_name": "string",
  "last_name": "string",
  "email": "user@example.com"
}
```

**Response `200`:** Updated user object (same shape as `GET /api/accounts/me/`)

**Errors:** `400` — validation error, `401` — unauthorised

---

## Notifications

An `Event` is a point-in-time record scheduled to occur at `scheduled_time`. Its
`status` follows the lifecycle `pending → scheduled → fired`: created `pending`,
moved to `scheduled` once a one-off clocked fire task is armed at its exact time
(dispatched by beat), and `fired` (with `fired_at` stamped) once it runs. See
[dynamic-scheduling.md](../explanations/dynamic-scheduling.md#the-event-state-machine).
Events are usually created ahead of time by the `generate_events` background task.

### `GET /api/notifications/events/`

List all events, ordered by `scheduled_time` (soonest first).

**Auth:** Public (harness/demo)

**Response `200`:**
```json
[
  {
    "id": "<uuid>",
    "title": "Generated event 1",
    "message": "Auto-generated event firing within 20 minutes.",
    "scheduled_time": "2026-06-18T05:24:00Z",
    "status": "pending",
    "fired_at": null,
    "created_at": "2026-06-18T05:20:00Z",
    "updated_at": "2026-06-18T05:20:00Z"
  }
]
```

---

### `GET /api/notifications/events/{id}/`

Retrieve a single event by UUID.

**Auth:** Public (harness/demo)

**Response `200`:** A single event object (same shape as the list items above).

**Errors:** `404` — no event with that id

---

### `POST /api/notifications/events/generate/`

Dispatch the `generate_events` Celery task, which creates `count` pending events
spread evenly across the next `within_minutes` minutes (default: 5 events / 20 min).

**Auth:** Public (harness/demo)

**Request body** (all fields optional):
```json
{
  "count": 5,
  "within_minutes": 20
}
```

**Response `202`:**
```json
{
  "task_id": "<celery_task_id>"
}
```

**Errors:** `400` — `count` outside 1–100 or `within_minutes` outside 1–1440

---

## Background Tasks

Runtime inspection and control of the periodic Celery Beat schedule. Schedules
are defined in code (`apps/tasks/scheduled_tasks.py`) and applied with
`sync_scheduled_tasks` — see
[docs/guides/background-tasks.md](../guides/background-tasks.md).

### `GET /api/tasks/schedules/`

List all periodic tasks with their interval/crontab/clocked timing.

**Auth:** Bearer token required

**Response `200`:**
```json
[
  {
    "id": 1,
    "name": "notifications-schedule-window",
    "task": "apps.notifications.tasks.sync_event_window_task",
    "enabled": true,
    "schedule": { "type": "interval", "every": 10, "period": "seconds" },
    "one_off": false,
    "args": "[]",
    "kwargs": "{}",
    "last_run_at": "2026-06-18T05:20:00Z",
    "total_run_count": 42,
    "date_changed": "2026-06-18T05:00:00Z"
  }
]
```

`schedule` is one of:
- `{"type": "interval", "every", "period"}` for interval tasks,
- `{"type": "crontab", "minute", "hour", "day_of_week", "day_of_month",
  "month_of_year"}` for crontab tasks,
- `{"type": "clocked", "clocked_time"}` for one-off clocked tasks (an ISO
  datetime the task fires at once), or
- `null` if none is set.

`one_off` is `true` for tasks that disable themselves after firing once
(clocked tasks are typically one-off).

---

### `PATCH /api/tasks/schedules/{id}/`

Enable or disable a periodic task.

**Auth:** Bearer token required

**Request body:**
```json
{ "enabled": false }
```

**Response `200`:** `{ "enabled": false }`

**Errors:** `404` — no task with that id

> Note: `sync_scheduled_tasks` resets `enabled` to the value in
> `scheduled_tasks.py` on its next run.

---

### `POST /api/tasks/schedules/{id}/trigger/`

Fire a periodic task immediately (out of band from its schedule), using the
task's stored `args`/`kwargs`.

**Auth:** Bearer token required

**Response `202`:**
```json
{ "task_id": "<celery_task_id>" }
```

**Errors:** `404` — no task with that id

---

### `GET /api/tasks/results/`

List recent task run results, newest first.

**Auth:** Bearer token required

**Query params:** `status` (optional) — filter by Celery state, e.g. `SUCCESS`,
`FAILURE`.

**Response `200`:**
```json
[
  {
    "task_id": "<celery_task_id>",
    "task_name": "apps.notifications.tasks.sync_event_window_task",
    "status": "SUCCESS",
    "result": "3",
    "date_created": "2026-06-18T05:20:00Z",
    "date_done": "2026-06-18T05:20:01Z",
    "traceback": null
  }
]
```

---

### `GET /api/tasks/results/{task_id}/`

Retrieve a single task run result by Celery task id.

**Auth:** Bearer token required

**Response `200`:** A single result object (same shape as the list items above).

**Errors:** `404` — no result for that task id

---

## Health

### `GET /api/health/`

Service liveness check.

**Auth:** Public

**Response `200`:**
```json
{
  "status": "ok"
}
```

---

## Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | OK — request succeeded |
| `201` | Created — resource created |
| `400` | Bad Request — validation error |
| `401` | Unauthorised — missing or invalid JWT |
| `403` | Forbidden — authenticated but insufficient permissions |
| `404` | Not Found |
| `500` | Internal Server Error |

---

## Request Headers

All authenticated requests must include:

```
Authorization: Bearer <access_token>
Content-Type: application/json
```

---

## Model Notes

- All primary keys are UUIDs (`uuid4`)
- Timestamps are ISO 8601 in UTC
- `CustomUser` extends Django's `AbstractUser` — `email` is the login identifier (no `username` field)
