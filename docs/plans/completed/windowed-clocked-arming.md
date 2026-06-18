# Plan: Bound Clocked Tasks to a Rolling 1-Minute Window

**Status:** Completed
**Date:** 2026-06-18

> Refines the firing mechanism from
> [clocked-event-firing.md](clocked-event-firing.md). That
> plan armed a one-off `ClockedSchedule` + `PeriodicTask` for **every** event at
> creation. This plan **bounds arming to a rolling 1-minute window** scanned by a
> background task every 10 seconds, so the number of clocked beat rows tracks the
> events firing *soon*, not the entire future backlog.

---

## Goal

Stop creating a clocked beat row per future event. Instead, a periodic
**windower** keeps the set of armed events equal to "events due in the next
minute":

- **Arm forward:** every 10 s, find `PENDING` events with `scheduled_time` within
  the next **60 s** and arm them (`PENDING → SCHEDULED` + one-off
  `ClockedSchedule`/`PeriodicTask`).
- **Disarm backward:** in the same pass, find `SCHEDULED` events whose
  `scheduled_time` is now **more than 60 s out** (because they were re-timed
  further into the future) and return them to `PENDING`, **deleting their clocked
  `PeriodicTask`**.

The defining property is preserved: `scheduled_time` can change at any moment and
the event still fires at the *new* time, no process restart. The number of beat
rows is now **O(events per minute)** instead of **O(all future events)**.

**Why (read this first):** the harness must tolerate **millions** of future
events. Arming all of them — one `PeriodicTask` + one `ClockedSchedule` each —
bloats `django_celery_beat_periodictask`, and **beat re-reads every clocked row
every tick** (we run a 1 s loop), so a large armed set makes each beat tick scan
a huge table. Bounding the armed set to the next minute keeps both the table and
the per-tick scan small and flat regardless of backlog size.

---

## Background — what exists today

After [clocked-event-firing.md](clocked-event-firing.md), the path
([apps/notifications/services.py](../../../backend/apps/notifications/services.py)):

| Piece | Role today |
|-------|------------|
| `_arm_event(event)` | Claim `PENDING → SCHEDULED`, write one-off `fire-event-<id>` `PeriodicTask` → `ClockedSchedule(clocked_time=scheduled_time)`. |
| `retime_event(event)` | On `scheduled_time` change: move the clocked schedule **in place** (no revoke, stays `SCHEDULED`). |
| `fire_single_event(id)` | Idempotent, re-time-aware single fire; tears down its `PeriodicTask` on fire. |
| `reconcile_pending_events()` (every 1 min) | Backstop: arms any `PENDING` event lacking a clocked row. |
| `cleanup_fired_clocked_tasks()` (every 10 min) | Deletes `fire-event-*` rows for gone/FIRED events; sweeps orphaned `ClockedSchedule`. |
| `post_save` signal | Arms on `created=True`; moves the clocked schedule on re-time. |
| `generate_future_events()` | Creates events **and arms each one** explicitly (bulk_create bypasses the signal). |

The problem: every created event is armed immediately, so the beat tables grow
with the full future backlog. `reconcile_pending_events` re-arms *all* `PENDING`
events with no upper bound on horizon.

The `Event` state machine `PENDING → SCHEDULED → FIRED` and `dispatch_task_id`
(stores the deterministic `fire-event-<id>` name) are reused. **No model change
is required.**

---

## Design — a rolling-window reconciler

```
   every 10 s:  sync_event_window(window_seconds=60)
        ┌───────────────────────────────────────────────────────────┐
        │ horizon = now + 60 s                                        │
        │                                                            │
        │ ARM   PENDING   AND scheduled_time <= horizon              │
        │        → _arm_event:  PENDING → SCHEDULED,                  │
        │          write fire-event-<id> ClockedSchedule+PeriodicTask │
        │        (includes past-due PENDING → past clocked_time →     │
        │         beat fires next tick)                               │
        │                                                            │
        │ DISARM SCHEDULED AND scheduled_time >  horizon             │
        │        → _disarm_event:  SCHEDULED → PENDING,               │
        │          delete fire-event-<id> PeriodicTask                │
        └───────────────────────────────────────────────────────────┘
                       │ beat dispatches armed rows at tick ≥ clocked_time
                       ▼
        ┌───────────────────────────────────────────────────────────┐
        │ fire_event(id) → fire_single_event  (unchanged in shape)   │
        │  • already fired / missing → no-op + teardown              │
        │  • pushed >1 s into future → defer (window will disarm)     │
        │  • else FIRED, fired_at = now, delete PeriodicTask          │
        └───────────────────────────────────────────────────────────┘
```

### Window math

The windower runs every **10 s** and arms everything due within **60 s**, so an
event entering the window is armed within ≤ 10 s of entering — i.e. armed **≥
~50 s before it fires**. Ample lead. Six scans cover the window, so a missed or
slow scan still leaves five more before the event is due.

Because `scheduled_time` only approaches `now` over time (it is fixed unless
re-timed), an event crosses the 60 s threshold **once**, gets armed, and never
disarms on its own. **No flapping** in steady state. The disarm path only fires
when a re-time pushes an already-`SCHEDULED` event back out past the horizon.

### Service changes ([services.py](../../../backend/apps/notifications/services.py))

- **Add `WINDOW_SECONDS = 60`** (the arming horizon).
- **`_arm_event(event)`** — unchanged. Claim + `_write_clocked_task`.
- **Add `_disarm_event(event)`** — status-guarded `SCHEDULED → PENDING` claim
  (the dedup lock for disarm, symmetric with arm), then
  `_teardown_clocked_task(event.id)` and clear `dispatch_task_id`. Returns whether
  it disarmed.
- **Add `sync_event_window(window_seconds=WINDOW_SECONDS) -> tuple[int, int]`** —
  the reconciler. Arms in-window `PENDING`, disarms out-of-window `SCHEDULED`.
  Returns `(armed, disarmed)`. Iterates with the status-guarded helpers so
  overlapping passes are safe.
- **`retime_event(event)`** — keep it **window-aware and immediate** (so a
  re-time to "fire in 5 s" doesn't wait up to 10 s for the next scan):
  - `FIRED` → return.
  - new `scheduled_time <= now + WINDOW` → arm/move in place (`_write_clocked_task`
    if already `SCHEDULED`, else `_arm_event`).
  - new `scheduled_time >  now + WINDOW` → `_disarm_event` if currently
    `SCHEDULED` (else nothing; it's already `PENDING` and out of window).
- **`fire_single_event(id)`** — keep idempotency + teardown. Change the **deferred
  branch** (event pushed into the future since beat dispatched it): re-evaluate
  against the window — if the new time is still within the window keep it armed at
  the new time, otherwise `_disarm_event`. (The windower would also fix this on
  its next pass; doing it inline avoids a stale near-term clocked row firing
  again before the next scan.)
- **Remove `reconcile_pending_events()`** — `sync_event_window` supersedes it (it
  *is* the reconciler, now horizon-bounded).

### Signal ([signals.py](../../../backend/apps/notifications/signals.py))

- **Do NOT arm on `created=True`.** New events stay `PENDING`; the windower arms
  them when they enter the 60 s horizon. This is the change that makes a million
  future inserts create **zero** beat rows.
- Keep `retime_event` on a genuine `scheduled_time` change (immediate, window-aware
  per above).

### `generate_future_events()` ([services.py](../../../backend/apps/notifications/services.py))

- **Drop the explicit arming loop.** Back to a pure data-creation helper — events
  are created `PENDING` and left for the windower. (With the defaults — events
  scattered over the next few minutes — most are outside the 60 s window at
  creation anyway, so arming them eagerly was wasted work.)

### Tasks ([tasks.py](../../../backend/apps/notifications/tasks.py))

- **Add `sync_event_window_task`** (the windower) — calls `sync_event_window`,
  logs `armed`/`disarmed` counts.
- **Remove `reconcile_pending_events_task`.**
- `fire_event`, `generate_events`, `cleanup_fired_clocked_tasks_task` — unchanged.

### Schedules ([scheduled_tasks.py](../../../backend/apps/tasks/scheduled_tasks.py))

- **Replace** `notifications-reconcile-pending` (every 1 min) with
  `notifications-schedule-window` → `sync_event_window_task`, **interval 10 s**.
- Keep `notifications-generate-events` and `notifications-cleanup-fired`.
- Run `just be-sync-tasks` to apply (prunes the old reconcile row; the
  `fire-event-*` pruning exclusion from the previous plan still protects armed
  rows).

### Indexing

Both windower queries — `status=PENDING, scheduled_time <= horizon` and
`status=SCHEDULED, scheduled_time > horizon` — are served by the existing
composite index `Index(fields=["status", "scheduled_time"])` on `Event`. No new
index needed; confirm the query planner uses it (`EXPLAIN`) under a large table.

---

## Phases

### Phase 1 — Windower service + disarm (core)

- [ ] `services.py`: add `WINDOW_SECONDS`, `_disarm_event`, `sync_event_window`.
- [ ] `services.py`: make `retime_event` window-aware (arm in-window / disarm
  out-of-window); update the `fire_single_event` deferred branch to re-evaluate
  against the window.
- [ ] `services.py`: remove `reconcile_pending_events`; drop the arming loop in
  `generate_future_events`.
- [ ] `signals.py`: stop arming on `created=True`.

### Phase 2 — Schedules

- [ ] `tasks.py`: add `sync_event_window_task`; remove
  `reconcile_pending_events_task`.
- [ ] `scheduled_tasks.py`: replace `notifications-reconcile-pending` with
  `notifications-schedule-window` (interval 10 s); `just be-sync-tasks`.

### Phase 3 — Tests & docs

- [ ] Rewrite/extend [tests.py](../../../backend/apps/notifications/tests.py):
  - `TestSyncEventWindow`: arms in-window `PENDING`; **ignores** out-of-window
    `PENDING` (the key assertion — proves we don't arm the backlog); arms past-due
    `PENDING`; disarms out-of-window `SCHEDULED` (status reverts, `PeriodicTask`
    deleted); leaves in-window `SCHEDULED` armed; returns `(armed, disarmed)`.
  - `TestRetimeOnSave`: re-time **into** the window arms immediately; re-time
    **out of** the window disarms (revert + delete row); FIRED ignored.
  - `TestGenerateFutureEvents`: events created `PENDING` with **no** clocked rows.
  - `TestFireSingleEvent`: deferred branch keeps in-window / disarms out-of-window;
    fire/already-fired/missing teardown unchanged.
  - Remove `TestReconciler`; keep `TestCleanup`.
- [ ] Update docs:
  [dynamic-scheduling.md](../../explanations/dynamic-scheduling.md),
  [architecture.md](../../explanations/architecture.md),
  [background-tasks.md](../../guides/background-tasks.md),
  [api-contracts.md](../../standards/api-contracts.md) — describe the 60 s window /
  10 s scan, the arm-forward/disarm-backward reconciler, the bounded beat-row
  count, and that arming is no longer at creation. Move this plan to
  `docs/plans/completed/` when done.

---

## Testing

- **Unit (Celery eager, `just be-test`):**
  - `sync_event_window` arms only `PENDING` rows inside the 60 s horizon and
    disarms only `SCHEDULED` rows outside it; idempotent across repeated passes.
  - Re-time into/out of the window arms/disarms immediately via the signal.
  - `generate_future_events` creates no beat rows.
  - `fire_single_event` idempotency, teardown, and window-aware defer.
- **Integration (live beat + worker, follow-up benchmark):** seed, say, 100 000
  far-future events (assert ~0 clocked rows), then a handful due in the next
  minute; assert only the near ones get armed and that
  `fired_at − scheduled_time` stays **p99 < 2 s** (unchanged beat-tick floor).
- **Scale check:** with N far-future events, `PeriodicTask` count stays ≈ the
  number due within 60 s, independent of N; beat per-tick scan time stays flat.
- **Re-time latency:** edit → next windower pass (≤ 10 s) for far→near moves, or
  immediate via the signal; fires at the new time with no restart.

---

## Risks & open questions

- **Near-term creation gap.** An event created with `scheduled_time` sooner than
  the next windower pass (≤ ~10 s out at creation) isn't armed until that pass,
  then fires immediately with a past `clocked_time` — so it can be up to one scan
  interval + one beat tick late. Events spread over minutes (the harness default)
  are unaffected. Tighten by lowering the scan interval if needed (cost: more
  frequent table scans).
- **Re-time accuracy depends on the signal.** A re-time into the window must arm
  immediately; if the signal is bypassed (`QuerySet.update`, `bulk_update`), the
  windower still arms within ≤ 10 s — acceptable unless the new time is < 10 s out.
  Document that out-of-band re-times of imminent events lose sub-window accuracy.
- **Disarm vs. dispatch race.** A re-time pushes an event out (`_disarm_event`
  deletes the row) just as beat dispatches the old near-term row. `fire_single_event`
  is the backstop: it sees the event isn't due (`scheduled_time > now`) and defers
  without firing. Covered by the deferred branch.
- **Boundary churn.** An event whose `scheduled_time` is repeatedly re-timed
  around the 60 s mark could arm/disarm each time. This is bounded by the re-time
  rate (a human action), not the scan. Optional **hysteresis** (arm ≤ 60 s,
  disarm > 70 s) removes it if it ever matters — left out for simplicity.
- **Cleanup still required.** `cleanup_fired_clocked_tasks` stays mandatory for
  rows beat disabled without teardown and for orphaned `ClockedSchedule` rows.
- **Beat remains the single point of firing** (unchanged from the prior plan): a
  beat outage stops firing; the DB stays the source of truth so a restart resumes.
- **Scope unchanged** — "firing" stays a status flip + log, so accuracy remains
  the measured quantity.
