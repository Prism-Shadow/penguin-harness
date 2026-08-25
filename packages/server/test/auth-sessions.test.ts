/**
 * Sessions as rows in auth_sessions (auth/service.ts): the cookie carries a random token, the
 * row stores its sha256. Every property the row model is chosen FOR is pinned here — a session
 * survives a restart (it is on disk), logout deletes the row, an admin reset deletes the
 * user's rows, and sliding renewal tops the expiry up IN PLACE so the cookie value never
 * changes and a short minted token never stretches into a long one.
 */
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { apiClient, cookieFrom, createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The session TTL test apps are built with (helpers.ts) — fixtures derive from it, not from literals. */
const TEST_SESSION_TTL_MS = 30 * DAY_MS;

describe("auth sessions", () => {
  it("survives a restart, because the session is a row on disk", async () => {
    const root = await makeTempRoot();
    const config = { root, dbPath: `${root}/web.db` };
    const t = await createTestApp({ config });
    let cookie: string;
    try {
      cookie = (await loginAdmin(t.app)).cookie;
      expect((await apiClient(t.app, cookie).get("/api/me")).status).toBe(200);
    } finally {
      await t.cleanup();
    }
    // A new process on the same database: the row is still there, so the cookie still works —
    // a restart does not sign everyone out.
    const reborn = await createTestApp({ config });
    try {
      expect((await apiClient(reborn.app, cookie).get("/api/me")).status).toBe(200);
    } finally {
      await reborn.cleanup();
    }
  });

  it("logout deletes the row, and it stays deleted across a restart", async () => {
    const root = await makeTempRoot();
    const config = { root, dbPath: `${root}/web.db` };
    const t = await createTestApp({ config });
    let cookie: string;
    try {
      cookie = (await loginAdmin(t.app)).cookie;
      await apiClient(t.app, cookie).post("/api/auth/logout");
      expect((await apiClient(t.app, cookie).get("/api/me")).status).toBe(401);
    } finally {
      await t.cleanup();
    }
    const reborn = await createTestApp({ config });
    try {
      expect((await apiClient(reborn.app, cookie).get("/api/me")).status).toBe(401);
    } finally {
      await reborn.cleanup();
    }
  });

  it("expired rows are swept on login", async () => {
    let nowMs = Date.now();
    const t = await createTestApp({ now: () => new Date(nowMs) });
    try {
      await loginAdmin(t.app);
      const rows = () =>
        Number(
          (t.deps.db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get() as { n: unknown }).n,
        );
      expect(rows()).toBe(1);
      // Past the TTL, the row is dead weight; the next login sweeps it (and adds its own).
      nowMs += TEST_SESSION_TTL_MS + DAY_MS;
      await loginAdmin(t.app);
      expect(rows()).toBe(1);
    } finally {
      await t.cleanup();
    }
  });

  it("an admin password reset deletes the user's sessions", async () => {
    const t = await createTestApp();
    try {
      const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
      await admin.post("/api/admin/users", { userId: "alice", password: "alice-pass-1" });
      const login = await t.app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "alice", password: "alice-pass-1" }),
      });
      const aliceCookie = cookieFrom(login);
      expect((await apiClient(t.app, aliceCookie).get("/api/me")).status).toBe(200);

      await t.deps.adminService.resetPassword("alice", "fresh-pass-1");
      expect((await apiClient(t.app, aliceCookie).get("/api/me")).status).toBe(401);
    } finally {
      await t.cleanup();
    }
  });

  it("slides a long session in place (same cookie), and never stretches a short one", async () => {
    let nowMs = Date.now();
    const t = await createTestApp({ now: () => new Date(nowMs) });
    try {
      const cookie = (await loginAdmin(t.app)).cookie;
      const token = cookie.split("=").slice(1).join("=");
      // Two days in, past the renewal threshold (29 days): the request tops up the expiry and
      // refreshes the cookie, but the token VALUE is unchanged — same session, longer life.
      nowMs += 2 * DAY_MS;
      const res = await apiClient(t.app, cookie).get("/api/me");
      expect(res.status).toBe(200);
      const refreshed = cookieFrom(res);
      expect(refreshed).toBe(`${SESSION_COOKIE}=${token}`);
      // The DB expiry moved forward to now+TTL.
      const row = t.deps.db.prepare("SELECT expires_at FROM auth_sessions LIMIT 1").get() as {
        expires_at: string;
      };
      expect(Date.parse(row.expires_at)).toBeGreaterThan(nowMs + TEST_SESSION_TTL_MS - DAY_MS);
    } finally {
      await t.cleanup();
    }
  });

  it("a short cli token expires at its hour rather than renewing", async () => {
    // A cli token spans an hour, well under the renewal window, so being used must not top it
    // up to the full term. Insert one directly (as `penguin auth token` does) and use it.
    let nowMs = Date.now();
    const t = await createTestApp({ now: () => new Date(nowMs) });
    try {
      const { createHash, randomBytes } = await import("node:crypto");
      const token = randomBytes(32).toString("base64url");
      const hash = createHash("sha256").update(token).digest("hex");
      t.deps.db
        .prepare(
          "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, via) VALUES (?,?,?,?,?)",
        )
        .run(
          hash,
          "admin",
          new Date(nowMs).toISOString(),
          new Date(nowMs + 60 * 60_000).toISOString(),
          "cli",
        );
      const res = await apiClient(t.app, `${SESSION_COOKIE}=${token}`).get("/api/me");
      expect(res.status).toBe(200);
      // No renewal cookie, and the expiry did not move to the full term.
      expect(res.headers.get("set-cookie")).toBeNull();
      const row = t.deps.db
        .prepare("SELECT expires_at FROM auth_sessions WHERE token_hash = ?")
        .get(hash) as { expires_at: string };
      expect(Date.parse(row.expires_at)).toBe(nowMs + 60 * 60_000);
    } finally {
      await t.cleanup();
    }
  });
});
