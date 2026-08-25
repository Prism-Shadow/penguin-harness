/**
 * Minting a short-lived API session from the machine's own disk, for whoever is already on it.
 *
 * WHAT AUTHORIZES IT is the ability to read the data root, which already holds every credential
 * the token could reach. What it is exchanged THROUGH is this boot's `<root>/owner-token`,
 * redeemed at `POST /api/auth/owner` over loopback: the server signs with its in-memory key, so
 * no secret at rest is involved at either end. A stopped server cannot mint — the signing key
 * lives in its process — so the answer there is to start it, not to write something to disk.
 *
 * Also home to `call()`, the one HTTP client this project hand-rolls: the API answers only under
 * its canonical app host, and a request arriving as `Host: 127.0.0.1:<port>` is treated as the
 * preview surface and refused. `fetch` ignores an explicit host header, node:http honors it —
 * so the connection goes to the address while the header says the canonical name. Shared with
 * the CLI (login/logout) instead of existing twice.
 */
import http from "node:http";
import https from "node:https";
import { liveServerLock } from "./lock.js";
import { readOwnerToken } from "./auth/owner-token.js";

/** An hour, matching what a controller needs: long enough to finish, short enough to forget. */
export const CLI_TOKEN_TTL_MS = 60 * 60_000;

export type MintTokenResult =
  | { outcome: "minted"; token: string; userId: string; expiresAt: string }
  /** Nothing is listening on this data root, so there is no key to sign with. */
  | { outcome: "no_server" }
  | { outcome: "failed"; detail: string };

/** Issues an API session token for the data root at `root`. */
export async function mintApiToken(
  root: string,
  opts: { userId?: string; ttlMs?: number } = {},
): Promise<MintTokenResult> {
  const userId = opts.userId ?? "admin";
  const ttlMs = opts.ttlMs ?? CLI_TOKEN_TTL_MS;

  // liveServerLock, not a raw read: a stale lock left by a crashed server points at a port
  // some other local process may now hold, and minting would redeem THIS boot's owner token
  // against it. The PID+port liveness check refuses a lock whose server is gone.
  const lock = await liveServerLock(root);
  if (lock === null) return { outcome: "no_server" };
  const ownerToken = readOwnerToken(root);
  // A live lock with no readable token is a different fact than "nothing is listening",
  // and telling the caller to start the server would be wrong advice — it is running.
  if (ownerToken === null) {
    return {
      outcome: "failed",
      detail: `a server is running but ${root}/owner-token is unreadable`,
    };
  }

  let answer: HttpAnswer;
  try {
    answer = await call(
      `http://localhost:${lock.port}`,
      { method: "POST", path: "/api/auth/owner" },
      { ownerToken, userId, ttlSeconds: Math.max(1, Math.round(ttlMs / 1000)) },
    );
  } catch (err) {
    return { outcome: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
  if (answer.status !== 200) {
    return {
      outcome: "failed",
      detail: `the server answered ${answer.status}: ${answer.text.slice(0, 200)}`,
    };
  }
  try {
    const parsed = JSON.parse(answer.text) as { token?: unknown; expiresAt?: unknown };
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "string") {
      return { outcome: "failed", detail: "the server's answer had no token in it" };
    }
    return { outcome: "minted", token: parsed.token, userId, expiresAt: parsed.expiresAt };
  } catch {
    return { outcome: "failed", detail: "the server's answer was not JSON" };
  }
}

export interface HttpAnswer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

/**
 * One request with the Host header set to the target's canonical app host (see module doc).
 * Both schemes: a login target may be a TLS deployment as easily as a loopback port. Loopback
 * connects by address (`localhost` may resolve to ::1 where the server bound 127.0.0.1 only)
 * while the header keeps the name — the spelling the API accepts.
 */
export function call(
  url: string,
  options: { method: string; path: string; cookie?: string },
  body?: unknown,
): Promise<HttpAnswer> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`not a URL: ${url}`));
      return;
    }
    const secure = target.protocol === "https:";
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const port = target.port !== "" ? Number(target.port) : secure ? 443 : 80;
    const host = target.hostname === "localhost" ? "127.0.0.1" : target.hostname;
    const req = (secure ? https : http).request(
      {
        host,
        port,
        path: options.path,
        method: options.method,
        headers: {
          host: target.host,
          ...(options.cookie !== undefined ? { cookie: options.cookie } : {}),
          ...(payload === null
            ? {}
            : { "content-type": "application/json", "content-length": String(payload.length) }),
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("the server did not answer in time"));
    });
    req.on("error", reject);
    if (payload === null) req.end();
    else req.end(payload);
  });
}
