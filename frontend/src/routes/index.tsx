import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { HeroBanner } from "@/components/home/HeroBanner";
import { useMe } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const { data: me } = useMe();
  const navigate = useNavigate();

  // Redirect authenticated users to the main app
  useEffect(() => {
    if (me) {
      navigate({ to: "/demo/chart" });
    }
  }, [me, navigate]);

  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <HeroBanner />
    </div>
  );
}
