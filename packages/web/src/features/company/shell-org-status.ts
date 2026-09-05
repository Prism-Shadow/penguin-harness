/**
 * The shell's organization status marks (pure, unit tested): the tone the switcher's dot and
 * the overview's status pill take, and what a session-list group should render given what
 * the store holds for it — so the sidebar never shows a skeleton for a fetch that already
 * failed.
 */
import type { Tone } from "../../lib/tone";

export type OrgStatusKind = "invalid" | "paused" | "active";

/** An organization's headline state: invalid configuration outranks paused, paused outranks active. */
export function orgStatusKind(org: {
  status: "active" | "paused";
  invalid?: string;
}): OrgStatusKind {
  if (org.invalid !== undefined) return "invalid";
  return org.status === "paused" ? "paused" : "active";
}

/** The tone of that state: danger for a configuration that needs fixing, attention while paused, success while running. */
export const ORG_STATUS_TONE: Record<OrgStatusKind, Tone> = {
  invalid: "danger",
  paused: "attention",
  active: "success",
};

/**
 * What a session-list group renders. The store drops an organization from its map when its
 * sessions request fails, so "not in the map" means two different things: nothing has been
 * fetched yet (a skeleton) or the fetch failed (an error line with a retry). `settled` says a
 * fetch has completed at least once since the list mounted.
 */
export type GroupRender = "loading" | "error" | "empty" | "list";

export function groupRender(input: {
  loaded: boolean;
  settled: boolean;
  count: number;
}): GroupRender {
  if (input.loaded) return input.count === 0 ? "empty" : "list";
  return input.settled ? "error" : "loading";
}
