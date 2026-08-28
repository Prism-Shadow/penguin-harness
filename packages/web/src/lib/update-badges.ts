/**
 * What raises an update notification badge, and what the anchor carrying it says.
 *
 * One gate lives here: the *software* update, actionable in the sidebar user menu. The other
 * four trails are all dismissible and live in `todo-badges.ts` — the Agent kernel one moved
 * there when its page grew a notice with a way down, since a gate that can be waved away has to
 * produce a signature and not just a boolean. The outermost chrome (the mobile menu button)
 * shows one dot for any of the five; `badgeNote` at the bottom is what every anchor covering
 * more than one of them speaks through.
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
import type { DesktopUpdateStatus, UpdateCheckResponse } from "@prismshadow/penguin-server/api";
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
 * One thing a dot can stand for. The first is the self-clearing trail above; the rest are the
 * dismissible ones in `todo-badges.ts`. Three of those carry a count because the anchors that
 * name them have room to say how many; `kernel` does not, because the Agents nav entry says
 * "kernel update available" without a number and always has.
 */
export type BadgeSource =
  | SoftwareUpdate
  | { kind: "kernel" }
  | { kind: "skills"; count: number }
  | { kind: "models"; count: number }
  | { kind: "errors"; count: number };

/**
 * What an anchor says. A single source speaks for itself; several make it `mixed`, because an
 * anchor leading to all of them must not claim to be one — naming one of five would point the
 * user down the wrong trail.
 *
 * `updatesOnly` splits the two combined wordings apart. Four of the five sources ARE updates
 * and can be summed up as "something can be updated"; unexpected errors are not an update by
 * any reading, so a mix containing them needs the wider "something is waiting for you".
 */
export type UpdateBadgeNote =
  { kind: "none" } | BadgeSource | { kind: "mixed"; updatesOnly: boolean };

/** Classifies what one anchor over `sources` should say (see {@link UpdateBadgeNote}). */
export function badgeNote(sources: readonly BadgeSource[]): UpdateBadgeNote {
  if (sources.length === 0) return { kind: "none" };
  if (sources.length === 1) return sources[0]!;
  return { kind: "mixed", updatesOnly: sources.every((s) => s.kind !== "errors") };
}
