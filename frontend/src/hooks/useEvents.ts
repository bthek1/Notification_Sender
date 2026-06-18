import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { generateEvents, listEvents } from "@/api/events";
import { queryKeys } from "@/api/queryKeys";
import type { GenerateEventsPayload } from "@/types/events";

/**
 * Fetch all events, kept live without a reload. A short refetch interval lets
 * events transitioning from `pending` → `scheduled` → `fired` (by the backend
 * worker) appear within a couple of seconds. `staleTime: 0` overrides the
 * global 5-minute default so refetch-on-focus / -reconnect actually fire. The
 * interval auto-pauses while the tab is hidden (TanStack's default
 * `refetchIntervalInBackground: false`), so we don't poll in the background.
 */
export function useEvents() {
  return useQuery({
    queryKey: queryKeys.events.all,
    queryFn: listEvents,
    refetchInterval: 2_000,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
