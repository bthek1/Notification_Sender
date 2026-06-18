import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listSchedules, toggleSchedule, triggerSchedule } from "@/api/tasks";
import { queryKeys } from "@/api/queryKeys";

/**
 * Fetch all Celery periodic (scheduled) tasks, kept live without a reload. A
 * short refetch interval keeps `last_run_at` / `total_run_count` fresh as beat
 * fires tasks. `staleTime: 0` overrides the global 5-minute default so
 * refetch-on-focus / -reconnect actually fire. The interval auto-pauses while
 * the tab is hidden (TanStack's default `refetchIntervalInBackground: false`).
 */
export function useSchedules() {
  return useQuery({
    queryKey: queryKeys.tasks.schedules,
    queryFn: listSchedules,
    refetchInterval: 3_000,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/** Enable or disable a periodic task, then refresh the list. */
export function useToggleSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      toggleSchedule(id, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.schedules,
      });
    },
  });
}

/** Fire a periodic task immediately (out of band from its schedule). */
export function useTriggerSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => triggerSchedule(id),
    onSuccess: () => {
      // The run count / last-run update server-side moments later; give the
      // worker a brief head start before refetching.
      setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.tasks.schedules,
        });
      }, 1000);
    },
  });
}
