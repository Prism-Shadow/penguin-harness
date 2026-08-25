/**
 * Minting a short-lived API session from the machine's own disk, for whoever is already on it.
 *
 * WHAT AUTHORIZES IT is the ability to read the data root, which already holds every credential
 * the token could reach. What it is exchanged THROUGH is this boot's `<root>/owner-token`,
 * redeemed at `POST /api/auth/owner` over loopback: the server signs with its in-memory key, so
 * no secret at rest is involved at either end.
 *
 * A stopped server cannot mint. The signing key lives in the process, and a session it did not
 * sign is not a session — so the answer there is to start it, not to write something to disk
 * that would outlive the reasons for trusting it.
 *
 * The claims record `v: "cli"`. Nothing grants privilege from it: verification maps anything
 * that is not "desktop" or "setup" to an ordinary password session.
 */
import http from "node:http";
import { readServerLock } from "./lock.js";
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
  opts: { userId?: string; ttlMs?: number; now?: () => Date } = {},
): Promise<MintTokenResult> {
  const userId = opts.userId ?? "admin";
  const ttlMs = opts.ttlMs ?? CLI_TOKEN_TTL_MS;

  const lock = readServerLock(root);
  const ownerToken = lock === null ? null : readOwnerToken(root);
  if (lock === null || ownerToken === null) {
    return { outcome: "no_server" };
  }
  return redeemOverLoopback(lock.port, ownerToken, userId, ttlMs);
}

/** One redemption call to the local server. node:http with the canonical Host, as everywhere. */
function redeemOverLoopback(
  port: number,
  ownerToken: string,
  userId: string,
  ttlMs: number,
): Promise<MintTokenResult> {
  return new Promise((resolve) => {
    const body = Buffer.from(
      JSON.stringify({ ownerToken, userId, ttlSeconds: Math.max(1, Math.round(ttlMs / 1000)) }),
    );
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/auth/owner",
        method: "POST",
        headers: {
          host: `localhost:${port}`,
          "content-type": "application/json",
          "content-length": String(body.byteLength),
        },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            resolve({
              outcome: "failed",
              detail: `the server answered ${res.statusCode ?? 0}: ${text.slice(0, 200)}`,
            });
            return;
          }
          try {
            const parsed = JSON.parse(text) as { token?: unknown; expiresAt?: unknown };
            if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "string") {
              resolve({ outcome: "failed", detail: "the server's answer had no token in it" });
              return;
            }
            resolve({
              outcome: "minted",
              token: parsed.token,
              userId,
              expiresAt: parsed.expiresAt,
            });
          } catch {
            resolve({ outcome: "failed", detail: "the server's answer was not JSON" });
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ outcome: "failed", detail: "the local server did not answer in time" });
    });
    req.on("error", (err) => resolve({ outcome: "failed", detail: err.message }));
    req.end(body);
  });
}
