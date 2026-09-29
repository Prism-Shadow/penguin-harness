/**
 * Roadmaps in the company layout (pure, unit tested). The company-roadmaps plugin serves its own
 * page; what the app itself does with roadmaps is two things, both keyed off that page being
 * contributed (key `roadmaps`, an iframe page — the same contribution the org nav used to draw a
 * row for):
 *
 * - the sidebar's ROADMAPS section, below the channel list and apart from it: the most recently
 *   active roadmaps under discussion, five at rest, the rest behind an expand;
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

/** When a roadmap last moved: its latest ledger event, else when it was opened. */
export function lastActivity(r: OrgRoadmapItem): string {
  let latest = r.createdAt;
  for (const e of r.events ?? []) if (e.at > latest) latest = e.at;
  return latest;
}

/** Active: under discussion, not shelved, with a room to go to. */
export function isActiveRoadmap(r: OrgRoadmapItem): r is OrgRoadmapItem & { channelId: string } {
  return r.status === "discussing" && !r.archived && r.channelId !== null;
}

/**
 * The sidebar section's rows: the active roadmaps, most recently active first (ties: the higher
 * number first), split into the first {@link ROADMAPS_SHOWN} and the rest.
 */
export function sidebarRoadmaps(roadmaps: readonly OrgRoadmapItem[]): {
  shown: Array<OrgRoadmapItem & { channelId: string }>;
  more: Array<OrgRoadmapItem & { channelId: string }>;
} {
  const active = roadmaps
    .filter(isActiveRoadmap)
    .map((r) => ({ r, at: lastActivity(r) }))
    .sort((a, b) => (a.at === b.at ? b.r.number - a.r.number : a.at < b.at ? 1 : -1))
    .map((x) => x.r);
  return { shown: active.slice(0, ROADMAPS_SHOWN), more: active.slice(ROADMAPS_SHOWN) };
}
