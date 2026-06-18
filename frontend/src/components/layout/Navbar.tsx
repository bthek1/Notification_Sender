import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, Menu, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useUIStore } from "@/store/ui";
import { useMe, useLogout } from "@/hooks/useAuth";
import { SidebarNav } from "./Sidebar";

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate({ to: "/login" });
  }

  const displayName = me
    ? [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email
    : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      {/* Mobile: hamburger opens Sheet */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="flex h-14 flex-row items-center border-b px-4">
            <SheetTitle className="text-base font-semibold">My App</SheetTitle>
          </SheetHeader>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Desktop: hamburger collapses sidebar */}
      <Button
        variant="ghost"
        size="icon"
        className="hidden md:flex"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <span className="hidden text-sm font-semibold md:block">My App</span>

      <div className="flex-1" />

      <ThemeToggle />

      {displayName && (
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="hidden text-sm text-muted-foreground sm:block">
            {displayName}
          </span>
        </div>
      )}

      {me && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLogout}
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      )}
    </header>
  );
}
