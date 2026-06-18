import { apiClient } from "./client";

export async function getHealth(): Promise<{ status: string }> {
  const { data } = await apiClient.get<{ status: string }>("/api/health/");
  return data;
}
