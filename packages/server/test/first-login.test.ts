/**
 * The first-login proof of the claim route (auth/service.ts, routes/auth.ts) — the other one,
 * the desktop shell's token, is covered in desktop.test.ts.
 *
 * What is peculiar to this proof is that the link CARRIES a session rather than a secret
 * redeemed for one. That buys simplicity and costs a hazard the desktop token does not have:
 * an endpoint that made a cookie out of any valid token would let one person sign another
 * into their own account. So the printed value is compared, not merely verified — and it stops
 * working the moment a password exists, since a console scrollback must not stay a way in.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearInitialAdminPassword, initialAdminPasswordPath } from "../src/initial-password.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { apiClient, cookieFrom, createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("the first-login link", () => {
  let t: TestApp;
  /** The session the server would print — read from it, not injected, as a browser would get it. */
  let link: string;

  beforeEach(async () => {
    t = await createTestApp();
    link = t.deps.authService.mintFirstLogin()!;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const redeem = (token: string) =>
    t.app.request(`/api/auth/claim?token=${encodeURIComponent(token)}`, {
      redirect: "manual",
    });

  it("claims an unclaimed server, with a session that may set a password but is not desktop", async () => {
    const res = await redeem(link);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const cookie = cookieFrom(res);

    const me = (await (await apiClient(t.app, cookie).get("/api/me")).json()) as {
      user: { userId: string };
      sessionVia: string;
    };
    expect(me.user.userId).toBe("admin");
    // "setup", never "desktop": reading a link proves someone read a link, not that they own
    // the machine the shell runs on.
    expect(me.sessionVia).toBe("setup");

    // The one allowance it carries — and the account's password is a random value nobody has
    // seen, so there is nothing to put in an old-password field.
    const set = await apiClient(t.app, cookie).put("/api/me/password", {
      newPassword: "claimed-password-1",
    });
    expect(set.status).toBe(204);
    expect(t.deps.authService.adminPasswordIsInitial()).toBe(false);

    // Claimed: a console scrollback is not a way in.
    expect((await redeem(link)).status).toBe(401);
  });

  it("refuses a valid session that is not the one it printed", async () => {
    // Otherwise this endpoint would make a cookie out of ANY valid token, and a link could
    // sign its recipient into the SENDER's account — work done there, including pasted
    // credentials, would land in it.
    const someoneElse = (await loginAdmin(t.app)).cookie.split("=").slice(1).join("=");
    expect((await redeem(someoneElse)).status).toBe(401);
  });

  it("answers a wrong token and a claimed server identically", async () => {
    const wrong = await redeem("not-the-token");
    expect(wrong.status).toBe(401);
    const wrongBody = await wrong.text();

    const claimed = await redeem(link);
    const cookie = cookieFrom(claimed);
    await apiClient(t.app, cookie).put("/api/me/password", { newPassword: "claimed-password-1" });

    const stale = await redeem(link);
    expect(stale.status).toBe(401);
    expect(await stale.text()).toBe(wrongBody);
  });

  /**
   * Not single-use, deliberately: a mail client or a browser that prefetches the link would
   * spend a one-shot token before its reader ever clicked, and the window it stays open is
   * exactly the window in which the account protects nothing yet. Opening it twice yields the
   * same session rather than two, since the link IS the session.
   */
  it("can be opened more than once, and both pages land in one session", async () => {
    const a = await redeem(link);
    const b = await redeem(link);
    expect([a.status, b.status]).toEqual([302, 302]);
    const cookieOf = (r: Response) => cookieFrom(r);
    expect(cookieOf(a)).toBe(cookieOf(b));
    expect(cookieOf(a)).not.toBe("");
    // Still the same link afterwards: redemption spends nothing.
    expect(t.deps.authService.mintFirstLogin()).toBe(link);
  });

  /**
   * The one reachable way to set a password WITHOUT going through setInitialPassword's
   * revocation: a pinned seed (PENGUIN_SEED_ADMIN_PASSWORD) makes the current password
   * knowable, so the ordinary change-password door opens. The link must die there too —
   * the invariant is "any password set on the admin ends the link", not "the door we
   * expected ends it".
   */
  it("dies when the admin sets a password through the ordinary door (pinned seed)", async () => {
    const pinned = await createTestApp();
    try {
      const pinnedLink = pinned.deps.authService.mintFirstLogin()!;
      const { cookie } = await loginAdmin(pinned.app);
      await apiClient(pinned.app, cookie).put("/api/me/password", {
        oldPassword: pinned.adminPassword,
        newPassword: "chosen-password-1",
      });
      expect(pinned.deps.authService.redeemFirstLogin(pinnedLink)).toBeNull();
    } finally {
      await pinned.cleanup();
    }
  });

  /**
   * Setting the password must kill the setup session by its jti, not by the printed token —
   * once the original has aged past its own expiry, a renewed copy of the same jti is still
   * live, and revoking only the (now-expired) original would spare it. Reviewer reproduced
   * the copy staying admin at sessionVia:"setup" after the password was set.
   */
  it("kills a renewed setup cookie even after the printed original has expired", async () => {
    let nowMs = Date.now();
    const clocked = await createTestApp({
      config: { seedAdminPassword: null },
      now: () => new Date(nowMs),
    });
    try {
      const original = clocked.deps.authService.mintFirstLogin()!;
      // Day 2: renew into a replacement copy (same jti, exp ~day 32).
      nowMs += 2 * 24 * 60 * 60 * 1000;
      const r = await apiClient(clocked.app, `${SESSION_COOKIE}=${original}`).get("/api/me");
      const renewed = cookieFrom(r);
      // Day 31: the printed original (exp day 30) is dead; the renewed copy is not.
      nowMs += 29 * 24 * 60 * 60 * 1000;
      expect(
        (await apiClient(clocked.app, `${SESSION_COOKIE}=${original}`).get("/api/me")).status,
      ).toBe(401);
      const set = await apiClient(clocked.app, renewed).put("/api/me/password", {
        newPassword: "claimed-password-1",
      });
      expect(set.status).toBe(204);
      // The copy that set the password is now revoked too — no surviving setup session.
      expect((await apiClient(clocked.app, renewed).get("/api/me")).status).toBe(401);
    } finally {
      await clocked.cleanup();
    }
  });

  /**
   * The renewal window is a day short of the TTL, so a setup session starts renewing the day
   * after it is claimed — the replacement cookie is the COMMON case, not an edge. It carries
   * the same jti, so the revocation that fires when a password is set kills it too; a fresh
   * jti here once meant a renewed claimer kept a password-setting session after the password
   * existed.
   */
  it("a renewed setup cookie dies with the original when the password is set", async () => {
    let nowMs = Date.now();
    const clocked = await createTestApp({
      config: { seedAdminPassword: null },
      now: () => new Date(nowMs),
    });
    try {
      const first = clocked.deps.authService.mintFirstLogin()!;
      // Two days in: authentication hands back a replacement setup cookie.
      nowMs += 2 * 24 * 60 * 60 * 1000;
      const renewed = await apiClient(clocked.app, `${SESSION_COOKIE}=${first}`).get("/api/me");
      expect(renewed.status).toBe(200);
      const replacement = cookieFrom(renewed);
      expect(replacement).toContain(`${SESSION_COOKIE}=v1.`);
      // The replacement can still set the password without an old one…
      const set = await apiClient(clocked.app, replacement).put("/api/me/password", {
        newPassword: "claimed-password-1",
      });
      expect(set.status).toBe(204);
      // …and that act ends every copy: the original AND the replacement itself.
      expect(
        (await apiClient(clocked.app, `${SESSION_COOKIE}=${first}`).get("/api/me")).status,
      ).toBe(401);
      expect((await apiClient(clocked.app, replacement).get("/api/me")).status).toBe(401);
    } finally {
      await clocked.cleanup();
    }
  });

  /**
   * The revocation fires only after the password actually updates: a rejected attempt must
   * leave the link alive, or a typo (or anyone poking the endpoint with a bad value) burns
   * the only way in until a restart.
   */
  it("keeps the link alive when the chosen password is rejected", async () => {
    const res = await redeem(link);
    const cookie = cookieFrom(res);
    const short = await apiClient(t.app, cookie).put("/api/me/password", {
      newPassword: "short",
    });
    expect(short.status).toBe(400);
    // The same printed link still redeems — nothing was spent on the failure.
    expect((await redeem(link)).status).toBe(302);
    expect(t.deps.authService.mintFirstLogin()).toBe(link);
  });

  /**
   * An unclaimed server outliving the session TTL (30 days without anyone setting a
   * password) must not keep handing out the same dead link: the cached token no longer
   * authenticates, so minting re-rolls it.
   */
  it("re-mints the link once the cached one has aged out", async () => {
    let nowMs = Date.now();
    const clocked = await createTestApp({
      config: { seedAdminPassword: null },
      now: () => new Date(nowMs),
    });
    try {
      const first = clocked.deps.authService.mintFirstLogin()!;
      nowMs += 31 * 24 * 60 * 60 * 1000;
      const second = clocked.deps.authService.mintFirstLogin();
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
      expect(clocked.deps.authService.redeemFirstLogin(second!)).toBe(second);
    } finally {
      await clocked.cleanup();
    }
  });

  /**
   * A claimed server that restarts must not end up holding a usable setup session. Revocation
   * cannot be what prevents that — a restart's token is new, and nothing revoked a token that
   * did not exist yet — so the server declines to mint one at all.
   */
  it("mints nothing once the server has been claimed, so a restart has no link", async () => {
    const root = await makeTempRoot();
    const dbPath = path.join(root, "web.db");

    const first = await createTestApp({ config: { dbPath, seedAdminPassword: null } });
    const claim = await first.app.request(
      `/api/auth/claim?token=${encodeURIComponent(first.deps.authService.mintFirstLogin()!)}`,
      { redirect: "manual" },
    );
    const cookie = cookieFrom(claim);
    await apiClient(first.app, cookie).put("/api/me/password", {
      newPassword: "claimed-password-1",
    });
    await first.cleanup();

    // Same database, new process: a new signing key, and a new setup session with it.
    const second = await createTestApp({ config: { dbPath, seedAdminPassword: null } });
    try {
      expect(second.deps.authService.adminPasswordIsInitial()).toBe(false);
      expect(second.deps.authService.mintFirstLogin()).toBeNull();
      // Nothing to match, so the endpoint refuses whatever is presented.
      const res = await second.app.request("/api/auth/claim?token=anything", {
        redirect: "manual",
      });
      expect(res.status).toBe(401);
    } finally {
      await second.cleanup();
    }
  });

  /**
   * A minted token that is never delivered is a feature nobody can reach, and every test
   * above mints its own — so none of them would notice. The entrypoint runs main() on import
   * and exports nothing, which leaves reading it the way to check that what it mints actually
   * reaches a console.
   */
  it("is printed by the entrypoint, not merely minted", () => {
    const entrypoint = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(entrypoint).toMatch(/renderFirstLoginNotice\(/);
    expect(entrypoint).toMatch(/mintFirstLogin\(/);
    expect(entrypoint).toMatch(/\/api\/auth\/claim\?token=/);
  });

  it("sweeps a plaintext an older build left in the data root", async () => {
    const root = await makeTempRoot();
    fs.writeFileSync(initialAdminPasswordPath(root), "penguin-1234\n", { mode: 0o600 });
    clearInitialAdminPassword(root);
    expect(fs.existsSync(initialAdminPasswordPath(root))).toBe(false);
  });
});
