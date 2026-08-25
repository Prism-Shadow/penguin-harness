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
import { apiClient, createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
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
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;

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
    const cookie = (claimed.headers.get("set-cookie") ?? "").split(";")[0]!;
    await apiClient(t.app, cookie).put("/api/me/password", { newPassword: "claimed-password-1" });

    const stale = await redeem(link);
    expect(stale.status).toBe(401);
    expect(await stale.text()).toBe(wrongBody);
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
    const cookie = (claim.headers.get("set-cookie") ?? "").split(";")[0]!;
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
