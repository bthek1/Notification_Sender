import type {
  PeriodicTask,
  TaskResult,
  TaskTriggerResponse,
} from "@/types/tasks";

import { apiClient } from "./client";

export async function listSchedules(): Promise<PeriodicTask[]> {
  const { data } = await apiClient.get<PeriodicTask[]>(
    "/api/tasks/schedules/",
  );
  return data;
}

export async function toggleSchedule(
  id: number,
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  const { data } = await apiClient.patch<{ enabled: boolean }>(
    `/api/tasks/schedules/${id}/`,
    { enabled },
  );
  return data;
}

export async function triggerSchedule(
  id: number,
): Promise<TaskTriggerResponse> {
  const { data } = await apiClient.post<TaskTriggerResponse>(
    `/api/tasks/schedules/${id}/trigger/`,
  );
  return data;
}

export async function triggerTask(
  payload: Record<string, unknown>,
): Promise<TaskTriggerResponse> {
  const { data } = await apiClient.post<TaskTriggerResponse>(
    "/api/tasks/trigger/",
    payload,
  );
  return data;
}

export async function fetchTaskStatus<T = unknown>(
  taskId: string,
): Promise<TaskResult<T>> {
  const { data } = await apiClient.get<TaskResult<T>>(`/api/tasks/${taskId}/`);
  return data;
}

export async function revokeTask(
  taskId: string,
  terminate = false,
): Promise<{ task_id: string; revoked: boolean }> {
  const { data } = await apiClient.post(`/api/tasks/${taskId}/revoke/`, {
    terminate,
  });
  return data;
}
