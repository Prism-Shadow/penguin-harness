/**
 * The shell signing its own window in: what it plans for each outcome the minter can return,
 * how long the session it asks for lives, what it tells the user when it cannot sign in, and
 * which pages count as the sign-in page.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { MintedVia, MintTokenResult } from "@prismshadow/penguin-server/auth-token";
import {
  ATTACH_SESSION_TTL_MS,
  createSignInGuard,
  isLoginPageUrl,
  planSignIn,
  SESSION_COOKIE,
  signInFailureDialog,
} from "../src/attach-session.js";
import type { SessionMinter } from "../src/attach-session.js";

const ORIGIN = "http://localhost:53187";
const ROOT = "/home/someone/.penguin/data";

const EXPIRES_AT = "2026-10-20T08:00:00.000Z";
const MINTED: MintTokenResult = {
  outcome: "minted",
  token: "s3cr3t-token",
  userId: "admin",
  expiresAt: EXPIRES_AT,
};

/** A minter with one canned answer, which records what it was asked for. */
function minter(result: MintTokenResult): {
  mint: SessionMinter;
  calls: Array<{ root: string; ttlMs: number; via: MintedVia }>;
} {
  const calls: Array<{ root: string; ttlMs: number; via: MintedVia }> = [];
  return {
    calls,
    mint: (root, opts) => {
      calls.push({ root, ttlMs: opts.ttlMs, via: opts.via });
      return result;
    },
  };
}

describe("planSignIn", () => {
  it("turns a minted session into the cookie the window needs", () => {
    const { mint, calls } = minter(MINTED);
    const plan = planSignIn({ root: ROOT, origin: ORIGIN, mint });
    // `desktop`, not `cli`: the window this signs in IS the desktop shell's, and the App reads
    // that back to leave the current-password field out of its change-password form.
    expect(calls).toEqual([{ root: ROOT, ttlMs: ATTACH_SESSION_TTL_MS, via: "desktop" }]);
    expect(plan).toEqual({
      outcome: "cookie",
      cookie: {
        url: `${ORIGIN}/`,
        name: SESSION_COOKIE,
        value: "s3cr3t-token",
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        expirationDate: Date.parse(EXPIRES_AT) / 1000,
      },
    });
  });

  it("leaves the cookie without an expiry when the row's cannot be read as a date", () => {
    const { mint } = minter({
      outcome: "minted",
      token: "s3cr3t-token",
      userId: "admin",
      expiresAt: "whenever",
    });
    const plan = planSignIn({ root: ROOT, origin: ORIGIN, mint });
    expect(plan.outcome).toBe("cookie");
    if (plan.outcome !== "cookie") return;
    expect(plan.cookie.expirationDate).toBeUndefined();
  });

  it("reports a root with no web.db as a root that holds no account", () => {
    const { mint } = minter({ outcome: "no_server" });
    const plan = planSignIn({ root: ROOT, origin: ORIGIN, mint });
    expect(plan.outcome).toBe("failed");
    if (plan.outcome !== "failed") return;
    expect(plan.failure.reason).toBe("no_server");
    expect(plan.failure.detail).toContain(ROOT);
  });

  it("passes the minter's own explanation through untouched", () => {
    const detail = "cannot open /root/web.db — minting needs the data root's own OS account";
    const { mint } = minter({ outcome: "failed", detail });
    const plan = planSignIn({ root: ROOT, origin: ORIGIN, mint });
    expect(plan).toEqual({ outcome: "failed", failure: { reason: "failed", detail } });
  });
});

describe("the minted session's lifetime", () => {
  /**
   * Thirty days is what the server gives a browser sign-in, and the only span that renews in
   * place: a shorter session never reaches the renewal window, so it would expire on schedule
   * however much the window is used and drop it back on the sign-in page.
   */
  it("is the thirty days an ordinary browser session gets", () => {
    expect(ATTACH_SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

/**
 * The cookie name is a copy of the server's, so it is pinned to the declaration it copies:
 * the two are read by different processes and nothing else would notice them drifting apart.
 */
describe("the session cookie's name", () => {
  it("is the name the server reads sessions from", () => {
    const middleware = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../server/src/auth/middleware.ts",
    );
    const declared = /export const SESSION_COOKIE = "([^"]+)"/.exec(
      fs.readFileSync(middleware, "utf8"),
    )?.[1];
    expect(declared).toBe(SESSION_COOKIE);
  });
});

describe("signInFailureDialog", () => {
  it("names the data root, the server holding it, the reason and the way out", () => {
    const box = signInFailureDialog({
      dataRoot: ROOT,
      other: { pid: 4242, port: 7364 },
      failure: { reason: "failed", detail: "the database belongs to another account" },
    });
    expect(box.message).toContain("could not sign itself in");
    expect(box.detail).toContain(ROOT);
    expect(box.detail).toContain("7364");
    expect(box.detail).toContain("4242");
    expect(box.detail).toContain("the database belongs to another account");
    expect(box.detail).toContain("penguin server reset-admin-password");
    expect(box.buttons).toEqual(["Continue to the sign-in page"]);
  });

  it("claims no other server when the shell started its own", () => {
    const box = signInFailureDialog({
      dataRoot: ROOT,
      other: null,
      failure: { reason: "no_server", detail: "there is no web.db" },
    });
    expect(box.detail).not.toContain("Server using it");
    expect(box.detail).toContain(ROOT);
    expect(box.detail).toContain("penguin server reset-admin-password");
  });
});

describe("isLoginPageUrl", () => {
  it.each<[string, boolean]>([
    [`${ORIGIN}/login`, true],
    [`${ORIGIN}/login/`, true],
    // The server appends this on a failed claim, and the App strips it a moment later.
    [`${ORIGIN}/login?claimFailed=desktop`, true],
    [`${ORIGIN}/login-help`, false],
    [`${ORIGIN}/logins`, false],
    [`${ORIGIN}/chat`, false],
    [`${ORIGIN}/`, false],
    // Another instance on this machine, and the preview host, which is not the App.
    ["http://localhost:9999/login", false],
    ["http://127.0.0.1:53187/login", false],
    ["not a url", false],
  ])("%s is the sign-in page: %s", (url, expected) => {
    expect(isLoginPageUrl(url, ORIGIN)).toBe(expected);
  });

  it("is false before boot has resolved an origin", () => {
    expect(isLoginPageUrl(`${ORIGIN}/login`, null)).toBe(false);
  });
});

describe("createSignInGuard", () => {
  const LOGIN = `${ORIGIN}/login`;

  it("answers the first arrival at the sign-in page, and only that one", () => {
    const guard = createSignInGuard();
    expect(guard.arrived(LOGIN, ORIGIN)).toBe("rescue");
    expect(guard.arrived(LOGIN, ORIGIN)).toBe("leave");
  });

  it("counts an attempt that loaded nothing", () => {
    const guard = createSignInGuard();
    guard.tried(null);
    expect(guard.arrived(LOGIN, ORIGIN)).toBe("leave");
  });

  it("does not read the page the shell loads itself as a window that got in", () => {
    const guard = createSignInGuard();
    expect(guard.arrived(LOGIN, ORIGIN)).toBe("rescue");
    guard.tried(`${ORIGIN}/`);
    expect(guard.arrived(`${ORIGIN}/`, ORIGIN)).toBe("leave");
    // Straight back to the sign-in page: the session just minted is not working, and a
    // second attempt would be the first turn of a loop.
    expect(guard.arrived(LOGIN, ORIGIN)).toBe("leave");
  });

  it("answers again once the window has reached a page of the App", () => {
    const guard = createSignInGuard();
    expect(guard.arrived(LOGIN, ORIGIN)).toBe("rescue");
    guard.tried(`${ORIGIN}/`);
    expect(guard.arrived(`${ORIGIN}/`, ORIGIN)).toBe("leave");
    expect(guard.arrived(`${ORIGIN}/chat`, ORIGIN)).toBe("leave");
    expect(guard.arrived(LOGIN, ORIGIN)).toBe("rescue");
  });

  it("leaves a deliberate sign-out alone until something signs in again", () => {
    const guard = createSignInGuard();
    expect(guard.arrived(`${ORIGIN}/chat`, ORIGIN)).toBe("leave");
    guard.signedOut();
    expect(guard.arrived(LOGIN, ORIGIN)).toBe("leave");
    // However the window comes back to the page, the sign-out still holds.
    expect(guard.arrived(`${ORIGIN}/login?claimFailed=desktop`, ORIGIN)).toBe("leave");
    // Signed in with a password: a later trip to the sign-in page is a failure again, not a
    // decision, so the shell answers it.
    expect(guard.arrived(`${ORIGIN}/chat`, ORIGIN)).toBe("leave");
    expect(guard.arrived(LOGIN, ORIGIN)).toBe("rescue");
  });
});
