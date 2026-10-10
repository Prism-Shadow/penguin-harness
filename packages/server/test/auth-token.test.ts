/**
 * Minting an API session from the data root (auth-token.ts): what `penguin auth token` and the
 * desktop shell run to sign in without a password.
 *
 * A session is a row in web.db, so minting opens the database and inserts one — no running
 * server, no owner token, no loopback. Reading the root already reaches every credential the
 * token could, so the write adds no authority.
 *
 * - Given a root with no web.db, the mint reports no_server.
 * - Given a server's database, the minted row is a session the server then authenticates.
 * - A caller's TTL is clamped to the ordinary session ceiling, so a leaked token cannot live
 *   (and slide) forever.
 * - The session records how it was established: a cli mint reads back as an ordinary password
 *   session, a desktop mint as the shell's own.
 * - An account that does not exist is refused.
 * - A database this OS account cannot open fails cleanly, pointing at `penguin auth login`.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLI_TOKEN_MAX_TTL_MS, mintApiToken } from "../src/auth-token.js";
import type { MintTokenResult } from "../src/auth-token.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { apiClient, createTestApp, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("minting an API session", () => {
  it("reports no_server when the root has no web.db", async () => {
    const root = await makeTempRoot();
    expect(mintApiToken(root, { dbPath: path.join(root, "web.db") })).toEqual({
      outcome: "no_server",
    });
  });

  /**
   * The multi-user case: web.db exists but belongs to another OS account (the one running the
   * server), and this caller cannot open it. That must come back as a failed outcome pointing
   * at `auth login` — not an unhandled throw. chmod-based, so meaningless as root or on
   * Windows.
   */
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "fails cleanly on a database this OS account cannot open",
    async () => {
      const root = await makeTempRoot();
      const dbPath = path.join(root, "web.db");
      const t = await createTestApp({ config: { root, dbPath } });
      await t.cleanup();
      const fs = await import("node:fs");
      fs.chmodSync(dbPath, 0o000);
      try {
        const r = mintApiToken(root, { dbPath });
        expect(r.outcome).toBe("failed");
        if (r.outcome !== "failed") return;
        expect(r.detail).toContain("penguin auth login");
      } finally {
        fs.chmodSync(dbPath, 0o600);
      }
    },
  );
});

describe("minting against a server's database", () => {
  let t: TestApp;
  let root: string;
  let dbPath: string;

  // The app seeds the account on this file, then each case mints against the same file as the
  // CLI would: the app and the mint share one on-disk database, no cross-process hop.
  beforeAll(async () => {
    root = await makeTempRoot();
    dbPath = path.join(root, "web.db");
    t = await createTestApp({ config: { root, dbPath } });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const minted = (r: MintTokenResult) => {
    expect(r.outcome).toBe("minted");
    if (r.outcome !== "minted") throw new Error(`not minted: ${JSON.stringify(r)}`);
    return r;
  };
  const me = async (token: string) => apiClient(t.app, `${SESSION_COOKIE}=${token}`).get("/api/me");

  it("inserts a session row the server then authenticates", async () => {
    const r = minted(mintApiToken(root, { dbPath, ttlMs: 60_000 }));
    expect(r.userId).toBe("admin");
    expect((await me(r.token)).status).toBe(200);
  });

  /**
   * `--ttl-seconds` only rejects values <= 0, so without the clamp `penguin auth token
   * --ttl-seconds 315360000` writes a ten-year row — and because its span passes the renewal
   * window it would slide forever, turning a leaked cli-session.json into a permanent
   * credential.
   */
  it("clamps a caller's TTL to the session ceiling", () => {
    const now = new Date();
    const r = minted(mintApiToken(root, { dbPath, ttlMs: 10 * 365 * 24 * 60 * 60_000, now }));
    expect(Date.parse(r.expiresAt)).toBe(now.getTime() + CLI_TOKEN_MAX_TTL_MS);
  });

  /**
   * The desktop shell mints with `via: "desktop"` when it signs its own window in against a
   * server it did not spawn, and the session has to read back as that kind — it is what the
   * App reads to leave the current-password field out of a form whose account has a password
   * nobody was ever shown. A `cli` mint keeps reading back as an ordinary password session.
   */
  it("records how the session was established, defaulting to cli", async () => {
    const viaOf = async (token: string) =>
      ((await (await me(token)).json()) as { sessionVia: string }).sessionVia;
    expect(await viaOf(minted(mintApiToken(root, { dbPath })).token)).toBe("password");
    expect(await viaOf(minted(mintApiToken(root, { dbPath, via: "desktop" })).token)).toBe(
      "desktop",
    );
  });

  it("refuses an account that does not exist", () => {
    expect(mintApiToken(root, { dbPath, userId: "ghost" }).outcome).toBe("failed");
  });
});
