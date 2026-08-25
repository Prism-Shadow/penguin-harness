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
import { mintApiToken } from "../src/auth-token.js";
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
