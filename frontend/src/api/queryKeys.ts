export const queryKeys = {
  auth: {
    me: ["auth", "me"] as const,
    register: ["auth", "register"] as const,
  },
  health: ["health"] as const,
  tasks: {
    status: (taskId: string) => ["tasks", taskId] as const,
  },
} as const;
