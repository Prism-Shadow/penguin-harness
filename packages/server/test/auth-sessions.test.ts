/**
 * The session jar behind "switch account" (routes/auth.ts): signing into a second account
 * parks the first instead of dropping it, switching back needs no password, parking leaves
 * a session alive while signing the browser out of it, and Sign out is total — every session
 * in the jar is deleted server-side. Tokens never leave the HttpOnly cookies, so these tests
 * drive a real cookie jar rather than a single header.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AuthSessionsResponse, ErrorBody, MeResponse } from "../src/api/types.js";
import type { AppEnv } from "../src/auth/middleware.js";
import { createTestApp, provisionUser, TEST_ADMIN_PASSWORD } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** Browser-like cookie jar: absorbs every Set-Cookie (including deletions) and replays them. */
function browser(app: Hono<AppEnv>) {
  const store = new Map<string, string>();
  const absorb = (res: Response): Response => {
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      // Hono's deleteCookie clears the value and sets Max-Age=0.
      if (value === "" || /max-age=0/i.test(raw)) store.delete(name);
      else store.set(name, value);
    }
    return res;
  };
  const headers = (json: boolean) => ({
    ...(store.size > 0 ? { cookie: [...store].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
    ...(json ? { "content-type": "application/json" } : {}),
  });
  return {
    cookies: store,
    get: async (path: string) => absorb(await app.request(path, { headers: headers(false) })),
    post: async (path: string, body?: unknown) =>
      absorb(
        await app.request(path, {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify(body ?? {}),
        }),
      ),
    login: async (userId: string, password: string) => {
      const res = await absorb(
        await app.request("/api/auth/login", {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify({ userId, password }),
        }),
      );
      if (res.status !== 200) throw new Error(`login ${userId}: ${res.status}`);
      return res;
    },
  };
}

/** The accounts the jar reports, active first. */
async function listed(b: ReturnType<typeof browser>): Promise<Array<[string, boolean]>> {
  const res = await b.get("/api/auth/sessions");
  const body = (await res.json()) as AuthSessionsResponse;
  return body.sessions.map((s) => [s.userId, s.active]);
}

/** Who the jar's active cookie authenticates as, or null when signed out. */
async function whoami(b: ReturnType<typeof browser>): Promise<string | null> {
  const res = await b.get("/api/me");
  if (res.status === 401) return null;
  return ((await res.json()) as MeResponse).user.userId;
}

describe("session jar", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
    await provisionUser(t.app, "alice");
    await provisionUser(t.app, "bob");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("a second sign-in parks the first account instead of dropping it", async () => {
    const b = browser(t.app);
    await b.login("alice", "password-123");
    expect(await listed(b)).toEqual([["alice", true]]);
    await b.login("bob", "password-123");
    expect(await whoami(b)).toBe("bob");
    expect(await listed(b)).toEqual([
      ["bob", true],
      ["alice", false],
    ]);
  });

  it("switching back needs no password and swaps the active pointer", async () => {
    const b = browser(t.app);
    await b.login("alice", "password-123");
    await b.login("bob", "password-123");

    const res = await b.post("/api/auth/switch", { userId: "alice" });
    expect(res.status).toBe(200);
    expect(await whoami(b)).toBe("alice");
    expect(await listed(b)).toEqual([
      ["alice", true],
      ["bob", false],
    ]);
    // …and back again: bob's session survived the round trip.
    expect((await b.post("/api/auth/switch", { userId: "bob" })).status).toBe(200);
    expect(await whoami(b)).toBe("bob");
  });

  it("switching to an account that is not in the jar is a 404 and changes nothing", async () => {
    const b = browser(t.app);
    await b.login("alice", "password-123");
    const res = await b.post("/api/auth/switch", { userId: "bob" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe("not_found");
    expect(await whoami(b)).toBe("alice");
  });

  it("park signs this browser out while keeping the session switchable", async () => {
    const b = browser(t.app);
    await b.login("alice", "password-123");
    expect((await b.post("/api/auth/park")).status).toBe(204);
    // Unauthenticated…
    expect(await whoami(b)).toBeNull();
    // …but the account is still listed, and comes back without a password.
    expect(await listed(b)).toEqual([["alice", false]]);
    expect((await b.post("/api/auth/switch", { userId: "alice" })).status).toBe(200);
    expect(await whoami(b)).toBe("alice");
  });

  it("sign out is total: every parked session is destroyed server-side", async () => {
    const b = browser(t.app);
    await b.login("alice", "password-123");
    await b.login("bob", "password-123");
    // Keep the raw cookie header to prove the tokens are dead, not merely forgotten.
    const stolen = [...b.cookies].map(([k, v]) => `${k}=${v}`).join("; ");

    expect((await b.post("/api/auth/logout")).status).toBe(204);
    expect(b.cookies.size).toBe(0);
    expect(await listed(b)).toEqual([]);

    const replay = await t.app.request("/api/me", { headers: { cookie: stolen } });
    expect(replay.status).toBe(401);
    const replaySwitch = await t.app.request("/api/auth/switch", {
      method: "POST",
      headers: { cookie: stolen, "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice" }),
    });
    expect(replaySwitch.status).toBe(404);
  });

  it("signing in twice as the same account keeps one entry", async () => {
    const b = browser(t.app);
    await b.login("alice", "password-123");
    await b.login("bob", "password-123");
    await b.login("alice", "password-123");
    expect(await listed(b)).toEqual([
      ["alice", true],
      ["bob", false],
    ]);
  });

  it("caps the jar, dropping and destroying the least recently parked account", async () => {
    const b = browser(t.app);
    // 1 active + 5 parked is the cap; a seventh account pushes the oldest out.
    for (const id of ["u1", "u2", "u3", "u4", "u5", "u6"]) await provisionUser(t.app, id);
    await b.login("u1", "password-123");
    const firstCookie = [...b.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    for (const id of ["u2", "u3", "u4", "u5", "u6"]) await b.login(id, "password-123");
    await b.login("admin", TEST_ADMIN_PASSWORD);

    const ids = (await listed(b)).map(([id]) => id);
    expect(ids).toHaveLength(6);
    expect(ids[0]).toBe("admin");
    expect(ids).not.toContain("u1");
    // The evicted session is deleted, not just forgotten by the cookie.
    const replay = await t.app.request("/api/me", { headers: { cookie: firstCookie } });
    expect(replay.status).toBe(401);
  });

  it("expired and unknown tokens are pruned from the jar rather than reported", async () => {
    const b = browser(t.app);
    await b.login("alice", "password-123");
    await b.login("bob", "password-123");
    // Expire alice's parked session the way time would.
    t.deps.db
      .prepare("UPDATE auth_sessions SET expires_at = ? WHERE user_id = ?")
      .run("2000-01-01T00:00:00.000Z", "alice");
    expect(await listed(b)).toEqual([["bob", true]]);
    expect((await b.post("/api/auth/switch", { userId: "alice" })).status).toBe(404);
  });
});
