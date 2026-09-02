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
 * gate reads the update flow, whose mode is the session's — a browser signed into a
 * desktop-mode server can update neither the server nor that machine's app, and its flow
 * never offers anything, so no dot leads it to a modal with nothing to do.
 *
 * Pure decisions only (vitest runs node-only here, so nothing renders) — `use-update-badges.ts`
 * wires them to the live stores and turns a note into localized copy.
 */
import type { UpdateFlow } from "./update-flow";

/** A software update the user can act on: a release offered (download it), or one downloaded / installed (restart into it). */
export type SoftwareUpdate =
  | { kind: "available"; version: string }
  /** `version` is null when the backend did not name one. */
  | { kind: "ready"; version: string | null };

/**
 * The one software gate behind every dot on that trail, read off the update flow. A download
 * in flight is deliberately not one: the row shows its progress, but there is nothing for the
 * user to do until it lands, and a badge that cannot be cleared by acting on it is noise. The
 * mode gate is the flow's own: where this session can update nothing, the flow never leaves
 * `unknown`.
 */
export function softwareUpdate(flow: UpdateFlow): SoftwareUpdate | null {
  if (flow.kind === "available") return { kind: "available", version: flow.version };
  if (flow.kind === "ready") return { kind: "ready", version: flow.version };
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
