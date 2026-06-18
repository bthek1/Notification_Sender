# Plan: Convert Event Firing from `apply_async(eta=…)` to Clocked Tasks

**Status:** Completed
**Date:** 2026-06-18

> Supersedes the firing mechanism from
> [completed/second-accurate-firing.md](completed/second-accurate-firing.md). That
> plan armed a one-shot `fire_event.apply_async(args=[id], eta=scheduled_time)`
> from a rolling 10-minute windowed scheduler. This plan replaces the broker-side
> ETA with a **`ClockedSchedule` + one-off `PeriodicTask`** per event, dispatched
> by Celery Beat's `DatabaseScheduler`.

---

## Goal

Move the "fire at exact time" mechanism from broker-held ETA tasks to **database
clocked schedules**, so that:

- The schedule for every event lives entirely in PostgreSQL (it already partly
  does via `dispatch_task_id`), and **beat** — not a worker holding a message —
  decides when to dispatch.
- Re-timing is a plain row update (`ClockedSchedule.clocked_time = T'`) that beat
  re-reads, **eliminating the best-effort `revoke`** and the revoke/re-arm dance.
- The **rolling windowed scheduler is removed** — beat already scans all clocked
  rows each tick, so there is no need to "arm events entering a 10-minute window."

The defining property is preserved: `scheduled_time` can change at any moment and
the event still fires at the *new* time, no process restart.

**Accuracy tradeoff (read this first):** clocked tasks fire at the **next beat
tick after `clocked_time`**, so accuracy is bounded by beat's loop interval
(`DatabaseScheduler` default ≈ 5 s), *not* by worker wake jitter (sub-second) as
with ETA. To keep the second-accuracy target we must lower the beat max loop
interval (see Phase 2). This is the central cost of the migration and the main
reason to decide whether it's worth it — see [Why / why not](#why-this-migration).

---

## Background — what exists today

The current path ([apps/notifications/services.py](../../backend/apps/notifications/services.py)):

| Piece | Role |
|-------|------|
| `notifications-schedule-upcoming` (periodic, every 1 min) | Rolling scheduler: arms events entering the next 10 min. |
| `schedule_upcoming_events()` → `_arm_event()` | Claims `PENDING → SCHEDULED`, then `fire_event.apply_async(args=[id], eta=scheduled_time)`, stores `result.id` in `dispatch_task_id`. |
| `fire_event` / `fire_single_event()` | Idempotent, re-time-aware single fire (the backstop against stale ETAs). |
| `retime_event()` + `post_save` signal | On `scheduled_time` change: `revoke(dispatch_task_id)`, reset to `PENDING`, re-arm if in-window. |
| `_revoke_dispatch()` | Best-effort `current_app.control.revoke`. |

The `Event` state machine `PENDING → SCHEDULED → FIRED` (with `SCHEDULED →
PENDING` on re-time) and `dispatch_task_id` are reused below.

---

## Why this migration

**Gains**
- **No revoke.** Re-timing is `UPDATE django_celery_beat_clockedschedule SET
  clocked_time=…`. Beat re-reads; the wrong-time fire simply can't be dispatched
  because the schedule itself moved. Removes the "revoke is best-effort" risk.
- **No windowed scheduler.** Beat scans clocked rows every tick regardless of how
  far out they are, so the 10-min window / 1-min `schedule_upcoming_events` pass
  disappears. Fewer moving parts; arming can happen once, at event creation.
- **No long-lived broker messages.** Nothing sits in the broker until dispatch
  time, so the "long ETA holds broker memory" concern is gone outright (it was
  only *bounded* before).
- **Schedule is fully inspectable in the DB / Django admin** as first-class
  `PeriodicTask` rows.

**Costs / risks**
- **Coarser accuracy** unless beat's loop interval is lowered (Phase 2). ETA gives
  sub-second; clocked gives ≤ beat-tick.
- **Row accumulation.** Each event spawns a `PeriodicTask` (+ a `ClockedSchedule`,
  deduped by time). One-off tasks are set `enabled=False` after firing but the
  rows remain — needs cleanup (Phase 3).
- **`sync_scheduled_tasks` pruning hazard.** The sync command deletes every
  `PeriodicTask` not in `SCHEDULED_TASKS` (except `celery.backend_cleanup`). The
  new per-event rows **must be excluded from pruning** or sync will delete live
  schedules (Phase 1, critical).
- **Beat is now on the hot path for every fire** (it was only the scheduler
  trigger before). A beat outage stops all firing; with ETA, already-armed tasks
  would still fire from the broker.

---

## Design — one clocked PeriodicTask per event

```
   event created / re-timed (admin, API, generate_events)
                       │
        ┌──────────────▼───────────────────────────┐
        │ _arm_event(event)                          │
        │  • claim PENDING → SCHEDULED (dedup lock)  │
        │  • ClockedSchedule.get_or_create(          │
        │        clocked_time = scheduled_time)      │
        │  • PeriodicTask.create(                     │
        │        name = "fire-event-<id>",           │
        │        task = …tasks.fire_event,           │
        │        clocked = <schedule>, one_off=True, │
        │        args = [str(id)], enabled=True)     │
        │  • store PeriodicTask ref on the Event     │
        └──────────────┬───────────────────────────┘
                       │ beat dispatches at next tick ≥ clocked_time
                       ▼
        ┌───────────────────────────────────────────┐
        │ fire_event(event_id) → fire_single_event   │
        │  • already fired → no-op                    │
        │  • scheduled_time still in the future → skip│
        │  • else status=FIRED, fired_at=now()        │
        │  • mark/teardown the PeriodicTask           │
        └───────────────────────────────────────────┘
```

### Model changes ([models.py](../../backend/apps/notifications/models.py))

- Repurpose `dispatch_task_id` to hold the **`PeriodicTask` reference**. Two
  options:
  - **(Recommended) Deterministic name** — derive the row by name
    `fire-event-<event.id>`; drop `dispatch_task_id` entirely (the name is a pure
    function of the id, no column needed). Simplest; no extra migration beyond
    removal.
  - **FK** — `periodic_task = models.OneToOneField(PeriodicTask, null=True,
    on_delete=SET_NULL)`. Cleaner cascade semantics, but couples our model to a
    django-celery-beat table. Heavier.

  Recommendation: deterministic name. Keep `dispatch_task_id` as the stored name
  for one release if you want an easy rollback, then remove.

### Services changes ([services.py](../../backend/apps/notifications/services.py))

- **`_arm_event(event)`** — keep the `PENDING → SCHEDULED` claim as the dedup
  lock; replace the `apply_async` body with `ClockedSchedule` +
  `PeriodicTask.create` (using `update_or_create` on the deterministic name to be
  idempotent under retries).
- **`retime_event(event)`** — replace revoke + reset + re-arm with: look up the
  event's `PeriodicTask`; `get_or_create` a `ClockedSchedule` at the new time;
  set `pt.clocked`, `pt.one_off = True`, `pt.enabled = True`, `pt.save()`. No
  status bounce needed (the row stays `SCHEDULED`); if no row exists yet (event
  was never armed) create one. **Delete `_revoke_dispatch` entirely.**
- **`fire_single_event(event_id)`** — keep idempotency + the
  re-timed-later skip (still a useful backstop if beat dispatches a stale row
  before re-time propagates). On a successful fire (and on the deferred branch's
  "no longer mine" case), **tear down the `PeriodicTask`** (delete it, or rely on
  the Phase 3 cleanup sweep). Beat auto-sets `enabled=False` on one-off rows
  after dispatch, but we delete to stop unbounded growth.
- **`schedule_upcoming_events()`** — **remove** (no window). Optionally replace
  with a lightweight **reconciler** (Phase 3) that arms any `PENDING` event
  lacking a clocked row — covers events created by bulk paths that bypass the
  signal.

### Signal ([signals.py](../../backend/apps/notifications/signals.py))

Unchanged in shape — `post_save` still detects a `scheduled_time` change via
`_loaded_scheduled_time` and calls `retime_event`. Also call `_arm_event` on
`created=True` so new events are armed immediately at creation (no window to wait
for). Guard for eager mode in tests so creating rows doesn't try to touch beat
tables unexpectedly (the beat tables are real DB rows, so this is fine under the
test DB, but assert behavior explicitly).

### Tasks ([tasks.py](../../backend/apps/notifications/tasks.py))

- `fire_event` — unchanged (still delegates to `fire_single_event`).
- `schedule_upcoming_events_task` — **remove**, or repurpose as the reconciler
  (Phase 3).
- Add `cleanup_fired_clocked_tasks` (Phase 3).

---

## Phases

### Phase 1 — Clocked arming + re-timing (core swap)

- [ ] Decide model representation (deterministic name vs FK) — default: name,
  keep `dispatch_task_id` as the stored name for one release.
- [ ] `services.py`: rewrite `_arm_event` to create `ClockedSchedule` +
  one-off `PeriodicTask` (`update_or_create` by name). Keep the
  `PENDING → SCHEDULED` claim.
- [ ] `services.py`: rewrite `retime_event` to update the row's `clocked`
  schedule; drop `_revoke_dispatch`.
- [ ] `services.py`: `fire_single_event` tears down the `PeriodicTask` on
  fire/defer.
- [ ] **Critical — sync pruning:** exclude per-event rows from
  `sync_scheduled_tasks` pruning. In
  [sync_scheduled_tasks.py](../../backend/apps/tasks/management/commands/sync_scheduled_tasks.py),
  change the `stale` query to also `.exclude(name__startswith="fire-event-")`
  (and/or `.exclude(task="apps.notifications.tasks.fire_event")`). Without this,
  every sync deletes all armed fire schedules.
- [ ] `signals.py`: arm on `created=True`; keep retime on change.

### Phase 2 — Beat precision + remove the windowed scheduler

- [ ] Set the beat loop interval for second-accuracy. `DatabaseScheduler`
  defaults to ≈ 5 s. Add `CELERY_BEAT_MAX_LOOP_INTERVAL = 1` (or run beat with
  `--max-interval=1`) in [base.py](../../backend/core/settings/base.py). Document
  the DB-read cost (beat re-queries each tick).
- [ ] Remove `notifications-schedule-upcoming` from
  [scheduled_tasks.py](../../backend/apps/tasks/scheduled_tasks.py); run
  `just be-sync-tasks` to prune it.
- [ ] Remove `schedule_upcoming_events` / `schedule_upcoming_events_task` (or
  fold into the Phase 3 reconciler). Drop `SCHEDULE_WINDOW_MINUTES`.

### Phase 3 — Cleanup + durability backstop

- [ ] **Cleanup task** `cleanup_fired_clocked_tasks` (periodic, e.g. every 10
  min, added to `SCHEDULED_TASKS`): delete `PeriodicTask` rows named
  `fire-event-*` that are `enabled=False` / whose event is `FIRED`, plus orphaned
  `ClockedSchedule` rows with no referencing task. Prevents unbounded growth.
- [ ] **Reconciler** (optional, periodic, e.g. every 1–5 min): for each `PENDING`
  event with no `fire-event-<id>` row, arm it. Covers bulk creates / out-of-band
  edits that bypass `post_save` (e.g. `bulk_create` in `generate_future_events`,
  `QuerySet.update`). Decide: arm in `generate_future_events` directly vs rely on
  reconciler. (Today arming is deliberately kept out of `generate_future_events`;
  with clocked tasks there's no eager-fire race, so arming at create is safe.)
- [ ] Confirm `generate_events` / `generate_future_events` path arms its rows
  (via signal on `bulk_create` — note `bulk_create` does **not** fire `post_save`,
  so either switch to per-row `save()`, or arm explicitly, or rely on the
  reconciler).

### Phase 4 — Tests & docs

- [ ] Rewrite [tests.py](../../backend/apps/notifications/tests.py) suites:
  - `TestArmEvent` → asserts a `ClockedSchedule` + one-off `PeriodicTask` with
    correct `clocked_time`, `args`, `name`; lost claim creates no row.
  - `TestRetimeOnSave` → asserts the row's `clocked_time` updates (no revoke);
    re-time of an unarmed event arms it.
  - `TestFireSingleEvent` → fire/no-op/defer + `PeriodicTask` teardown.
  - New `TestCleanup` / `TestReconciler`.
  - Remove `TestRevokeDispatch`, the windowed `TestScheduleUpcomingEvents`, and
    sweeper tests that no longer apply.
- [ ] Update docs: [dynamic-scheduling.md](../explanations/dynamic-scheduling.md),
  [architecture.md](../explanations/architecture.md),
  [background-tasks.md](../guides/background-tasks.md) — describe clocked-task
  firing, the beat-interval accuracy bound, and cleanup. Move this plan to
  `docs/plans/completed/` when done.

---

## Testing

- Unit (Celery eager, `just be-test`): arming creates the right beat rows;
  re-time mutates `clocked_time` in place; fire is idempotent and tears down its
  row; cleanup removes fired rows; reconciler arms orphans.
- Integration (live beat + worker, follow-up benchmark): schedule N events at
  known times with `CELERY_BEAT_MAX_LOOP_INTERVAL = 1`; assert the
  `fired_at − scheduled_time` distribution stays **p99 < 2 s** (looser than the
  ETA target of < 1 s — set expectations honestly given the beat-tick floor).
- Re-time latency: edit → next beat tick (≤ loop interval), no restart.

---

## Risks & open questions

- **Accuracy floor is the beat loop interval.** With a 1 s interval, p99 ≈ 1–2 s
  vs. ETA's sub-second. If sub-second is a hard requirement, **do not migrate** —
  the ETA approach is strictly better on raw precision. Confirm the target is
  "second-accurate" and not tighter.
- **Beat is a single point of failure for firing.** No armed broker messages to
  fall back on. Mitigate with beat supervision / restart; the DB stays the source
  of truth so a restarted beat re-reads everything.
- **`sync_scheduled_tasks` must never prune `fire-event-*`** — covered in Phase 1
  but worth a dedicated regression test.
- **Row growth** in `django_celery_beat_periodictask` /
  `_clockedschedule` — cleanup task is mandatory, not optional.
- **`bulk_create` bypasses `post_save`** — `generate_future_events` won't auto-arm
  via the signal; pick per-row save, explicit arm, or reconciler.
- **Scope unchanged** — "firing" stays a status flip + log so accuracy remains
  the measured quantity (consistent with the
  [original harness plan](completed/dynamic-notification-scheduler.md)).
</content>
</invoke>
