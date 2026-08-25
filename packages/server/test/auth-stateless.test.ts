/**
 * Sessions as signed statements (auth/token-codec.ts) — what the row model guaranteed, the
 * signature must still guarantee.
 *
 * The switch moves the per-request hot path off the database, and every property it could
 * silently lose is pinned here: logout must still be a real revocation that SURVIVES a
 * restart (the denylist row is the only session state left, so losing it means a "signed
 * out" token that quietly works again); an admin password reset must still kill the user's
 * outstanding sessions (there are no rows to delete — the not-before mark is the mechanism);
 * sessions issued before the switch must keep working from their rows, or the upgrade logs
 * every deployment out; and sliding renewal must still slide, now as a replacement cookie.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthSessionsRepo } from "../src/db/repos/auth-sessions.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { newClaims, signToken, verifyToken } from "../src/auth/token-codec.js";
import { readOwnerToken } from "../src/auth/owner-token.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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

  it("gives every token its own id, or revoking one would revoke its twin", () => {
    const a = newClaims("admin", "cli", 1_000_000, 3_600_000);
    const b = newClaims("admin", "cli", 1_000_000, 3_600_000);
    expect(a.jti).not.toBe(b.jti);
  });
});

describe("stateless sessions through the app", () => {
  it("logs in with a signed token and writes no session row", async () => {
    const t = await createTestApp();
    try {
      const { cookie } = await loginAdmin(t.app);
      // The whole point: issuance leaves nothing behind — the only session state the
      // database may ever hold again is a revocation.
      const rows = t.deps.db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get() as {
        n: number;
      };
      expect(rows.n).toBe(0);
      expect((await apiClient(t.app, cookie).get("/api/me")).status).toBe(200);
    } finally {
      await t.cleanup();
    }
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
      const aliceCookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
      expect((await apiClient(t.app, aliceCookie).get("/api/me")).status).toBe(200);

      // There is no row to delete for a signed session; the not-before mark is what makes
      // "clear their sessions" true. Without it this reset would be cosmetic.
      await t.deps.adminService.resetPassword("alice", "fresh-pass-1");
      expect((await apiClient(t.app, aliceCookie).get("/api/me")).status).toBe(401);
    } finally {
      await t.cleanup();
    }
  });

  it("still honors a session issued before the switch, from its row", async () => {
    const t = await createTestApp();
    try {
      // A legacy deployment's cookie: random bytes whose HASH is a row — exactly what login
      // used to write. The upgrade must not log this session out.
      const legacy = "legacy-token-from-before-the-switch";
      new AuthSessionsRepo(t.deps.db).insert({
        tokenHash: createHash("sha256").update(legacy).digest("hex"),
        userId: "admin",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
        via: "password",
      });
      const res = await apiClient(t.app, `${SESSION_COOKIE}=${legacy}`).get("/api/me");
      expect(res.status).toBe(200);
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

  it("redeems the owner token for a session, and refuses everything else", async () => {
    const t = await createTestApp();
    try {
      // The client half: the file the server wrote at boot IS the credential — reading it
      // is the proof of ownership the endpoint exchanges for a session.
      const ownerToken = readOwnerToken(t.root);
      expect(ownerToken).not.toBeNull();
      const redeemed = await t.app.request("/api/auth/owner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerToken, ttlSeconds: 60 }),
      });
      expect(redeemed.status).toBe(200);
      const { token, expiresAt } = (await redeemed.json()) as { token: string; expiresAt: string };
      expect((await apiClient(t.app, `${SESSION_COOKIE}=${token}`).get("/api/me")).status).toBe(
        200,
      );
      expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

      // A wrong value and an unknown account answer IDENTICALLY: distinguishing them would
      // let a caller without the token enumerate accounts.
      const wrong = await t.app.request("/api/auth/owner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerToken: "not-the-token" }),
      });
      const noUser = await t.app.request("/api/auth/owner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerToken, userId: "nobody" }),
      });
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
      // Inside the renewal window (test config: 7d TTL, renew under 6d): span just over the
      // window, remaining just under it.
      const now = Date.now();
      const sliding = signToken(
        { u: "admin", v: "password", iat: now - DAY_MS, exp: now + 5.5 * DAY_MS, jti: "slide1" },
        secret,
      );
      const renewed = await apiClient(t.app, `${SESSION_COOKIE}=${sliding}`).get("/api/me");
      expect(renewed.status).toBe(200);
      const setCookie = renewed.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(`${SESSION_COOKIE}=v1.`);
      // The replacement is a genuine signed token for the same account.
      const fresh = setCookie.split(";")[0]!.split("=").slice(1).join("=");
      expect(verifyToken(fresh, secret)?.u).toBe("admin");

      // A one-hour minted token in its final minutes must expire at its hour: renewing it
      // would stretch "short-lived" into a week by mere use.
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
