/**
 * Desktop mode (PENGUIN_DESKTOP_TOKEN): the shell that spawned this server proves itself
 * with a per-launch random token, which backs two endpoints with different consumption
 * rules:
 *
 * - `GET /api/auth/claim?token=…` — ONE-SHOT: the window's first navigation
 *   redeems the token for a standard admin cookie session; every later attempt fails,
 *   so a leaked URL cannot be replayed.
 * - `POST /api/desktop/shutdown` (Authorization: Bearer <token>) — REUSABLE for the
 *   process lifetime: the token here identifies the supervising shell, which may need
 *   the endpoint at any point (POSIX quit, and the only graceful path on Windows,
 *   where killing a child is a hard TerminateProcess).
 *
 * Comparisons hash both sides first so timingSafeEqual gets equal-length buffers.
 *
 * The service is also the shell↔web relay for client updates: the shell pushes its
 * updater snapshot over the utilityProcess message channel (index.ts wires the port),
 * the web reads it at GET /api/desktop/update and posts check/install commands that are
 * forwarded back to the shell. The window itself stays a plain browser — every
 * capability flows through this HTTP surface, never a renderer IPC bridge.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { DesktopUpdateStatus } from "../api/types.js";

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

  // --- client-update relay ---------------------------------------------------

  private updateStatus: DesktopUpdateStatus | null = null;
  private updateCommandSender: ((action: "check" | "install") => void) | null = null;

  /** Latest shell snapshot; null until the shell's first push lands. */
  getUpdateStatus(): DesktopUpdateStatus | null {
    return this.updateStatus;
  }

  /** index.ts stores each shell push here (already validated at the message port). */
  setUpdateStatus(status: DesktopUpdateStatus): void {
    this.updateStatus = status;
  }

  /** index.ts registers the message-port sender; absent outside a shell-forked process. */
  onUpdateCommand(sender: (action: "check" | "install") => void): void {
    this.updateCommandSender = sender;
  }

  /** Invoked by the update routes; false when no shell port is wired (tests, plain runs). */
  requestUpdateCommand(action: "check" | "install"): boolean {
    if (!this.updateCommandSender) return false;
    this.updateCommandSender(action);
    return true;
  }
}
