import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventsTable } from "./EventsTable";
import type { NotificationEvent } from "@/types/events";

function makeEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: "1",
    title: "Generated event 1",
    message: "msg",
    scheduled_time: "2026-06-18T05:24:00Z",
    status: "pending",
    fired_at: null,
    created_at: "2026-06-18T05:20:00Z",
    updated_at: "2026-06-18T05:20:00Z",
    ...overrides,
  };
}

describe("EventsTable", () => {
  it("shows an empty state when there are no events", () => {
    render(<EventsTable events={[]} />);
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });

  it("renders a row per event with its title", () => {
    render(
      <EventsTable
        events={[
          makeEvent({ id: "1", title: "First" }),
          makeEvent({ id: "2", title: "Second" }),
        ]}
      />,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("renders the status badge", () => {
    render(<EventsTable events={[makeEvent({ status: "fired" })]} />);
    expect(screen.getByText("fired")).toBeInTheDocument();
  });

  it("renders the scheduled (armed) status badge", () => {
    render(<EventsTable events={[makeEvent({ status: "scheduled" })]} />);
    expect(screen.getByText("scheduled")).toBeInTheDocument();
  });

  it("shows a dash in the fired and delay columns when not yet fired", () => {
    render(<EventsTable events={[makeEvent({ fired_at: null })]} />);
    // Both the Fired and Delay columns render a placeholder dash.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("shows the firing delay when an event has fired", () => {
    render(
      <EventsTable
        events={[
          makeEvent({
            status: "fired",
            scheduled_time: "2026-06-18T05:24:00.000Z",
            fired_at: "2026-06-18T05:24:03.210Z",
          }),
        ]}
      />,
    );
    expect(screen.getByText("+3.21s")).toBeInTheDocument();
  });
});
