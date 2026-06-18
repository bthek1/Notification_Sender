import { useQuery } from "@tanstack/react-query";
import { getHealth } from "@/api/health";
import { queryKeys } from "@/api/queryKeys";
import { cn } from "@/lib/utils";

/**
 * Small indicator shown on public pages (login, signup) so users can see
 * at a glance whether the backend API is reachable before attempting to log in.
 */
export function BackendStatus() {
  const { status } = useQuery({
    queryKey: queryKeys.health,
    queryFn: getHealth,
    retry: 1,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const isConnected = status === "success";
  const isPending = status === "pending";

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          isPending && "bg-muted-foreground animate-pulse",
          isConnected && "bg-green-500",
          status === "error" && "bg-destructive",
        )}
        aria-hidden="true"
      />
      <span>
        {isPending && "Connecting…"}
        {isConnected && "API connected"}
        {status === "error" && "API unreachable"}
      </span>
    </div>
  );
}
