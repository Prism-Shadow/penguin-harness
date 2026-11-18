/**
 * GET /api/plugins/@penguinharness/pet/state — the pet's stored state; PATCH merges an
 * update into it and answers the merged document. The plugin's own route group, contributed
 * beside the ui/ file server on the same `/api/plugins` tree: the pet's page reads and writes
 * its state here with the user's cookie, and the `pet` commands reach the same document
 * through the same channel in-process, so every face of the pet sees one state.
 *
 * These routes exist only while the pet is loaded — they are its own contribution — so there
 * is no loaded-plugin check to make: any request that arrives here found a loaded pet. A PATCH
 * body must be a JSON object; it is merged SHALLOW over the stored document (a `null` value
 * drops its key). Any signed-in user may read and write: the state is the plugin's own
 * surface, gated by the plugin being installed, not by the document's contents.
 */
import { Hono } from "hono";
import type { PetStateChannel } from "./settings.js";

const PACKAGE_NAME = "@penguinharness/pet";

export function petStateRoutes(deps: { state: PetStateChannel }): Hono {
  const app = new Hono();

  app.get("/", (c) => c.json({ package: PACKAGE_NAME, state: deps.state.read() }));

  app.patch("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "The state update must be a JSON object." }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "bad_request", message: "The state update must be a JSON object." }, 400);
    }
    const next = deps.state.merge(body as Record<string, unknown>);
    return c.json({ package: PACKAGE_NAME, state: next });
  });

  return app;
}
