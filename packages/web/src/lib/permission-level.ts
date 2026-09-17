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

/** What a Session starts from when the server has not said: confinement off, network open. */
export const UNCONFINED: SessionSandbox = { mode: "danger-full-access", network: "open" };
