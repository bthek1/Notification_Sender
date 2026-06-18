import {
  createRootRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";

// These paths render without the app shell (no navbar/sidebar)
const PUBLIC_PATHS = ["/", "/login", "/signup"];

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (isPublic) return <Outlet />;
  return <AppLayout />;
}
