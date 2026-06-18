# Plan: Second-Accurate Event Firing

**Status:** Implemented
**Date:** 2026-06-18

---

## Goal

Drive the gap between an event's `scheduled_time` and its `fired_at` down from
**minutes to roughly one second**, while keeping the system's defining property:
a `scheduled_time` can change at any moment and the event still fires accurately
at the *new* time, with no process restart.

Second-level accuracy is the explicit target — not microseconds. We get there by
**pre-scheduling a one-shot task per event at its exact time**, instead of
polling for due events.

---

## Background — where the delay comes from today

The current firing path is a **polling** loop:

- `notifications-fire-events` is a periodic Celery Beat task, interval **5 minutes**
  ([apps/tasks/scheduled_tasks.py](../../backend/apps/tasks/scheduled_tasks.py)).
- Each run calls `fire_due_events()`
  ([apps/notifications/services.py](../../backend/apps/notifications/services.py)),
  one bulk `UPDATE … SET status='fired', fired_at=now` over every pending row with
  `scheduled_time <= now`.

Decomposing `fired_at − scheduled_time`, largest first:

| # | Source | Magnitude today | Nature |
|---|--------|-----------------|--------|
| 1 | **Polling interval** of `fire_events` | 0–300 s, mean ~150 s | Dominant. An event due at T isn't looked at until the next 5-min tick. |
| 2 | **Beat tick granularity** | up to ~5 s | Beat re-reads schedules every ~5 s. |
| 3 | **Broker + worker pickup** | ~1–50 ms | Enqueue → Redis → worker dequeue. |
| 4 | **Batched `fired_at`** | up to one run | `fired_at = now` is stamped once per run, so all events in a batch share a timestamp. |

Items 1–2 are ~all of it. The fix is **not** to poll faster (a 1 s poll still
floors at the beat tick and hammers the DB). The fix is to stop polling for due
events and instead **hand the worker each event ahead of time with an exact
`eta`**, so the worker itself wakes at the scheduled instant.

The original design notes flagged `apply_async(eta=…)` as awkward because
"revoking and rescheduling on every edit is fiddly, and very long ETAs hold
broker memory." We neutralise both: a **bounded 10-minute lookahead window** caps
the ETA horizon (no long-lived ETAs in the broker), and a small amount of
bookkeeping (a stored task id + an idempotent fire task) makes re-timing safe.

---

## Design — windowed pre-scheduling

Replace the "fire due events" poll with a **scheduler** that looks a short
distance into the future and arms an exact-time task for each event in that
window.

```
                 every 5 min (beat)
                        │
        ┌───────────────▼────────────────┐
        │  schedule_upcoming_events()     │   ← periodic, lookahead = 10 min
        │  pending events with            │
        │  scheduled_time ∈ [now, now+10m]│
        │  and not yet armed              │
        └───────────────┬─────────────────┘
                        │ for each: fire_event.apply_async(eta=scheduled_time)
                        ▼
              broker holds the ETA task
                        │ worker wakes at eta (≈ second-accurate)
                        ▼
        ┌────────────────────────────────┐
        │  fire_event(event_id)           │
        │  • reload row (idempotent)      │
        │  • if already fired → no-op     │
        │  • if re-timed later → skip     │
        │  • else status=fired,           │
        │        fired_at = now()         │
        └────────────────────────────────┘
```

Why a **10-minute window with a 5-minute scheduler interval**: consecutive passes
overlap, so an event is seen by ~2 passes and nothing can slip through the seam.
Dedup (below) stops the overlap from double-arming. The window bounds how far
ahead any ETA sits in the broker, so broker memory stays small and bounded
regardless of how far out events are scheduled.

### Bookkeeping on the `Event` model

- Add `dispatch_task_id` (`CharField`, nullable) — the Celery id of the armed
  `fire_event` task, kept for revoke-on-retime.
- Add a `SCHEDULED` status so the lifecycle is an explicit **state machine**:
  `PENDING → SCHEDULED → FIRED`, with a re-time sending `SCHEDULED → PENDING`.
  The scheduler arms events where `status = pending` **and** `scheduled_time ∈
  [now, now + window]`; the `PENDING → SCHEDULED` claim *is* the dedup lock (a
  lost claim never enqueues an orphan task). Firing is a status-guarded `UPDATE`
  over `{pending, scheduled}`, so an event can never fire twice.

### The fire task is idempotent and re-time-aware

`fire_event(event_id)` is the safety net that makes exact-time scheduling robust
against stale ETAs:

- Reload the row. If `status = fired` already → no-op (a duplicate/late retry).
- If `scheduled_time` has moved **later** than `now` (beyond a ~1 s tolerance) →
  the user pushed it back; **do not fire**. Clear `dispatch_task_id` so the
  scheduler re-arms it when its new time enters the window.
- Otherwise fire: `status = fired`, `fired_at = timezone.now()` (per-event,
  fixing source 4), log, leave `dispatch_task_id` for audit.

### Dynamic re-timing (the core guarantee)

When an event's `scheduled_time` changes while pending:

- **Moved earlier** — the armed ETA is now too late. On the edit (API `PATCH`
  handler / `post_save` signal detecting a `scheduled_time` change), **revoke**
  the old `dispatch_task_id`, clear it, and let the next scheduler pass re-arm at
  the new time (or re-arm inline if the new time is already inside the window).
- **Moved later** — leave the armed task; when it fires early the fire task sees
  `scheduled_time > now`, skips, and clears `dispatch_task_id` for re-arming.
- **No stored id yet** (not armed) — nothing to revoke; the scheduler picks it up
  when it enters the window.

Revoke + re-arm is the mechanism; the idempotent fire task is the backstop, so
even a missed revoke can't cause a wrong-time or double fire.

---

## Accuracy budget

With this design the residual delay is sources 3 + worker wake jitter only:
the worker is holding the task and wakes at `eta`. Realistic `fired_at −
scheduled_time` is **well under one second** in the common case (broker hop +
worker dispatch). Targets:

| Metric | Target |
|--------|--------|
| p50 delay | < 250 ms |
| p99 delay | < 1 s |
| Re-time latency (edit → re-armed) | < 1 scheduler interval, immediate if in-window |

Sub-second jitter from the worker/broker is the floor and is acceptable — the
goal is second accuracy, not tighter.

---

## Phases

### Phase 0 — Per-event measurement (small prerequisite)

- [x] Stamp `fired_at` per event at fire time (naturally per-event once firing is
  one-task-per-event), removing the batch-flattening artifact (source 4).
- [x] Keep the existing `scheduled_time` vs `fired_at` read-out on the Events page
  and [DelayChart](../../frontend/src/components/events/DelayChart.tsx); seconds/ms
  units are sufficient (no microsecond work).

### Phase 1 — Windowed scheduler + exact-time fire task

- [x] Add `dispatch_task_id` to the `Event` model
  ([apps/notifications/models.py](../../backend/apps/notifications/models.py)) +
  migration `0002_event_dispatch_task_id`.
- [x] `services.py`: `schedule_upcoming_events(window_minutes=10)` — select
  pending, un-armed events in the window and `fire_event.apply_async(args=[id],
  eta=scheduled_time)`, storing the returned task id on the row (race-guarded).
- [x] `tasks.py`: `schedule_upcoming_events_task` (`@shared_task`, periodic) and
  `fire_event(event_id)` (`@shared_task`, the idempotent re-time-aware single fire).
- [x] Keep `fire_due_events` as a **sweeper** safety net (see Phase 3) but stop it
  being the primary firing path.

### Phase 2 — Swap the periodic schedule

- [x] In [scheduled_tasks.py](../../backend/apps/tasks/scheduled_tasks.py): replace
  the firing role of `notifications-fire-events` with
  `notifications-schedule-upcoming` running the scheduler every **1 minute**
  (chosen over 5 min so newly-created in-window events are armed promptly) with
  `kwargs={"window_minutes": 10}`. **No 1 s poll.** `notifications-fire-events`
  stays as the 5-minute sweeper.
- [x] `just be-sync-tasks` to apply. `generate_events` left untouched — arming is
  the scheduler's job, which keeps `generate_future_events` a pure data helper and
  avoids eager-mode fire races in tests.

### Phase 3 — Re-timing + robustness

- [x] On `scheduled_time` change (`post_save` signal, any ORM save path): revoke
  `dispatch_task_id`, clear it, re-arm (inline if in-window, else next pass).
  Detected via a `from_db`-captured `_loaded_scheduled_time`.
- [x] Idempotency guards in `fire_event` (already-fired no-op; re-timed-later skip
  + clear; status-guarded `UPDATE` so a double-armed event can't double-fire).
- [x] **Sweeper:** the low-frequency `fire_due_events` (every 5 min) fires any
  pending event already past due — covers worker downtime, lost ETAs, broker
  flushes. Durability backstop, not the hot path.
- [x] Crash/restart: armed ETAs live in the broker; on broker loss the sweeper +
  next scheduler pass re-arm from the DB (the DB stays the source of truth).

### Phase 4 — Docs

- [x] Update [dynamic-scheduling.md](../explanations/dynamic-scheduling.md) — the
  "Accuracy" section now describes windowed exact-time scheduling, not polling.
- [ ] Update [architecture.md](../explanations/architecture.md) and
  [background-tasks.md](../guides/background-tasks.md) (follow-up).

---

## Testing

Implemented in [apps/notifications/tests.py](../../backend/apps/notifications/tests.py)
(`just be-test`, Celery eager) — **36 passing**, 16 new for this feature:

- [x] **`TestScheduleUpcomingEvents`** — arms only in-window/un-armed/pending
  events with the correct `eta` + `args`; never re-arms an already-armed row;
  skips fired rows; arms past-due un-armed rows; task wrapper returns the count.
- [x] **`TestFireSingleEvent`** — fires a due event (per-event `fired_at`);
  no-ops an already-fired one; defers + clears the arm on a re-timed-later event;
  handles a missing id; task wrapper delegates.
- [x] **`TestRetimeOnSave`** — changing `scheduled_time` into the window revokes
  the stale arm and re-arms; changing it outside the window revokes but does not
  re-arm; a non-time save is a no-op; `retime_event` ignores fired events.
- [x] **`TestArmEvent`** — stores the task id and returns `True`; on a lost arm
  race the guarded UPDATE matches nothing, the loser revokes and returns `False`.
- [x] **`TestSweeperCoexistence`** — the sweeper fires an armed-but-unfired due
  event and never re-fires one the exact-time path already fired (status guard).
- [x] **`TestArmToFireIntegration`** — real eager path (no `apply_async` mock):
  scheduling a due event fires it end to end; scheduling a future event defers.
- [ ] **Accuracy harness (follow-up, slow/benchmark, not a hard CI gate):**
  schedule N events at known times against a live worker/beat; assert the
  `fired_at − scheduled_time` distribution stays p99 < 1 s.

## Risks & Notes

- **Stale ETAs in the broker.** Bounded by the 10-min window and made safe by the
  idempotent, re-time-aware `fire_event` — a stale task is a no-op or a skip, never
  a wrong-time fire. The sweeper covers anything lost entirely.
- **Revoke is best-effort.** Celery `revoke` isn't guaranteed to reach a worker;
  the fire task's re-check is what actually prevents wrong-time fires, not the
  revoke.
- **Two firing paths (scheduler vs sweeper).** The `dispatch_task_id` + idempotent
  fire task ensure only one of them ever fires a given event.
- **Window/interval coupling.** Window (10 min) must exceed the scheduler interval
  (5 min) so passes overlap; if the interval is raised, raise the window too.
- **Scope unchanged.** "Firing" stays a row flip + log so accuracy is what's
  measured — no real delivery channel, consistent with the
  [dynamic-notification-scheduler plan](completed/dynamic-notification-scheduler.md).
