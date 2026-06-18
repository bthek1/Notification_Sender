# Plan: Dynamic Notification Scheduler

**Status:** Draft
**Date:** 2026-06-18

---

## Goal

Build a `notifications` Django app that lets a client **schedule a notification to fire at a specific time** and **change that time at any point afterwards**, with the task still firing accurately at the new time — no process restart, no lost schedule on crash. When a notification fires, the "send" action writes a log line and a `NotificationLog` row capturing the **scheduled vs. actual** fire time (the accuracy measurement this repo exists to test). This pass is **design only**; no app code is written yet.

## Background

The repo already ships the Celery foundation: a worker, a `beat` scheduler configured with `django-celery-beat`'s `DatabaseScheduler`, `django-celery-results` (`django-db`), and Flower. That scheduler stores schedules as **PostgreSQL rows** that beat re-reads continuously — which is precisely what makes a schedule's time editable at runtime. See [docs/explanations/dynamic-scheduling.md](../explanations/dynamic-scheduling.md) for the mechanism and accuracy trade-offs.

We deliberately keep the "send" trivial (log + DB record) so the experiment isolates **scheduling accuracy**, not delivery to an external channel. Adding a real channel (email/webhook) is a later, separate plan.

### Design decisions

- **One-off notifications use `ClockedSchedule`.** A `PeriodicTask` pointing at a `ClockedSchedule` fires once at a wall-clock datetime, then auto-disables. Recurring notifications (a later extension) would use `CrontabSchedule`/`IntervalSchedule`.
- **Rescheduling = update the schedule row, not revoke/re-enqueue.** Changing a notification's time updates its `ClockedSchedule.clocked_time` and re-enables the `PeriodicTask`. Beat reflects it within a few seconds. We do **not** use `apply_async(eta=...)` (hard to re-time and doesn't survive cleanly).
- **The `notifications` app owns its `django-celery-beat` rows.** Each `Notification` has a 1:1 link to a `PeriodicTask`; the app creates/updates/deletes that row in `services.py`. Views never touch beat models directly.
- **Accuracy is recorded, not assumed.** The send task stamps `actual_fire_time = timezone.now()` and computes `delay = actual - scheduled` into `NotificationLog`.

## Data model

```
Notification
  id              UUID  (pk)
  title           CharField
  message         TextField
  scheduled_for   DateTimeField        # the user-facing target time (tz-aware)
  status          CharField            # SCHEDULED | SENT | CANCELLED | FAILED
  periodic_task   OneToOne -> django_celery_beat.PeriodicTask (null on cancel)
  created_at / updated_at

NotificationLog            # one row per fire attempt
  id              UUID  (pk)
  notification    FK -> Notification
  scheduled_for   DateTimeField        # snapshot of the target at fire time
  actual_fire_time DateTimeField       # timezone.now() inside the task
  delay_ms        IntegerField         # actual - scheduled, milliseconds (signed)
  status          CharField            # SENT | FAILED
  detail          TextField (blank)
```

`ClockedSchedule` and `PeriodicTask` rows are owned by `django-celery-beat`; we create them, link them, and re-time them.

## API (DRF, under `/api/notifications/`)

| Method & path | Purpose |
|---------------|---------|
| `POST /api/notifications/` | Create a notification → creates `ClockedSchedule` + `PeriodicTask`. Body: `title`, `message`, `scheduled_for`. |
| `GET /api/notifications/` | List notifications (status, scheduled_for, last log). |
| `GET /api/notifications/{id}/` | Detail incl. its `NotificationLog` rows. |
| `PATCH /api/notifications/{id}/` | **Re-time** (`scheduled_for`) or edit content. Updates the `ClockedSchedule` and re-enables the task. |
| `POST /api/notifications/{id}/cancel/` | Disable/delete the `PeriodicTask`; set status `CANCELLED`. |
| `GET /api/notifications/{id}/accuracy/` | Scheduled vs. actual summary for this notification. |

All logic (creating/updating beat rows, status transitions) lives in `apps/notifications/services.py`; views stay thin.

## The send task

`apps/notifications/tasks.py`:

```python
@shared_task(bind=True)
def send_notification(self, notification_id: str) -> dict:
    # 1. load Notification (guard: already SENT/CANCELLED -> no-op)
    # 2. actual = timezone.now(); delay_ms = (actual - scheduled_for).total_seconds() * 1000
    # 3. logger.info(...)  +  create NotificationLog(SENT, scheduled_for, actual, delay_ms)
    # 4. notification.status = SENT; save
    # 5. return {"notification_id", "delay_ms"}
```

The `PeriodicTask` is configured with `one_off=True` so it auto-disables after firing.

## Phases

### Phase 1 — App scaffold & models
- [ ] `just be-startapp notifications`; add `apps.notifications` to `INSTALLED_APPS`.
- [ ] Define `Notification` and `NotificationLog` models (UUID PKs).
- [ ] `makemigrations` + `migrate`.

### Phase 2 — Scheduling service
- [ ] `services.py`: `schedule_notification()` — create `ClockedSchedule` + one-off `PeriodicTask` linked to the `Notification`.
- [ ] `reschedule_notification()` — update `ClockedSchedule.clocked_time`, re-enable the task.
- [ ] `cancel_notification()` — disable/delete the `PeriodicTask`, set status.

### Phase 3 — Send task
- [ ] `tasks.py`: `send_notification` — log + `NotificationLog` row with `delay_ms`; flip status to `SENT`.
- [ ] Confirm autodiscovery (task visible in Flower / `celery -A core inspect registered`).

### Phase 4 — API
- [ ] Serializers (`NotificationSerializer`, `NotificationLogSerializer`).
- [ ] ViewSet + `cancel` / `accuracy` actions; wire `apps/notifications/urls.py` into `core/urls.py`.
- [ ] Register models in `admin.py` for manual inspection.

### Phase 5 — Docs & accuracy report
- [ ] Add the endpoints to [docs/standards/api-contracts.md](../standards/api-contracts.md).
- [ ] Short runbook: create → re-time → watch it fire in Flower → read `delay_ms`.
- [ ] Flip this plan's status to `In Progress` → `Complete`.

*(Out of scope here: frontend UI, recurring schedules, real delivery channels — each a follow-up plan.)*

## Testing

- **Unit tests** (`pytest`, `freezegun` for time):
  - `schedule_notification` creates a `ClockedSchedule` + one-off `PeriodicTask` at the right time.
  - `reschedule_notification` mutates the existing `ClockedSchedule` (asserts the time changed) and does **not** orphan rows.
  - `cancel_notification` disables the task and blocks a subsequent fire.
  - `send_notification` writes a `NotificationLog` with a correct signed `delay_ms` and sets status `SENT`; a second call on an already-`SENT`/`CANCELLED` notification is a no-op.
- **Integration tests** (`@pytest.mark.integration`, eager or a real worker):
  - End-to-end: create via API → task runs → `NotificationLog` row exists.
  - Re-time then fire: only the latest time fires; the original does not.
- **Manual verification:**
  1. `docker compose up`; `POST /api/notifications/` for ~30s out.
  2. `PATCH` `scheduled_for` to a new time; confirm in Django admin the `ClockedSchedule` row changed.
  3. Watch it fire in Flower; `GET .../accuracy/` and confirm `delay_ms` is within a few seconds.

## Risks & Notes

- **Tick-granularity accuracy floor.** `beat` is a poller (~5s sync). Sub-second precision is not achievable with this scheduler; document the observed `delay_ms` band rather than promising exactness. Tunable via beat's max loop interval at the cost of DB load.
- **Orphaned beat rows.** Deleting a `Notification` must also clean up its `ClockedSchedule`/`PeriodicTask` (handle in `services.py` / `on_delete`), or stale schedules accumulate.
- **Timezone correctness.** Store/compare tz-aware datetimes; `CELERY_TIMEZONE` follows Django `TIME_ZONE`. A naive `scheduled_for` would mis-fire.
- **Past times.** Scheduling for a time already in the past should fire ASAP (or be rejected) — decide and validate in the serializer.
- **One-off auto-disable race.** After firing, the `one_off` task disables itself; a re-time that arrives during firing needs a defined precedence (latest write wins). Cover in Phase 2/3 tests.
</content>
