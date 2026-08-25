/**
 * Claiming a server that has no admin password yet (auth/service.ts, routes/auth.ts).
 *
 * A fresh server's seed password is generated, hashed and discarded, so there is nothing to
 * type and nothing on disk to type it from. What the operator gets is a one-time link
 * carrying this boot's first-login token. Three properties make that safe enough to print
 * into a console, and each is pinned here:
 *
 * - It works only while the server is UNCLAIMED. The moment a password exists, the link is
 *   refused — otherwise a console scrollback would be a permanent way in.
 * - The session it grants may set a password without an old one (there is no old one), but
 *   opens no desktop-only route: it proves someone read a link, not that they own the machine.
 * - A wrong token and an already-claimed server are indistinguishable, so a stale link cannot
 *   be used to learn which of the two it is.
 *
 * Plus the sweep: a data root carried over from a build that stored the plaintext must stop
 * holding it.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearInitialAdminPassword,
  initialAdminPasswordPath,
  renderFirstLoginNotice,
} from "../src/initial-password.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** The token this app was built with — the value its printed link would carry. */
const FIRST_LOGIN = "test-first-login-token";

describe("the first-login link", () => {
  let t: TestApp;

  beforeEach(async () => {
    // seedAdminPassword is left at the test default, so the account exists and is flagged
    // initial — exactly the unclaimed state a fresh install is in.
    t = await createTestApp({ firstLoginToken: FIRST_LOGIN });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const redeem = (token: string) =>
    t.app.request(`/api/auth/first-login?token=${encodeURIComponent(token)}`, {
      redirect: "manual",
    });

  it("claims an unclaimed server and lands on the app", async () => {
    const res = await redeem(FIRST_LOGIN);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);

    const me = await apiClient(t.app, cookie).get("/api/me");
    expect(me.status).toBe(200);
    const body = (await me.json()) as { user: { userId: string }; sessionVia: string };
    expect(body.user.userId).toBe("admin");
    expect(body.sessionVia).toBe("setup");
  });

  it("sets a password with no old password, and then refuses to work again", async () => {
    const claimed = await redeem(FIRST_LOGIN);
    const cookie = (claimed.headers.get("set-cookie") ?? "").split(";")[0]!;

    // No oldPassword: the account's current one is random and was never shown.
    const set = await apiClient(t.app, cookie).put("/api/me/password", {
      newPassword: "claimed-password-1",
    });
    expect(set.status).toBe(204);
    expect(t.deps.authService.adminPasswordIsInitial()).toBe(false);

    // The server is claimed, so the link is dead — a console scrollback is not a way in.
    expect((await redeem(FIRST_LOGIN)).status).toBe(401);
  });

  it("opens no desktop-only route", async () => {
    // The allowance it carries is "set a password", not "own this machine". Desktop routes
    // answer 404 outside desktop mode, which is what this app is — the point is that the
    // setup session is not treated as a desktop one anywhere.
    const claimed = await redeem(FIRST_LOGIN);
    const cookie = (claimed.headers.get("set-cookie") ?? "").split(";")[0]!;
    const me = (await (await apiClient(t.app, cookie).get("/api/me")).json()) as {
      sessionVia: string;
    };
    expect(me.sessionVia).not.toBe("desktop");
  });

  it("answers a wrong token and a claimed server identically", async () => {
    const wrong = await redeem("not-the-token");
    expect(wrong.status).toBe(401);
    const wrongBody = await wrong.text();

    const claimed = await redeem(FIRST_LOGIN);
    const cookie = (claimed.headers.get("set-cookie") ?? "").split(";")[0]!;
    await apiClient(t.app, cookie).put("/api/me/password", { newPassword: "claimed-password-1" });

    const stale = await redeem(FIRST_LOGIN);
    expect(stale.status).toBe(401);
    expect(await stale.text()).toBe(wrongBody);
  });

  it("does not let an ordinary password session set a password without the old one", async () => {
    // The allowance belongs to the session's provenance, not to the route.
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).put("/api/me/password", {
      newPassword: "sneaky-password-1",
    });
    expect(res.status).toBe(400);
  });
});

describe("the legacy plaintext sweep", () => {
  it("removes a plaintext an older build left in the data root", async () => {
    const root = await makeTempRoot();
    fs.writeFileSync(initialAdminPasswordPath(root), "penguin-1234\n", { mode: 0o600 });
    clearInitialAdminPassword(root);
    expect(fs.existsSync(path.join(root, "initial-admin-password"))).toBe(false);
    // Idempotent: a root that never had one is not an error.
    clearInitialAdminPassword(root);
  });
});

describe("renderFirstLoginNotice", () => {
  it("frames the link in an aligned ASCII box", () => {
    const lines = renderFirstLoginNotice(
      "http://localhost:7364/api/auth/first-login?token=x",
    ).split("\n");
    const width = lines[0]!.length;
    // Every line is the same width and the frame is plain ASCII, so a non-UTF-8 console
    // cannot mangle the one line the notice exists to highlight.
    expect(lines.every((line) => line.length === width)).toBe(true);
    expect(lines[0]).toMatch(/^\+-+\+$/);
    expect(lines.at(-1)).toBe(lines[0]);
    expect(lines.some((line) => line.includes("first-login?token=x"))).toBe(true);
  });

  it("widens with a long origin instead of breaking the frame", () => {
    const long = `http://${"a".repeat(90)}:7364/api/auth/first-login?token=abc`;
    const lines = renderFirstLoginNotice(long).split("\n");
    const width = lines[0]!.length;
    expect(width).toBeGreaterThan(long.length);
    expect(lines.every((line) => line.length === width)).toBe(true);
  });
});
