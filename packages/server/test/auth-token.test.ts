/**
 * Minting an API session from the data root itself (auth-token.ts).
 *
 * The point is what it does NOT need: a password, or even a database. Whoever can run it can
 * already read this data root by hand — every credential in it — so a token adds no reach, it
 * only makes that access usable through the API. Minting is a signature against the root's
 * key (auth/token-secret.ts): the ONLY coordination with the server is that both read the
 * same file, which is what these tests actually pin — a token minted by one process
 * authenticating against another that never saw it minted.
 *
 * Also pinned: the token must never carry more privilege than a password session (one that
 * read back as "desktop" would reach routes reserved for the shell's own window), and a
 * fresh root that has never run a server must still mint — the machine-install flow needs a
 * token before first boot, for the admin that boot will seed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mintApiToken } from "../src/auth-token.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { readOrCreateAuthSecret } from "../src/auth/token-secret.js";
import { apiClient, createTestApp, makeTempRoot } from "./helpers.js";

/** An app whose root the minter shares — the deployment shape, offline mint included. */
const withSharedRoot = async () => {
  const root = await makeTempRoot();
  return {
    root,
    app: await createTestApp({ config: { root, dbPath: path.join(root, "web.db") } }),
  };
};

describe("a minted token against a running server", () => {
  it("authenticates as the admin, and only as a password session", async () => {
    const { root, app: t } = await withSharedRoot();
    try {
      const minted = mintApiToken(root);
      expect(minted.outcome).toBe("minted");
      if (minted.outcome !== "minted") return;

      // The real middleware, the real cookie name — and no database was touched to mint.
      const client = apiClient(t.app, `${SESSION_COOKIE}=${minted.token}`);
      const me = await client.get("/api/me");
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

  it("expires, and refuses an account the database says is not there", async () => {
    const { root, app: t } = await withSharedRoot();
    try {
      const past = mintApiToken(root, { ttlMs: -1000 });
      expect(past.outcome).toBe("minted");
      if (past.outcome === "minted") {
        const client = apiClient(t.app, `${SESSION_COOKIE}=${past.token}`);
        expect((await client.get("/api/me")).status).toBe(401);
      }
      // The user check is a courtesy that runs when there is a database to ask; enforcement
      // is verification, which looks the account up on every request either way.
      expect(mintApiToken(root, { userId: "nobody" })).toEqual({
        outcome: "no_user",
        userId: "nobody",
      });
    } finally {
      await t.cleanup();
    }
  });

  it("mints on a root that has never run a server, for the admin its first boot seeds", async () => {
    const root = await makeTempRoot();
    const minted = mintApiToken(root);
    expect(minted.outcome).toBe("minted");
    // The key it created is the credential of the scheme: private to the owner, and the
    // very file a later first boot adopts — which is the whole handshake.
    const mode = fs.statSync(path.join(root, "auth-token-secret")).mode & 0o777;
    expect(mode).toBe(0o600);

    if (minted.outcome !== "minted") return;
    const t = await createTestApp({ config: { root, dbPath: path.join(root, "web.db") } });
    try {
      const res = await apiClient(t.app, `${SESSION_COOKIE}=${minted.token}`).get("/api/me");
      expect(res.status).toBe(200);
    } finally {
      await t.cleanup();
    }
  });

  it("re-asserts the key file's mode on reuse", async () => {
    const root = await makeTempRoot();
    readOrCreateAuthSecret(root);
    fs.chmodSync(path.join(root, "auth-token-secret"), 0o644); // As a careless editor might.
    readOrCreateAuthSecret(root);
    expect(fs.statSync(path.join(root, "auth-token-secret")).mode & 0o777).toBe(0o600);
  });
});
