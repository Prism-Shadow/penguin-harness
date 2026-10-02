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
import { ICONS } from "@prismshadow/penguin-ui";
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

/**
 * One shield per level, so the level reads without colour: the exclamation (all), the half
 * (partial), the check (read-only) and the struck-through shield (off).
 */
export const PERMISSION_LEVEL_GLYPH: Record<PermissionLevel, string> = {
  all: ICONS.shieldAlert,
  partial: ICONS.shieldHalf,
  "read-only": ICONS.shieldCheck,
  off: ICONS.shieldOff,
};

/**
 * Why a sandbox level cannot be picked on this server, or null when it can. With no backend
 * mounted, every level short of full access would refuse every command: `unavailable` when a
 * backend is enabled but failed to load or failed its check (see `firstUnavailableBackend`),
 * `no-backend` when none is enabled at all. Otherwise, the network level the mounted backends
 * cannot enforce. Only an explicit false from the server counts — one that does not report a
 * level is not second-guessed.
 */
export type LevelBlock = "no-backend" | "unavailable" | "local-unsupported" | "none-unsupported";

/** The first enabled backend that is not in use, whose reason the composer shows, or null. */
export function firstUnavailableBackend(
  sandbox: SessionSandbox,
): { name: string; reason: string } | null {
  return sandbox.unavailableBackends?.[0] ?? null;
}

/** The block for a level no mounted backend can enforce: why nothing is mounted. */
function unmounted(sandbox: SessionSandbox): LevelBlock {
  return firstUnavailableBackend(sandbox) === null ? "no-backend" : "unavailable";
}

export function fsModeBlock(
  sandbox: SessionSandbox,
  mode: SessionSandbox["mode"],
): LevelBlock | null {
  if (mode === "danger-full-access") return null;
  return sandbox.confinementSupported === false ? unmounted(sandbox) : null;
}

export function networkBlock(
  sandbox: SessionSandbox,
  network: SessionSandbox["network"],
): LevelBlock | null {
  if (network === "open") return null;
  if (sandbox.confinementSupported === false) return unmounted(sandbox);
  // `local` predates the other two flags, and has always been refused unless reported true.
  if (network === "local") {
    return sandbox.localNetworkSupported === true ? null : "local-unsupported";
  }
  return sandbox.noNetworkSupported === false ? "none-unsupported" : null;
}

/** What a Session starts from when the server has not said: confinement off, network open. */
export const UNCONFINED: SessionSandbox = { mode: "danger-full-access", network: "open" };
