import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui";
import { navItems } from "./navItems";

export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="flex flex-col gap-1 p-2">
      {navItems.map((item) => {
        const isActive = pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              "flex items-center rounded-md text-sm transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              collapsed ? "justify-center p-2" : "gap-3 px-3 py-2",
            )}
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col border-r bg-sidebar shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden",
        sidebarOpen ? "w-64" : "w-16",
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex h-14 items-center border-b shrink-0",
          sidebarOpen ? "px-4" : "justify-center",
        )}
      >
        <span className="font-semibold text-sidebar-foreground truncate">
          {sidebarOpen ? "My App" : "M"}
        </span>
      </div>

      <SidebarNav collapsed={!sidebarOpen} />
    </aside>
  );
}
