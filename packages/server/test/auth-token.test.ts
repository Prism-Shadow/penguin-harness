/**
 * Minting an API session from the data root itself (auth-token.ts).
 *
 * The point is what it does NOT need: a password. Whoever can run it can already read this
 * data root by hand — web.db, every trace, every inlined credential — so a token adds no
 * reach, it only makes that access usable through the API. Which is what lets a controller
 * reach a machine whose admin password a person has set, where reading a seeded password off
 * disk stopped working the moment they set one.
 *
 * Two things are pinned because both fail only in production. The token has to authenticate
 * against a RUNNING server — it is a row that server reads on every request, so a wrong shape
 * is invisible here and fatal there — and it must never carry more privilege than a password
 * session, since one that read back as a desktop session would reach routes reserved for the
 * shell's own window.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mintApiToken } from "../src/auth-token.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { apiClient, createTestApp, makeTempRoot } from "./helpers.js";

/**
 * A file database, not the usual in-memory one: minting happens in a DIFFERENT PROCESS from
 * the server, so the whole point is a second connection to the same file while the first
 * holds it open. An in-memory database cannot express that, and would pass by testing nothing.
 */
const withDb = async () => {
  const dbPath = path.join(await makeTempRoot(), "web.db");
  return { dbPath, app: await createTestApp({ config: { dbPath } }) };
};

describe("a minted token against a running server", () => {
  it("authenticates as the admin, and only as a password session", async () => {
    const { dbPath, app: t } = await withDb();
    try {
      const minted = mintApiToken(dbPath);
      expect(minted.outcome).toBe("minted");
      if (minted.outcome !== "minted") return;

      // The real middleware, the real cookie name, the real table read.
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

  it("expires, and refuses an account that is not there", async () => {
    const { dbPath, app: t } = await withDb();
    try {
      const past = mintApiToken(dbPath, { ttlMs: -1000 });
      expect(past.outcome).toBe("minted");
      if (past.outcome === "minted") {
        const client = apiClient(t.app, `${SESSION_COOKIE}=${past.token}`);
        expect((await client.get("/api/me")).status).toBe(401);
      }
      expect(mintApiToken(dbPath, { userId: "nobody" })).toEqual({
        outcome: "no_user",
        userId: "nobody",
      });
    } finally {
      await t.cleanup();
    }
  });
});
