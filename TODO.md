# TODO

- [x] update the state machine of `Event.Status` to model the dispatch lifecycle:
      `PENDING → SCHEDULED → FIRED` (a re-time sends `SCHEDULED → PENDING`).
      Added the `SCHEDULED` state + migration `0003_alter_event_status`; wired the
      transitions in `apps/notifications/services.py`; threaded the new status
      through the frontend badge + timeline chart. See
      [docs/explanations/dynamic-scheduling.md](docs/explanations/dynamic-scheduling.md#the-event-state-machine).
