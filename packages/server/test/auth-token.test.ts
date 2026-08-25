/**
 * Minting an API session from the data root itself (auth-token.ts).
 *
 * Two paths, split by whether a server is running, and each is exercised the way it is
 * actually reached. RUNNING: read this boot's owner-token file and redeem it over loopback —
 * pinned against a real listening server, because the loopback hop (lock file, Host header,
 * JSON shapes) is precisely what an in-process test cannot see. STOPPED: a legacy session
 * row, the one shape that needs no signing key — the key lives in the process, and there is
 * no process.
 *
 * Also pinned: the token never carries more privilege than a password session (one that read
 * back as "desktop" would reach routes reserved for the shell's own window), and the
 * stopped-server path is honest about accounts — the auth_sessions foreign key means a
 * never-seeded root cannot fake a session for a user that does not exist.
 */
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { mintApiToken } from "../src/auth-token.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { apiClient, createTestApp, makeTempRoot } from "./helpers.js";

const appOn = async (root: string) =>
  createTestApp({ config: { root, dbPath: path.join(root, "web.db") } });

describe("minting with the server stopped (the row path)", () => {
  it("authenticates as the admin, and only as a password session", async () => {
    const root = await makeTempRoot();
    const t = await appOn(root);
    try {
      // No server.lock in this root, so the mint takes the row path — which the running
      // app's verification honors, because it is the legacy shape it already reads.
      const minted = await mintApiToken(root);
      expect(minted.outcome).toBe("minted");
      if (minted.outcome !== "minted") return;

      const me = await apiClient(t.app, `${SESSION_COOKIE}=${minted.token}`).get("/api/me");
      expect(me.status).toBe(200);
      const body = (await me.json()) as { user: { userId: string }; sessionVia: string };
      expect(body.user.userId).toBe("admin");
      // NOT "desktop": that reaches routes reserved for the shell's own window, and a token
      // minted by anyone who can read this directory must never be the stronger kind.
      expect(body.sessionVia).toBe("password");
    } finally {
      await t.cleanup();
    }
  });

  it("expires, and refuses an account the database does not hold", async () => {
    const root = await makeTempRoot();
    const t = await appOn(root);
    try {
      const past = await mintApiToken(root, { ttlMs: -1000 });
      expect(past.outcome).toBe("minted");
      if (past.outcome === "minted") {
        expect(
          (await apiClient(t.app, `${SESSION_COOKIE}=${past.token}`).get("/api/me")).status,
        ).toBe(401);
      }
      // The foreign key keeps this honest: no user row, no session row.
      expect(await mintApiToken(root, { userId: "nobody" })).toEqual({
        outcome: "no_user",
        userId: "nobody",
      });
    } finally {
      await t.cleanup();
    }
  });
});

describe("minting against the running server (the owner path)", () => {
  it("redeems the owner token over loopback for a signed session", async () => {
    const root = await makeTempRoot();
    const t = await appOn(root);
    const { server, port } = await new Promise<{
      server: ReturnType<typeof serve>;
      port: number;
    }>((resolve) => {
      const started = serve({ fetch: t.app.fetch, port: 0, hostname: "127.0.0.1" }, (info) =>
        resolve({ server: started, port: (info as AddressInfo).port }),
      );
    });
    try {
      // The lock is how the mint finds the server; in production the serve path writes it.
      fs.writeFileSync(
        path.join(root, "server.lock"),
        JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }),
      );
      const minted = await mintApiToken(root, { ttlMs: 60_000 });
      expect(minted.outcome).toBe("minted");
      if (minted.outcome !== "minted") return;
      // A SIGNED token, not a row: nothing was inserted to mint it.
      expect(minted.token.startsWith("v1.")).toBe(true);
      const rows = t.deps.db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get() as {
        n: number;
      };
      expect(rows.n).toBe(0);
      expect(
        (await apiClient(t.app, `${SESSION_COOKIE}=${minted.token}`).get("/api/me")).status,
      ).toBe(200);
    } finally {
      server.close();
      await t.cleanup();
    }
  });

  it("keeps the owner token file private", async () => {
    const root = await makeTempRoot();
    const t = await appOn(root);
    try {
      // The file is the anchor of "reading the root is ownership" — 0600, and a fresh value
      // every process start, so a leaked copy is overwhelmingly one the server no longer honors.
      expect(fs.statSync(path.join(root, "owner-token")).mode & 0o777).toBe(0o600);
    } finally {
      await t.cleanup();
    }
  });
});
