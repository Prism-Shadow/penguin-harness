/**
 * What raises an update notification badge, and what the anchor carrying it says.
 *
 * Two independent trails end in two different controls, so they are two independent gates:
 * a *software* update, actionable in the sidebar user menu, and an *Agent kernel* update,
 * actionable on the Agent settings page. The outermost chrome (the mobile menu button) shows
 * one dot for either.
 *
 * Every gate here is written as "is there a control the user can reach": a badge over a path
 * with nothing actionable at the end of it is worse than no badge. That is why the software
 * gate takes which row the running mode actually offers — desktop mode hides the server
 * release row entirely and updates the client through the shell instead, so a newer server
 * release must not raise a dot there.
 *
 * Pure decisions only (vitest runs node-only here, so nothing renders) — `use-update-badges.ts`
 * wires them to the live stores and turns a note into localized copy.
 */
import type {
  AgentSummary,
  DesktopUpdateStatus,
  UpdateCheckResponse,
} from "@prismshadow/penguin-server/api";
import { clientUpdateRow } from "./desktop-update";

/** A software update the running mode can act on, and the version the offer names. */
export type SoftwareUpdate =
  | { kind: "release"; version: string }
  /** A client build the shell has downloaded; `version` is null when the shell did not name one. */
  | { kind: "client"; version: string | null };

/**
 * The newer release the server-update row acts on, or null. A resolved version is required,
 * not just the boolean — the row and every tooltip along the trail name it, so an "available
 * but unnamed" result must not raise a dot leading to a versionless reminder. The check is
 * fail-soft on the server, so a disabled check (`PENGUIN_UPDATE_CHECK=off`) and a failed
 * lookup both arrive as `updateAvailable: false` and raise nothing.
 */
export function releaseUpdate(update: UpdateCheckResponse | null): string | null {
  return update?.updateAvailable === true ? (update.latestVersion ?? null) : null;
}

export interface SoftwareUpdateInput {
  /** Whether the sidebar user menu offers the server release row here (everything but desktop mode). */
  releaseRowOffered: boolean;
  /** Whether it offers the desktop client row here (`offersClientUpdate`: the shell's own window). */
  clientRowOffered: boolean;
  update: UpdateCheckResponse | null;
  clientStatus: DesktopUpdateStatus | null;
}

/**
 * The one software gate behind every dot on that trail. A client build still downloading is
 * deliberately not one: the row shows its progress, but there is nothing for the user to do
 * until it lands, and a badge that cannot be cleared by acting on it is noise.
 */
export function softwareUpdate(input: SoftwareUpdateInput): SoftwareUpdate | null {
  if (input.releaseRowOffered) {
    const version = releaseUpdate(input.update);
    if (version !== null) return { kind: "release", version };
  }
  if (input.clientRowOffered) {
    const row = clientUpdateRow(input.clientStatus);
    if (row.action === "install") return { kind: "client", version: row.version };
  }
  return null;
}

/**
 * Whether any Agent in the current Project carries an outdated kernel — the gate for the
 * Agents nav entries, which lead to the list where the individual cards say which ones. The
 * flag rides along on the Project's Agent list, so this costs no request of its own.
 */
export function anyKernelOutdated(
  agents: ReadonlyArray<Pick<AgentSummary, "kernelOutdated">>,
): boolean {
  return agents.some((a) => a.kernelOutdated);
}

/**
 * What an anchor covering BOTH trails says. `mixed` is the combined case: two different
 * things are updatable and the anchor leads to both, so it must not claim to be either.
 */
export type UpdateBadgeNote =
  | { kind: "none" }
  | { kind: "release"; version: string }
  | { kind: "client"; version: string | null }
  | { kind: "kernel" }
  | { kind: "mixed" };

/** Classifies what one anchor over both trails should say (see {@link UpdateBadgeNote}). */
export function updateBadgeNote(software: SoftwareUpdate | null, kernel: boolean): UpdateBadgeNote {
  if (software !== null && kernel) return { kind: "mixed" };
  if (software !== null) return software;
  if (kernel) return { kind: "kernel" };
  return { kind: "none" };
}
