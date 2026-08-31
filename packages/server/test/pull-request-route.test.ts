/**
 * `GET /api/sessions/:sessionId/pull-request` is mounted and guarded.
 *
 * The service behind it is unit-tested next door; what this covers is the wiring, which the
 * unit tests cannot see: that the route exists at all (a chip whose endpoint 404s as "no such
 * route" looks exactly like a Workspace with no pull request), and that it answers about a
 * Session the way every other Session route does rather than running `gh` somewhere on the
 * strength of an id a stranger sent.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("the Workspace pull request endpoint", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    owner = apiClient(t.app, a.cookie);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("is mounted: an unknown Session is 404 by the Session guard, not by a missing route", async () => {
    const res = await owner.get("/api/sessions/no-such-session/pull-request");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    // The Session guard's own code. A route that was never registered answers `not_found`
    // from the app's fallback instead, which is the failure this pins.
    expect(body.error?.code).toBe("session_not_found");
  });

  it("requires a session cookie, like every other Session route", async () => {
    const res = await t.app.request("/api/sessions/no-such-session/pull-request");
    expect(res.status).toBe(401);
  });
});
