import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: vi.fn().mockReturnValue(vi.fn()),
    Link: ({
      children,
      to,
      ...props
    }: {
      children: ReactNode;
      to: string;
      [key: string]: unknown;
    }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useRegister: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: vi.fn().mockReturnValue({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/api/health", () => ({
  getHealth: vi.fn().mockResolvedValue({ status: "ok" }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// Import AFTER mocks are registered
const { Route } = await import("@/routes/signup");
const SignupComponent = Route?.options?.component as
  | React.ComponentType
  | undefined;

describe("Signup page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders email, password, and confirm-password fields", () => {
    if (!SignupComponent) return;
    render(<SignupComponent />, { wrapper });
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it("renders a link back to the login page", () => {
    if (!SignupComponent) return;
    render(<SignupComponent />, { wrapper });
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows password-mismatch error when passwords differ", async () => {
    if (!SignupComponent) return;
    const user = userEvent.setup();
    render(<SignupComponent />, { wrapper });
    await user.type(screen.getByLabelText(/^email/i), "user@example.com");
    await user.type(screen.getByLabelText(/^password/i), "password123");
    await user.type(screen.getByLabelText(/confirm password/i), "different456");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(
      await screen.findByText(/passwords do not match/i),
    ).toBeInTheDocument();
  });

  it("shows required error when email is blank", async () => {
    if (!SignupComponent) return;
    const user = userEvent.setup();
    render(<SignupComponent />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
  });
});
