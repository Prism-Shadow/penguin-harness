/**
 * Play links: the signed tokens a played activity is served behind (see `play-routes`).
 *
 * Kept apart from the sandbox so that what signs a link needs nothing but a secret. The
 * test browser signs links for the checks it runs, and a module run signs one for its own
 * workspace before its agent starts; neither can depend on the sandbox, which depends on
 * the runs it plays.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Component, Interface } from "@prismshadow/penguin-core/kernel";

/**
 * How long a play link works. Every file the page fetches rides on it, and a book fetches
 * its pages as they are turned, so it has to outlast a working session, not one play
 * through. The page says when it has run out (see `sandbox-player`); Reload issues a new one.
 */
export const PLAY_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/** How finely a play link's expiry is rounded up; see `playLinkExpiry`. */
const PLAY_TOKEN_STEP_MS = 60 * 60 * 1000;

/**
 * When a link signed now stops working: at least the full lifetime, rounded up to the hour.
 *
 * Rounded so every link to the same activity signed within the hour is the SAME link. The
 * token is part of every URL the player fetches, and Reload signs a new one; without this,
 * each reload would start from an empty browser cache however long its media may be kept.
 */
export function playLinkExpiry(nowMs: number): number {
  return Math.ceil((nowMs + PLAY_TOKEN_TTL_MS) / PLAY_TOKEN_STEP_MS) * PLAY_TOKEN_STEP_MS;
}

/** What a play token grants: one activity's preview, on one host, until it expires. */
export interface PlayTarget {
  projectId: string;
  activityId: string;
  /** Host (no port) the preview must be served from; anything else is refused. */
  host: string;
  /** True when that host is the App's own, so the page must be sandboxed off its origin. */
  shared: boolean;
  expiresAt: number;
  /**
   * The App origin that asked for the link, which the page reports its state to (see the
   * player's inspector bridge). Signed with the rest, so a page is never told to talk to
   * an origin other than the one that opened it. Absent on links minted before it existed.
   */
  parentOrigin?: string;
  /**
   * The module run whose workspace the link plays, while it is still running or once it
   * has succeeded, instead of the activity's playing build. An assembly checks its module
   * in the real player before it finishes. Absent on every link an author opens.
   */
  runId?: string;
}

/** What a caller asks a link for; the expiry is the signer's to set. */
export type PlayGrant = Omit<PlayTarget, "expiresAt">;

export abstract class ActivityPlayLinks extends Interface<{
  /** Signs a link for a caller already authorised for the activity it names. */
  sign(grant: PlayGrant): { token: string; expiresAt: number };
  /** What a play token grants, or null when it is forged, expired or for another host. */
  verify(token: string, host: string): PlayTarget | null;
}>() {}

@Component()
export class ActivityPlayLinksService implements ActivityPlayLinks {
  /** Per process: a restart ends every open preview, which is fine. */
  private readonly secret = randomBytes(32);

  sign(grant: PlayGrant): { token: string; expiresAt: number } {
    const target: PlayTarget = {
      projectId: grant.projectId,
      activityId: grant.activityId,
      host: grant.host.toLowerCase(),
      shared: grant.shared,
      expiresAt: playLinkExpiry(Date.now()),
      ...(grant.parentOrigin ? { parentOrigin: grant.parentOrigin } : {}),
      ...(grant.runId ? { runId: grant.runId } : {}),
    };
    const body = Buffer.from(JSON.stringify(target), "utf8").toString("base64url");
    return {
      token: `${body}.${this.mac(body).toString("base64url")}`,
      expiresAt: target.expiresAt,
    };
  }

  private mac(body: string): Buffer {
    return createHmac("sha256", this.secret).update(body).digest();
  }

  verify(token: string, host: string): PlayTarget | null {
    const dot = token.indexOf(".");
    if (dot <= 0 || dot === token.length - 1) return null;
    const body = token.slice(0, dot);
    const provided = Buffer.from(token.slice(dot + 1), "base64url");
    const expected = this.mac(body);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    let target: PlayTarget;
    try {
      target = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PlayTarget;
    } catch {
      return null;
    }
    if (
      typeof target?.projectId !== "string" ||
      typeof target.activityId !== "string" ||
      typeof target.host !== "string" ||
      typeof target.expiresAt !== "number" ||
      (target.runId !== undefined && typeof target.runId !== "string")
    )
      return null;
    if (Date.now() >= target.expiresAt) return null;
    // The host binding is what keeps a preview on the origin it was issued for.
    if (target.host !== host.toLowerCase()) return null;
    return target;
  }
}
