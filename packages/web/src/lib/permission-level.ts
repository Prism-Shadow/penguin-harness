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

/** lucide `shield`: the outline the three shield icons below share. */
export const SHIELD =
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";

/**
 * lucide's shield icons, one per level, so the level reads without colour: `shield-alert`
 * (all), `shield-half` (partial), `shield-check` (read-only), `shield-off` (off). Each icon's
 * `<path>` elements are joined into one `d` for GlyphIcon, a relative `m` rewritten as the
 * same absolute move, since a joined path would otherwise start it from the previous subpath.
 */
export const PERMISSION_LEVEL_GLYPH: Record<PermissionLevel, string> = {
  all: `${SHIELD}M12 8v4M12 16h.01`,
  partial: `${SHIELD}M12 22V2`,
  "read-only": `${SHIELD}M9 12l2 2 4-4`,
  off:
    "M2 2l20 20" +
    "M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71" +
    "M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264",
};

/** What a Session starts from when the server has not said: confinement off, network open. */
export const UNCONFINED: SessionSandbox = { mode: "danger-full-access", network: "open" };
