import { setupServer } from "msw/node";

import { handlers } from "./handlers";

/** Shared MSW server for the Node (Vitest) test environment. */
export const server = setupServer(...handlers);
