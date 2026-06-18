import type {
  GenerateEventsPayload,
  GenerateEventsResponse,
  NotificationEvent,
} from "@/types/events";

import { apiClient } from "./client";

export async function listEvents(): Promise<NotificationEvent[]> {
  const { data } = await apiClient.get<NotificationEvent[]>(
    "/api/notifications/events/",
  );
  return data;
}

export async function generateEvents(
  payload: GenerateEventsPayload = {},
): Promise<GenerateEventsResponse> {
  const { data } = await apiClient.post<GenerateEventsResponse>(
    "/api/notifications/events/generate/",
    payload,
  );
  return data;
}
