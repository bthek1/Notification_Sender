import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { generateEvents, listEvents } from "@/api/events";
import { queryKeys } from "@/api/queryKeys";
import type { GenerateEventsPayload } from "@/types/events";

/**
 * Fetch all events. Refetches on an interval so that events transitioning
 * from `pending` to `fired` (by the backend worker) show up without a reload.
 */
export function useEvents() {
  return useQuery({
    queryKey: queryKeys.events.all,
    queryFn: listEvents,
    refetchInterval: 10_000,
  });
}

/**
 * Dispatch the generate-events background task, then invalidate the events
 * list so newly created events appear. The task creates them quickly, so we
 * refetch shortly after the dispatch resolves.
 */
export function useGenerateEvents() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GenerateEventsPayload) => generateEvents(payload),
    onSuccess: () => {
      // The events are created server-side moments after dispatch; give the
      // worker a brief head start before refetching the list.
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      }, 1000);
    },
  });
}
