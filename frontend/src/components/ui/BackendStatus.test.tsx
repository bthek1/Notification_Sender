import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@/api/health", () => ({
  getHealth: vi.fn(),
}));

import { BackendStatus } from "./BackendStatus";
import * as healthApi from "@/api/health";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("BackendStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Connecting…" while the request is in flight', () => {
    vi.mocked(healthApi.getHealth).mockReturnValue(new Promise(() => {})); // never resolves
    render(<BackendStatus />, { wrapper });
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('shows "API connected" on success', async () => {
    vi.mocked(healthApi.getHealth).mockResolvedValue({ status: "ok" });
    render(<BackendStatus />, { wrapper });
    expect(await screen.findByText(/api connected/i)).toBeInTheDocument();
  });

  it('shows "API unreachable" on error', async () => {
    vi.mocked(healthApi.getHealth).mockRejectedValue(
      new Error("Network Error"),
    );
    render(<BackendStatus />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/api unreachable/i)).toBeInTheDocument(),
    );
  });

  it("renders a status dot with aria-hidden", async () => {
    vi.mocked(healthApi.getHealth).mockResolvedValue({ status: "ok" });
    render(<BackendStatus />, { wrapper });
    await screen.findByText(/api connected/i);
    const dot = document.querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
  });
});
