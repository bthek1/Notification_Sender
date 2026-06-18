import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRouterState: vi.fn().mockReturnValue("/demo/chart"),
    Link: ({
      children,
      to,
      ...props
    }: {
      children: React.ReactNode;
      to: string;
      [key: string]: unknown;
    }) => (
      <a href={to as string} {...props}>
        {children}
      </a>
    ),
  };
});

import { Sidebar, SidebarNav } from "./Sidebar";

describe("SidebarNav", () => {
  it("renders all nav items", () => {
    render(<SidebarNav />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it('marks the active link with aria-current="page"', () => {
    render(<SidebarNav />);
    const link = screen.getByText("Dashboard").closest("a");
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("renders icon-only labels as title attributes when collapsed", () => {
    render(<SidebarNav collapsed />);
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    const link = screen.getByTitle("Dashboard");
    expect(link).toBeInTheDocument();
  });
});

describe("Sidebar", () => {
  it("renders with full width class when open", () => {
    // sidebarOpen defaults to true in the store
    const { container } = render(<Sidebar />);
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("w-64");
  });
});
