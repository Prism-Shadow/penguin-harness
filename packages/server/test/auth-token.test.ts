/**
 * Minting an API session from the data root (auth-token.ts).
 *
 * Exercised against a REAL listening server, because the hop itself — the lock file, the Host
 * header, the JSON shapes — is precisely what an in-process test cannot see. A stopped server
 * has no key to sign with and says so.
 */
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { mintApiToken } from "../src/auth-token.js";
import { issueOwnerToken, ownerTokenPath, readOwnerToken } from "../src/auth/owner-token.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { apiClient, createTestApp, makeTempRoot } from "./helpers.js";

const appOn = async (root: string) =>
  createTestApp({ config: { root, dbPath: path.join(root, "web.db") } });

describe("minting an API session", () => {
  it("refuses when no server is listening on the data root", async () => {
    // The signing key lives in the process, so a stopped server has nothing to sign with —
    // and writing something to disk instead would outlive the reason for trusting it.
    const root = await makeTempRoot();
    expect(await mintApiToken(root)).toEqual({ outcome: "no_server" });
  });

  it("with the server running, redeems the owner token over loopback for a signed token", async () => {
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
      // The anchor of "reading the data root is ownership" is private to its owner.
      expect(fs.statSync(path.join(root, "owner-token")).mode & 0o777).toBe(0o600);
      // The lock is how the mint finds the server; in production the serve path writes it.
      fs.writeFileSync(
        path.join(root, "server.lock"),
        JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }),
      );

      const minted = await mintApiToken(root, { ttlMs: 60_000 });
      expect(minted.outcome).toBe("minted");
      if (minted.outcome !== "minted") return;
      // A SIGNED token, and nothing was inserted to mint it.
      expect(minted.token.startsWith("v1.")).toBe(true);
      expect(
        (await apiClient(t.app, `${SESSION_COOKIE}=${minted.token}`).get("/api/me")).status,
      ).toBe(200);
    } finally {
      server.close();
      await t.cleanup();
    }
  });
});

describe("issuing the owner token", () => {
  /**
   * The root's own mode is the umask's, so someone who can only WRITE the root could park a
   * symlink here and have the next boot deliver the token into a file they can read — turning
   * write access into the admin session that reading the root is supposed to gate. The write
   * must refuse to follow.
   */
  it("refuses to write through a symlink parked at the token path", async () => {
    const root = await makeTempRoot();
    const outside = path.join(root, "attacker-readable");
    fs.writeFileSync(outside, "");
    fs.symlinkSync(outside, ownerTokenPath(root));
    // rm-then-exclusive-create makes the parked link vanish rather than be followed; a link
    // re-planted inside the race window makes the exclusive create throw instead. Either
    // way the attacker's file never receives a token.
    issueOwnerToken(root);
    expect(fs.readFileSync(outside, "utf8")).toBe("");
    expect(fs.lstatSync(ownerTokenPath(root)).isSymbolicLink()).toBe(false);
    expect(readOwnerToken(root)).not.toBeNull();
    await fs.promises.rm(root, { recursive: true, force: true });
  });
});
