/**
 * A Session's permission level, as the composer's button shows it: one colour for how much the
 * Agent may do on its own. Derived from the two knobs that decide it — the approval mode, and
 * the Session's sandbox policy — never stored.
 *
 * - `off`: every tool call is denied.
 * - `read-only`: commands cannot write anywhere.
 * - `all`: nothing stands in the way — full filesystem access, the network open, and every
 *   tool call approved without asking.
 * - `partial`: some write permission, with something still holding it back.
 */
import type { ApprovalMode, SessionSandbox } from "@prismshadow/penguin-server/api";
import type { Tone } from "./tone";

export type PermissionLevel = "all" | "partial" | "read-only" | "off";

export function permissionLevel(approval: ApprovalMode, sandbox: SessionSandbox): PermissionLevel {
  if (approval === "deny-all") return "off";
  if (sandbox.mode === "read-only") return "read-only";
  if (
    approval === "allow-all" &&
    sandbox.mode === "danger-full-access" &&
    sandbox.network === "open"
  ) {
    return "all";
  }
  return "partial";
}

/** The tone each level reads in: the more the Agent may do unasked, the louder. */
export const PERMISSION_LEVEL_TONE: Record<PermissionLevel, Tone> = {
  all: "danger",
  partial: "attention",
  "read-only": "success",
  off: "muted",
};

/** The shield every level is drawn on. */
export const SHIELD = "M12 3 5 6v6c0 4.4 3 7.9 7 9 4-1.1 7-4.6 7-9V6l-7-3z";

/**
 * A different mark inside the shield per level, so the level reads without colour — for
 * colour-blind viewers and in any theme where the tint is hard to tell apart:
 * all = an exclamation, partial = the shield split in half, read-only = a check,
 * off = struck through.
 */
export const PERMISSION_LEVEL_GLYPH: Record<PermissionLevel, string> = {
  all: `${SHIELD}M12 8v4.5M12 16h.01`,
  partial: `${SHIELD}M12 3v18`,
  "read-only": `${SHIELD}m9 12 2 2 4-4`,
  off: `${SHIELD}M4 4l16 16`,
};

/** What a Session starts from when the server has not said: confinement off, network open. */
export const UNCONFINED: SessionSandbox = { mode: "danger-full-access", network: "open" };
