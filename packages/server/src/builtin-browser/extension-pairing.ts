/**
 * Pairing a user's Chrome: a one-time code minted for the signed-in user in the Web App, pasted
 * into the extension's options page, and traded there for a long-lived token.
 *
 * - The code is 32 random bytes as base64url (43 characters), held in memory only, for ten
 *   minutes, used once. A user has one live code at a time: a new one replaces the last.
 * - Its first eight characters name it; a code whose name matches but whose rest does not is a
 *   failed attempt at that code, and five of them burn it (a pasted code with a typo costs one).
 * - The token is 32 random bytes as base64url, handed to the extension once and stored only as
 *   its sha256 (browser_extensions.token_hash); the extension presents it in the WebSocket's
 *   subprotocol list, never in a URL.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { BrowserExtensionPairRequest, BrowserExtensionPairResponse } from "../api/types.js";
import type { BrowserExtensionStore } from "../db/repos/browser-extensions.js";
import { HttpError } from "../http/errors.js";

export const PAIRING_CODE_TTL_MS = 10 * 60_000;
/** Failed attempts at one code before it is burned. */
export const PAIRING_MAX_FAILURES = 5;
/** The characters of a code that name it. */
const CODE_KEY_CHARS = 8;
const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const NAME_MAX = 80;
const VERSION_SHAPE = /^[0-9A-Za-z.+-]{1,40}$/;

/** sha256 hex: how a token is stored and looked up. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface LiveCode {
  userId: string;
  hash: Buffer;
  expiresAt: number;
  failures: number;
}

export interface ExtensionPairingDeps {
  store: BrowserExtensionStore;
  /** The user a code was minted for, as the extension is told about them; null once deleted. */
  user(userId: string): { userId: string; displayName: string | null } | null;
  /** This data root's install id (install-id.ts); null when unknown. */
  installId(): string | null;
  serverVersion: string;
  now(): number;
}

const invalidCode = () =>
  new HttpError(
    401,
    "invalid_code",
    "This pairing code is not valid or has expired; create a new one in the Browser panel (Connect your Chrome).",
  );

export class ExtensionPairing {
  /** Live codes by their first CODE_KEY_CHARS characters. */
  private readonly codes = new Map<string, LiveCode>();

  constructor(private readonly deps: ExtensionPairingDeps) {}

  /** A fresh code for `userId`, replacing any code of theirs still live. */
  mint(userId: string): { code: string; expiresAt: string } {
    this.prune();
    for (const [key, live] of this.codes) if (live.userId === userId) this.codes.delete(key);
    let code: string;
    do {
      code = randomBytes(32).toString("base64url");
    } while (this.codes.has(code.slice(0, CODE_KEY_CHARS)));
    const expiresAt = this.deps.now() + PAIRING_CODE_TTL_MS;
    this.codes.set(code.slice(0, CODE_KEY_CHARS), {
      userId,
      hash: createHash("sha256").update(code).digest(),
      expiresAt,
      failures: 0,
    });
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Trades a code for a pairing: a new browser_extensions row and the token only the extension keeps. */
  pair(request: BrowserExtensionPairRequest): BrowserExtensionPairResponse {
    const name = request.name.trim();
    if (name === "" || name.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new HttpError(
        400,
        "bad_request",
        `name must be 1 to ${NAME_MAX} printable characters.`,
      );
    }
    if (!VERSION_SHAPE.test(request.version)) {
      throw new HttpError(
        400,
        "bad_request",
        "version must be the extension's version, e.g. 0.2.13.",
      );
    }
    this.prune();
    const code = request.code.trim();
    if (!CODE_SHAPE.test(code)) throw invalidCode();
    const key = code.slice(0, CODE_KEY_CHARS);
    const live = this.codes.get(key);
    if (live === undefined) throw invalidCode();
    if (!timingSafeEqual(live.hash, createHash("sha256").update(code).digest())) {
      live.failures += 1;
      if (live.failures >= PAIRING_MAX_FAILURES) this.codes.delete(key);
      throw invalidCode();
    }
    this.codes.delete(key);
    const user = this.deps.user(live.userId);
    if (user === null) throw invalidCode();
    const token = randomBytes(32).toString("base64url");
    const extensionId = randomBytes(12).toString("base64url");
    this.deps.store.insert({
      extensionId,
      userId: user.userId,
      tokenHash: tokenHash(token),
      name,
      version: request.version,
      createdAt: new Date(this.deps.now()).toISOString(),
      lastSeenAt: null,
      revokedAt: null,
    });
    return {
      extensionId,
      token,
      installId: this.deps.installId(),
      user: { userId: user.userId, displayName: user.displayName },
      serverVersion: this.deps.serverVersion,
    };
  }

  private prune(): void {
    const now = this.deps.now();
    for (const [key, live] of this.codes) if (live.expiresAt <= now) this.codes.delete(key);
  }
}
