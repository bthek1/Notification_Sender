import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listSchedules, toggleSchedule, triggerSchedule } from "@/api/tasks";
import { queryKeys } from "@/api/queryKeys";

/**
 * Fetch all Celery periodic (scheduled) tasks. Refetches on an interval so
 * that `last_run_at` / `total_run_count` stay roughly fresh as beat fires
 * tasks, without requiring a manual reload.
 */
export function useSchedules() {
  return useQuery({
    queryKey: queryKeys.tasks.schedules,
    queryFn: listSchedules,
    refetchInterval: 10_000,
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
