import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createFileRoute: vi
      .fn()
      .mockImplementation(
        (path: string) => (opts: Record<string, unknown>) => ({ path, options: opts }),
      ),
  };
});

vi.mock("@/api/events", () => ({
  listEvents: vi.fn(),
  generateEvents: vi.fn(),
}));

// echarts-for-react pulls in a heavy canvas-based chart; stub it out.
vi.mock("@/components/charts/EChartsChart", () => ({
  default: () => <div data-testid="echarts" />,
}));

import * as eventsApi from "@/api/events";
import type { NotificationEvent } from "@/types/events";

const { Route } = await import("@/routes/events");
const EventsPage = Route?.options?.component as React.ComponentType | undefined;

// Default to a scheduled time a few minutes in the future so fixtures fall
// inside the page's recent-past-to-future window unless a test overrides it.
function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function makeEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: "1",
    title: "Generated event 1",
    message: "msg",
    scheduled_time: minutesFromNow(5),
    status: "pending",
    fired_at: null,
    created_at: minutesFromNow(-5),
    updated_at: minutesFromNow(-5),
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("EventsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders fetched events in the table", async () => {
    if (!EventsPage) throw new Error("EventsPage component not found");
    vi.mocked(eventsApi.listEvents).mockResolvedValue([
      makeEvent({ id: "1", title: "Event A" }),
      makeEvent({ id: "2", title: "Event B", status: "fired" }),
    ]);

    render(<EventsPage />, { wrapper });

    expect(await screen.findByText("Event A")).toBeInTheDocument();
    expect(screen.getByText("Event B")).toBeInTheDocument();
  });

  it("shows the summary counts", async () => {
    if (!EventsPage) throw new Error("EventsPage component not found");
    vi.mocked(eventsApi.listEvents).mockResolvedValue([
      makeEvent({ id: "1", status: "pending" }),
      makeEvent({ id: "2", status: "fired" }),
    ]);

    render(<EventsPage />, { wrapper });

    expect(
      await screen.findByText(/2 total · 1 pending · 1 fired/i),
    ).toBeInTheDocument();
  });

  it("dispatches the generate task when the button is clicked", async () => {
    if (!EventsPage) throw new Error("EventsPage component not found");
    vi.mocked(eventsApi.listEvents).mockResolvedValue([]);
    vi.mocked(eventsApi.generateEvents).mockResolvedValue({ task_id: "t-1" });

    render(<EventsPage />, { wrapper });

    const button = await screen.findByRole("button", { name: /generate/i });
    await userEvent.click(button);

    await waitFor(() =>
      expect(eventsApi.generateEvents).toHaveBeenCalledWith({
        count: 10,
        within_minutes: 5,
      }),
    );
  });

  it("hides events outside the default ±10 minute window", async () => {
    if (!EventsPage) throw new Error("EventsPage component not found");
    vi.mocked(eventsApi.listEvents).mockResolvedValue([
      makeEvent({ id: "1", title: "Recent event" }),
      makeEvent({
        id: "2",
        title: "Stale event",
        status: "fired",
        scheduled_time: minutesFromNow(-60),
        fired_at: minutesFromNow(-60),
      }),
      makeEvent({
        id: "3",
        title: "Far future event",
        scheduled_time: minutesFromNow(30),
      }),
    ]);

    render(<EventsPage />, { wrapper });

    expect(await screen.findByText("Recent event")).toBeInTheDocument();
    expect(screen.queryByText("Stale event")).not.toBeInTheDocument();
    expect(screen.queryByText("Far future event")).not.toBeInTheDocument();
    // Summary counts reflect only the in-window events.
    expect(screen.getByText(/1 total · 1 pending · 0 fired/i)).toBeInTheDocument();
  });

  it("widening the range reveals events further ahead", async () => {
    if (!EventsPage) throw new Error("EventsPage component not found");
    vi.mocked(eventsApi.listEvents).mockResolvedValue([
      makeEvent({ id: "1", title: "Recent event" }),
      makeEvent({
        id: "3",
        title: "Far future event",
        scheduled_time: minutesFromNow(30),
      }),
    ]);

    render(<EventsPage />, { wrapper });

    expect(await screen.findByText("Recent event")).toBeInTheDocument();
    expect(screen.queryByText("Far future event")).not.toBeInTheDocument();

    // Re-centre the range to ±1h; the +30m event now falls inside it.
    await userEvent.click(screen.getByRole("button", { name: "±1h" }));

    expect(await screen.findByText("Far future event")).toBeInTheDocument();
  });

  it("shows an error message when loading fails", async () => {
    if (!EventsPage) throw new Error("EventsPage component not found");
    vi.mocked(eventsApi.listEvents).mockRejectedValue(new Error("boom"));

    render(<EventsPage />, { wrapper });

    const errors = await screen.findAllByText(/failed to load events/i);
    expect(errors.length).toBeGreaterThan(0);
  });
});
