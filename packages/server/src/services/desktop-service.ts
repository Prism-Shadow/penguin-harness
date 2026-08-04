/**
 * Desktop mode (PENGUIN_DESKTOP_TOKEN): the shell that spawned this server proves itself
 * with a per-launch random token, which backs two endpoints with different consumption
 * rules:
 *
 * - `GET /api/auth/desktop-login?token=…` — ONE-SHOT: the window's first navigation
 *   redeems the token for a standard admin cookie session; every later attempt fails,
 *   so a leaked URL cannot be replayed.
 * - `POST /api/desktop/shutdown` (Authorization: Bearer <token>) — REUSABLE for the
 *   process lifetime: the token here identifies the supervising shell, which may need
 *   the endpoint at any point (POSIX quit, and the only graceful path on Windows,
 *   where killing a child is a hard TerminateProcess).
 *
 * Comparisons hash both sides first so timingSafeEqual gets equal-length buffers.
 * Docs: design § "桌面端原型 · 桌面登录".
 */
import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export class DesktopService {
  private readonly tokenDigest: Buffer;
  private loginConsumed = false;
  private shutdownHandler: (() => void) | null = null;

  constructor(token: string) {
    this.tokenDigest = digest(token);
  }

  /** Constant-time token check (no consumption). */
  verifyToken(candidate: string): boolean {
    return timingSafeEqual(digest(candidate), this.tokenDigest);
  }

  /** One-shot login redemption: true exactly once, for the correct token. */
  redeemLoginToken(candidate: string): boolean {
    if (this.loginConsumed || !this.verifyToken(candidate)) return false;
    this.loginConsumed = true;
    return true;
  }

  /** index.ts registers the actual graceful-shutdown trigger after assembly. */
  onShutdownRequest(handler: () => void): void {
    this.shutdownHandler = handler;
  }

  /** Invoked by the shutdown route; false when no handler is registered (tests). */
  requestShutdown(): boolean {
    if (!this.shutdownHandler) return false;
    this.shutdownHandler();
    return true;
  }
}
