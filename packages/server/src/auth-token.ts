/**
 * Minting a short-lived API session from the machine's own disk, for whoever is already on it.
 *
 * WHAT AUTHORIZES THIS has never changed: the ability to read the data root, which already
 * holds every credential the server can reach. What changed is what that ability is exchanged
 * THROUGH, so that nothing long-lived rests on disk:
 *
 * - Server running (the overwhelming case — a controller minting on a machine has just probed
 *   its server): read this boot's `<root>/owner-token` and redeem it at `POST /api/auth/owner`
 *   over loopback. The server signs with its in-memory key; no secret at rest is involved at
 *   either end.
 * - Server stopped: there is no signing key anywhere — it lived in the process — so fall back
 *   to the one session shape that needs no key: a legacy database row, which the verification
 *   path still honors. Cold path, one INSERT, and the row dies at its TTL.
 *
 * The claims record `v: "cli"` either way. Nothing grants privilege from it — verification
 * maps anything that is not "desktop" to an ordinary password session, so a minted token can
 * never reach the desktop-only routes.
 */
import http from "node:http";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { readServerLock } from "./lock.js";
import { readOwnerToken } from "./auth/owner-token.js";
import { openDatabase } from "./db/database.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { UsersRepo } from "./db/repos/users.js";

/** An hour, matching what a controller needs: long enough to finish, short enough to forget. */
export const CLI_TOKEN_TTL_MS = 60 * 60_000;

export type MintTokenResult =
  | { outcome: "minted"; token: string; userId: string; expiresAt: string }
  | { outcome: "no_user"; userId: string }
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
  if (lock !== null && ownerToken !== null) {
    const redeemed = await redeemOverLoopback(lock.port, ownerToken, userId, ttlMs);
    if (redeemed.outcome !== "failed") return redeemed;
    // A lock whose server is gone (a crash left the file behind): fall through to the row,
    // exactly as if there were no lock. The detail is not worth surfacing — the row works.
  }

  return mintRow(root, userId, ttlMs, opts.now?.() ?? new Date());
}

/**
 * The stopped-server path: a session row, the shape verification has always honored.
 *
 * The foreign key on auth_sessions keeps this honest about accounts: a root whose database
 * has never seeded a user cannot hold a session row for one, so the answer there is `no_user`
 * — start the server once, or mint against it running.
 */
function mintRow(root: string, userId: string, ttlMs: number, now: Date): MintTokenResult {
  const dbPath = process.env.PENGUIN_WEB_DB ?? path.join(root, "web.db");
  let db;
  try {
    db = openDatabase(dbPath);
  } catch (err) {
    return { outcome: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
  try {
    if (new UsersRepo(db).findById(userId) === null) return { outcome: "no_user", userId };
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    new AuthSessionsRepo(db).insert({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId,
      createdAt: now.toISOString(),
      expiresAt,
      via: "cli",
    });
    return { outcome: "minted", token, userId, expiresAt };
  } finally {
    db.close();
  }
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
