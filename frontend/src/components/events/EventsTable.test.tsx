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

  it("shows a dash for the fired column when not yet fired", () => {
    render(<EventsTable events={[makeEvent({ fired_at: null })]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
