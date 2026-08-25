/**
 * Sessions as signed statements (auth/token-codec.ts) — what the row model guaranteed, the
 * signature must still guarantee.
 *
 * The switch moves the per-request hot path off the database, and every property it could
 * silently lose is pinned here: logout must still be a real revocation that SURVIVES a
 * restart (the denylist row is the only session state left, so losing it means a "signed
 * out" token that quietly works again); an admin password reset must still kill the user's
 * outstanding sessions (there are no rows to delete — the not-before mark is the mechanism);
 * and sliding renewal must still slide, now as a replacement cookie.
 */
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { newClaims, signToken, verifyToken } from "../src/auth/token-codec.js";
import { readOwnerToken } from "../src/auth/owner-token.js";
import { apiClient, cookieFrom, createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The session TTL test apps are built with (helpers.ts) — fixtures derive from it, not from literals. */
const TEST_SESSION_TTL_MS = 30 * DAY_MS;

describe("token codec", () => {
  const secret = Buffer.alloc(32, 7);

  it("round-trips, and refuses tampering, the wrong key, and junk", () => {
    const claims = newClaims("admin", "cli", 1_000_000, 3_600_000);
    const token = signToken(claims, secret);
    expect(verifyToken(token, secret)).toEqual(claims);
    // A flipped payload byte, a re-signed payload under another key, and non-tokens all die
    // at the signature — not at whatever JSON.parse would have made of them.
    const [v, payload, mac] = token.split(".") as [string, string, string];
    expect(verifyToken(`${v}.${payload.slice(0, -2)}aa.${mac}`, secret)).toBeNull();
    expect(verifyToken(token, Buffer.alloc(32, 8))).toBeNull();
    expect(verifyToken("v1.not-even.close", secret)).toBeNull();
    expect(verifyToken("", secret)).toBeNull();
  });

  it("logout is a revocation that outlives the process, given the same key", async () => {
    // In production each process has its OWN key, so a restart voids every signed token by
    // signature alone (pinned below). The denylist's job is the other half: while a key is
    // LIVE, a logged-out token must stay dead — including across an App swap, which keeps
    // the process and therefore the key. Same key + same database is exactly that shape.
    const tokenSecret = Buffer.alloc(32, 9);
    const root = await makeTempRoot();
    const config = { root, dbPath: `${root}/web.db` };
    const t = await createTestApp({ config, tokenSecret });
    let token: string;
    try {
      const { cookie } = await loginAdmin(t.app);
      token = cookie.split("=").slice(1).join("=");
      // Issuance writes nothing: the only session state the database may hold is a revocation.
      await t.app.request("/api/auth/logout", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
      });
      expect((await apiClient(t.app, cookie).get("/api/me")).status).toBe(401);
    } finally {
      await t.cleanup();
    }
    // Same key, fresh process: the signature is still genuine and unexpired, so ONLY the
    // persisted denylist stands between this token and a quiet resurrection.
    const reborn = await createTestApp({ config, tokenSecret });
    try {
      const res = await apiClient(reborn.app, `${SESSION_COOKIE}=${token}`).get("/api/me");
      expect(res.status).toBe(401);
    } finally {
      await reborn.cleanup();
    }
  });

  it("revocations age out of memory as well as the table", async () => {
    let nowMs = Date.now();
    const t = await createTestApp({ now: () => new Date(nowMs) });
    try {
      const { cookie } = await loginAdmin(t.app);
      await apiClient(t.app, cookie).post("/api/auth/logout");
      const rows = () =>
        Number(
          (t.deps.db.prepare("SELECT COUNT(*) AS n FROM auth_revocations").get() as { n: unknown })
            .n,
        );
      const mirror = () =>
        (t.deps.authService as unknown as { revokedJtis: Map<string, number> }).revokedJtis.size;
      expect(rows()).toBe(1);
      expect(mirror()).toBe(1);
      // Past every copy's possible expiry, the next login sweeps table and mirror together —
      // a mirror that only grew would leak one entry per logout for the life of the process.
      nowMs += TEST_SESSION_TTL_MS + DAY_MS;
      await loginAdmin(t.app);
      expect(rows()).toBe(0);
      expect(mirror()).toBe(0);
    } finally {
      await t.cleanup();
    }
  });

  it("an admin password reset kills the user's outstanding tokens", async () => {
    const t = await createTestApp();
    try {
      const { cookie: adminCookie } = await loginAdmin(t.app);
      const admin = apiClient(t.app, adminCookie);
      await admin.post("/api/admin/users", { userId: "alice", password: "alice-pass-1" });
      const login = await t.app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "alice", password: "alice-pass-1" }),
      });
      const aliceCookie = cookieFrom(login);
      expect((await apiClient(t.app, aliceCookie).get("/api/me")).status).toBe(200);

      // There is no row to delete for a signed session; the not-before mark is what makes
      // "clear their sessions" true. Without it this reset would be cosmetic.
      await t.deps.adminService.resetPassword("alice", "fresh-pass-1");
      expect((await apiClient(t.app, aliceCookie).get("/api/me")).status).toBe(401);
    } finally {
      await t.cleanup();
    }
  });

  it("a restart voids every signed session, because the key dies with the process", async () => {
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
    // No tokenSecret pinned: each construction generates its own, as each real process does.
    // This is the rotation story — restart the server and every outstanding token is noise.
    const reborn = await createTestApp({ config });
    try {
      expect((await apiClient(reborn.app, cookie).get("/api/me")).status).toBe(401);
    } finally {
      await reborn.cleanup();
    }
  });

  it("answers a wrong owner token and an unknown account identically", async () => {
    // Distinguishing them would let a caller WITHOUT the token enumerate accounts. The
    // success path runs against a real socket in auth-token.test.ts.
    const t = await createTestApp();
    try {
      const ownerToken = readOwnerToken(t.root);
      expect(ownerToken).not.toBeNull();
      const post = (body: unknown) =>
        t.app.request("/api/auth/owner", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const wrong = await post({ ownerToken: "not-the-token" });
      const noUser = await post({ ownerToken, userId: "nobody" });
      expect(wrong.status).toBe(401);
      expect(noUser.status).toBe(401);
      expect(await wrong.text()).toBe(await noUser.text());
    } finally {
      await t.cleanup();
    }
  });

  it("slides a long session by replacement cookie, and never stretches a short one", async () => {
    const secret = Buffer.alloc(32, 7);
    const t = await createTestApp({ tokenSecret: secret });
    try {
      // A browser session: its own span reaches the renewal window (so it is the renewable
      // kind), and enough has been used up that renewal is due. Both are expressed against
      // the app's configured TTL rather than pinned numbers, so a change to the term moves
      // the fixture with it instead of failing it.
      const now = Date.now();
      const ttl = TEST_SESSION_TTL_MS;
      const sliding = signToken(
        {
          u: "admin",
          v: "password",
          iat: now - 2 * DAY_MS,
          exp: now + ttl - 2 * DAY_MS,
          jti: "slide1",
        },
        secret,
      );
      const renewed = await apiClient(t.app, `${SESSION_COOKIE}=${sliding}`).get("/api/me");
      expect(renewed.status).toBe(200);
      const setCookie = renewed.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(`${SESSION_COOKIE}=v1.`);
      // The replacement is the SAME session with a longer life — jti and iat carry over,
      // only the expiry moves. A fresh jti would be a second identity: logout of one copy
      // would leave the other alive, still renewing, and the per-user not-before mark
      // would date the copy from its renewal rather than its issue.
      const fresh = setCookie.split(";")[0]!.split("=").slice(1).join("=");
      const freshClaims = verifyToken(fresh, secret);
      expect(freshClaims?.u).toBe("admin");
      expect(freshClaims?.jti).toBe("slide1");
      expect(freshClaims?.iat).toBe(now - 2 * DAY_MS);
      expect(freshClaims!.exp).toBeGreaterThan(now + ttl - 2 * DAY_MS);

      // And BECAUSE the identity carries over, logging out with either copy ends both.
      const out = await apiClient(t.app, `${SESSION_COOKIE}=${fresh}`).post("/api/auth/logout");
      expect(out.status).toBe(204);
      expect((await apiClient(t.app, `${SESSION_COOKIE}=${sliding}`).get("/api/me")).status).toBe(
        401,
      );
      expect((await apiClient(t.app, `${SESSION_COOKIE}=${fresh}`).get("/api/me")).status).toBe(
        401,
      );

      // A one-hour minted token in its final minutes must expire at its hour: renewing it
      // would stretch "short-lived" into the full session term by mere use.
      const short = signToken(
        { u: "admin", v: "cli", iat: now - 3_540_000, exp: now + 60_000, jti: "short1" },
        secret,
      );
      const kept = await apiClient(t.app, `${SESSION_COOKIE}=${short}`).get("/api/me");
      expect(kept.status).toBe(200);
      expect(kept.headers.get("set-cookie")).toBeNull();
    } finally {
      await t.cleanup();
    }
  });
});
