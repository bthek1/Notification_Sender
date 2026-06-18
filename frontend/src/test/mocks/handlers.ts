import type { RequestHandler } from "msw";

/**
 * Default MSW request handlers for tests.
 *
 * Keep this list focused on stable, app-wide endpoints. Per-test behaviour
 * should be added with `server.use(...)` inside the test so it is reset by the
 * `afterEach` handler reset in `src/test/setup.ts`.
 *
 * Example:
 *   import { http, HttpResponse } from "msw";
 *   http.get("/api/health/", () => HttpResponse.json({ status: "ok" }));
 */
export const handlers: RequestHandler[] = [];
