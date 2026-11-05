/**
 * Pairing a user's Chrome, through the routes of the real platform tree.
 *
 * - Given a code minted for the signed-in user, the extension trades it — with no cookie — for
 *   a token bound to that user; the database keeps only the token's hash, and the user's list
 *   shows the new Chrome.
 * - A code works once.
 * - A code stops working ten minutes after it was minted; a new code replaces the user's last.
 * - Five wrong attempts at a code burn it: the right code fails afterwards. Four do not.
 * - The pairing route answers the extension's origin with CORS (the preflight and Chrome's
 *   Private Network Access one included, errors too), turns a web page's or another
 *   extension's origin away, and no other route answers with CORS.
 * - Revoking a Chrome takes it off the user's list; another user's Chrome cannot be revoked.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BrowserExtensionPairResponse,
  BrowserExtensionPairingResponse,
  BrowserExtensionsResponse,
} from "../../src/api/types.js";
import { PENGUIN_EXTENSION_ID } from "../../src/builtin-browser/extension-origin.js";
import { apiClient, createTestApp, provisionUser } from "../helpers.js";
import type { TestApp } from "../helpers.js";

const EXTENSION_ORIGIN = `chrome-extension://${PENGUIN_EXTENSION_ID}`;

let t: TestApp;
let clock: number;
let cookie: string;
beforeEach(async () => {
  clock = Date.parse("2026-10-02T09:00:00.000Z");
  t = await createTestApp({ now: () => new Date(clock) });
  cookie = (await provisionUser(t.app, "alice")).cookie;
});
afterEach(async () => {
  await t.cleanup();
});

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const errorOf = async (res: Response) => (await res.json()) as { error: { code: string } };

async function mint(): Promise<BrowserExtensionPairingResponse> {
  const res = await apiClient(t.app, cookie).post("/api/builtin-browser/extension/pairings");
  expect(res.status).toBe(200);
  return json<BrowserExtensionPairingResponse>(res);
}

/** The extension's own request: no cookie, its origin when given. */
async function pair(code: string, origin?: string): Promise<Response> {
  return await t.app.request("/api/builtin-browser/extension/pair", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin !== undefined ? { origin } : {}),
    },
    body: JSON.stringify({ code, name: "Chrome 130 on Linux", version: "0.2.13" }),
  });
}

/** The code with its last character changed (the n-th way): the same code's name, the wrong secret. */
function misspelt(code: string, n: number): string {
  const last = code.charAt(code.length - 1);
  return code.slice(0, -1) + "ABCDEFGHIJKL".replace(last, "").charAt(n);
}

describe("pairing a Chrome", () => {
  it("trades a code for a token bound to the user, storing only the token's hash", async () => {
    const { code, expiresAt } = await mint();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(expiresAt) - clock).toBe(10 * 60_000);

    const res = await pair(code);
    expect(res.status).toBe(200);
    const paired = await json<BrowserExtensionPairResponse>(res);
    expect(paired.user).toEqual({ userId: "alice", displayName: null });
    expect(paired.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const rows = t.deps.db.prepare("SELECT user_id, token_hash FROM browser_extensions").all() as {
      user_id: string;
      token_hash: string;
    }[];
    expect(rows).toEqual([
      {
        user_id: "alice",
        token_hash: createHash("sha256").update(paired.token).digest("hex"),
      },
    ]);
    const listed = await json<BrowserExtensionsResponse>(
      await apiClient(t.app, cookie).get("/api/builtin-browser/extension"),
    );
    expect(listed).toEqual({
      paired: [
        {
          id: paired.extensionId,
          name: "Chrome 130 on Linux",
          version: "0.2.13",
          createdAt: new Date(clock).toISOString(),
          lastSeenAt: null,
          connected: false,
        },
      ],
      enabled: true,
    });
  });

  it("works once", async () => {
    const { code } = await mint();
    expect((await pair(code)).status).toBe(200);
    const again = await pair(code);
    expect(again.status).toBe(401);
    expect((await errorOf(again)).error.code).toBe("invalid_code");
  });

  it("expires ten minutes after it was minted, and a new code replaces the last", async () => {
    const first = await mint();
    const second = await mint();
    expect((await pair(first.code)).status).toBe(401);
    clock += 10 * 60_000;
    expect((await pair(second.code)).status).toBe(401);
  });

  it("is burned by five wrong attempts, and survives four", async () => {
    const survivor = await mint();
    for (let n = 0; n < 4; n++) expect((await pair(misspelt(survivor.code, n))).status).toBe(401);
    expect((await pair(survivor.code)).status).toBe(200);

    const burned = await mint();
    for (let n = 0; n < 5; n++) expect((await pair(misspelt(burned.code, n))).status).toBe(401);
    expect((await pair(burned.code)).status).toBe(401);
  });
});

describe("the pairing route's origin rules", () => {
  it("answers an extension's origin with CORS, preflight and errors included", async () => {
    const preflight = await t.app.request("/api/builtin-browser/extension/pair", {
      method: "OPTIONS",
      headers: {
        origin: EXTENSION_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
        // Chrome's Private Network Access preflight, for a server on the loopback or the LAN.
        "access-control-request-private-network": "true",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");

    const { code } = await mint();
    const wrong = await pair(misspelt(code, 0), EXTENSION_ORIGIN);
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
    const right = await pair(code, EXTENSION_ORIGIN);
    expect(right.status).toBe(200);
    expect(right.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
  });

  it("turns a web page's and another extension's origin away, and no other route answers with CORS", async () => {
    const { code } = await mint();
    for (const origin of [
      "https://evil.example",
      "chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh",
    ]) {
      const refused = await pair(code, origin);
      expect(refused.status).toBe(403);
      expect(refused.headers.get("access-control-allow-origin")).toBeNull();
    }
    // The code was not spent on it.
    expect((await pair(code)).status).toBe(200);

    const status = await t.app.request("/api/builtin-browser/status", {
      headers: { cookie, origin: EXTENSION_ORIGIN },
    });
    expect(status.status).toBe(200);
    expect(status.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("revoking a Chrome", () => {
  it("takes it off the user's list; another user's Chrome is not theirs to revoke", async () => {
    const { code } = await mint();
    const { extensionId } = await json<BrowserExtensionPairResponse>(await pair(code));
    const bob = apiClient(t.app, (await provisionUser(t.app, "bob")).cookie);
    expect((await bob.delete(`/api/builtin-browser/extension/${extensionId}`)).status).toBe(404);

    const alice = apiClient(t.app, cookie);
    expect((await alice.delete(`/api/builtin-browser/extension/${extensionId}`)).status).toBe(204);
    const listed = await json<BrowserExtensionsResponse>(
      await alice.get("/api/builtin-browser/extension"),
    );
    expect(listed.paired).toEqual([]);
  });
});
