/**
 * Roadmaps in the company layout (pure, unit tested). The company-roadmaps plugin serves its own
 * page; what the app itself does with roadmaps is two things, both keyed off that page being
 * contributed (key `roadmaps`, an iframe page — the same contribution the org nav used to draw a
 * row for):
 *
 * - the sidebar's ROADMAPS section, below the channel list and apart from it: the most recently
 *   active roadmaps with a room, five at rest, the rest folded under "More (n)";
 * - a roadmap's room is its channel, shown by the app's own channel page, and that page puts the
 *   roadmap's detail (the plugin's page, in its detail view) in a column beside the stream.
 */
import type { OrgRoadmapItem } from "../../api/endpoints";

/** The contributed page's key the app knows as the roadmaps page. */
export const ROADMAPS_PAGE_KEY = "roadmaps";

/** How many roadmaps the sidebar section shows before its expand. */
export const ROADMAPS_SHOWN = 5;

/** The roadmaps page's iframe src when it is contributed; null when the plugin is not there. */
export function roadmapsPageSrc(
  pages: ReadonlyArray<{
    key: string;
    nav: string;
    renderer: { builtin: string } | { iframe: { src: string } };
  }>,
): string | null {
  for (const page of pages) {
    if (page.key !== ROADMAPS_PAGE_KEY || page.nav !== "org") continue;
    if ("iframe" in page.renderer) return page.renderer.iframe.src;
  }
  return null;
}

/** The plugin page in its detail view of roadmap `number` (what the channel page's side column shows). */
export function roadmapDetailSrc(src: string, number: number): string {
  return `${src}${src.includes("?") ? "&" : "?"}view=detail&n=${number}`;
}

/**
 * When a roadmap last moved: the latest of when it was opened, its ledger events and the last
 * message in its room (`roomAt`, when known) — a reply in the room is activity too.
 */
export function lastActivity(r: OrgRoadmapItem, roomAt?: string | null): string {
  let latest = r.createdAt;
  for (const e of r.events ?? []) if (e.at > latest) latest = e.at;
  if (roomAt != null && roomAt > latest) latest = roomAt;
  return latest;
}

/**
 * Listed in the sidebar: a roadmap with a room to go to that is not shelved — under discussion
 * or established alike, since an established roadmap's room is still where it is talked about.
 */
export function isListedRoadmap(r: OrgRoadmapItem): r is OrgRoadmapItem & { channelId: string } {
  return !r.archived && r.channelId !== null;
}

/**
 * The sidebar section's rows: the listed roadmaps, most recently active first (ties: the higher
 * number first), split into the first {@link ROADMAPS_SHOWN} and the rest. `roomActivity` maps a
 * room's channel id to its last message's time.
 */
export function sidebarRoadmaps(
  roadmaps: readonly OrgRoadmapItem[],
  roomActivity: Readonly<Record<string, string>> = {},
): {
  shown: Array<OrgRoadmapItem & { channelId: string }>;
  more: Array<OrgRoadmapItem & { channelId: string }>;
} {
  const active = roadmaps
    .filter(isListedRoadmap)
    .map((r) => ({ r, at: lastActivity(r, roomActivity[r.channelId]) }))
    .sort((a, b) => (a.at === b.at ? b.r.number - a.r.number : a.at < b.at ? 1 : -1))
    .map((x) => x.r);
  return { shown: active.slice(0, ROADMAPS_SHOWN), more: active.slice(ROADMAPS_SHOWN) };
}
