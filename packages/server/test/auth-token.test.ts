/**
 * Minting an API session from the data root (auth-token.ts).
 *
 * A session is a row in web.db, so minting opens the database and inserts one — no running
 * server, no owner token, no loopback. Reading the root already reaches every credential the
 * token could, so the write adds no authority; the row is a `cli` session the server honors
 * on its next request.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLI_TOKEN_MAX_TTL_MS, mintApiToken } from "../src/auth-token.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { apiClient, createTestApp, makeTempRoot } from "./helpers.js";

describe("minting an API session", () => {
  it("reports no_server when the root has no web.db", async () => {
    const root = await makeTempRoot();
    expect(mintApiToken(root, { dbPath: path.join(root, "web.db") })).toEqual({
      outcome: "no_server",
    });
  });

  it("inserts a session row the server then authenticates", async () => {
    const root = await makeTempRoot();
    const dbPath = path.join(root, "web.db");
    // Seed the account by booting an app on this file, then mint against the same file as the
    // CLI would — the app and the mint share one on-disk database, no cross-process hop.
    const t = await createTestApp({ config: { root, dbPath } });
    try {
      const minted = mintApiToken(root, { dbPath, ttlMs: 60_000 });
      expect(minted.outcome).toBe("minted");
      if (minted.outcome !== "minted") return;
      expect(minted.userId).toBe("admin");
      expect(
        (await apiClient(t.app, `${SESSION_COOKIE}=${minted.token}`).get("/api/me")).status,
      ).toBe(200);
    } finally {
      await t.cleanup();
    }
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

  /**
   * A caller-supplied lifetime must not exceed an ordinary session's. `--ttl-seconds` only
   * rejects values <= 0, so without the clamp `penguin auth token --ttl-seconds 315360000`
   * writes a ten-year row — and because its span passes the renewal window it would slide
   * forever, turning a leaked cli-session.json into a permanent credential.
   */
  it("clamps a caller's TTL to the session ceiling", async () => {
    const root = await makeTempRoot();
    const dbPath = path.join(root, "web.db");
    const t = await createTestApp({ config: { root, dbPath } });
    try {
      const now = new Date();
      const r = mintApiToken(root, { dbPath, ttlMs: 10 * 365 * 24 * 60 * 60_000, now });
      expect(r.outcome).toBe("minted");
      if (r.outcome !== "minted") return;
      expect(Date.parse(r.expiresAt)).toBe(now.getTime() + CLI_TOKEN_MAX_TTL_MS);
    } finally {
      await t.cleanup();
    }
  });

  it("refuses an account that does not exist", async () => {
    const root = await makeTempRoot();
    const dbPath = path.join(root, "web.db");
    const t = await createTestApp({ config: { root, dbPath } });
    try {
      const r = mintApiToken(root, { dbPath, userId: "ghost" });
      expect(r.outcome).toBe("failed");
    } finally {
      await t.cleanup();
    }
  });
});
