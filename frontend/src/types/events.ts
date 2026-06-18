export type EventStatus = "pending" | "fired";

export interface NotificationEvent {
  id: string;
  title: string;
  message: string;
  scheduled_time: string;
  status: EventStatus;
  fired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GenerateEventsPayload {
  count?: number;
  within_minutes?: number;
}

export interface GenerateEventsResponse {
  task_id: string;
}
