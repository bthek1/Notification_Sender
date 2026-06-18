import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "@/store/ui";

// Mock hooks that require router / query context
vi.mock("@/hooks/useAuth", () => ({
  useMe: vi.fn().mockReturnValue({ data: null }),
  useLogout: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: vi.fn().mockReturnValue(vi.fn()),
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

vi.mock("@/hooks/useTheme", () => ({
  useTheme: vi.fn().mockReturnValue({ theme: "light", setTheme: vi.fn() }),
}));

import { Navbar } from "./Navbar";
import * as authHooks from "@/hooks/useAuth";

describe("Navbar", () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarOpen: true });
    vi.clearAllMocks();
    // Reset useMe to unauthenticated
    vi.mocked(authHooks.useMe).mockReturnValue({ data: null } as ReturnType<
      typeof authHooks.useMe
    >);
  });

  it("renders the app name", () => {
    render(<Navbar />);
    expect(screen.getAllByText("My App").length).toBeGreaterThan(0);
  });

  it("renders the mobile hamburger button", () => {
    render(<Navbar />);
    expect(screen.getByLabelText("Open navigation")).toBeInTheDocument();
  });

  it("renders the desktop sidebar toggle button", () => {
    render(<Navbar />);
    expect(screen.getByLabelText("Toggle sidebar")).toBeInTheDocument();
  });

  it("calls toggleSidebar when desktop hamburger is clicked", async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    const toggle = screen.getByLabelText("Toggle sidebar");
    await user.click(toggle);
    expect(useUIStore.getState().sidebarOpen).toBe(false);
  });

  it("does not show sign-out button when not authenticated", () => {
    render(<Navbar />);
    expect(screen.queryByLabelText("Sign out")).not.toBeInTheDocument();
  });

  it("shows sign-out button when authenticated", () => {
    vi.mocked(authHooks.useMe).mockReturnValue({
      data: {
        id: "1",
        email: "test@example.com",
        first_name: "",
        last_name: "",
        date_joined: "",
      },
    } as ReturnType<typeof authHooks.useMe>);
    render(<Navbar />);
    expect(screen.getByLabelText("Sign out")).toBeInTheDocument();
  });
});
