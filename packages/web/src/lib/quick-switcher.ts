/**
 * The Quick Switcher's pure decisions, unit-testable without React or the network: the
 * entry shape the palette renders, the builders each data source feeds, and the
 * query filter with its ranking. The component (components/layout/quick-switcher.tsx)
 * owns the strings, glyphs and portal; this module owns what matches and in what order.
 *
 * Ranking mirrors the original port (open-design's QuickSwitcher): an exact title match
 * beats a prefix beat a substring, a hit in the secondary text sits under that, and a
 * fuzzy subsequence — every query character in order, gaps allowed — is the last rank
 * that matches at all. Case-insensitive throughout; ties keep the caller's order
 * (Array#sort is stable), so each section keeps its manifest/list order.
 */

export type SwitcherEntrySection = "pages" | "agents" | "activities";

/** One palette row as data. Rendering (labels, glyphs, status marks) lives in the component. */
export interface SwitcherEntry {
  /**
   * Stable identity, persisted in the recents list (`page:<key>`, `agent:<id>`,
   * `activity:<id>`, `session:<id>`); ids of vanished pages/agents/activities/sessions
   * simply stop matching.
   */
  id: string;
  /** The section the entry groups under — fixed order in the palette. */
  section: SwitcherEntrySection;
  /** Primary label; what the ranking's top ranks score against. */
  title: string;
  /** Secondary line — an agent's command, a session's agent — scored under the title; null when the row has none. */
  detail: string | null;
  /** Router target navigated to on select. */
  to: string;
  /** Route state handed to navigate(); a coding-agent session preselects itself on its page. */
  routeState: Readonly<Record<string, string>> | null;
  /**
   * Coding-agent sessions only: live status rendered as a tone dot + busy/idle text.
   * Null on rows with no live state (pages, agents).
   */
  busy: boolean | null;
}

/** The filtered list, grouped for rendering in the palette's fixed section order. */
export interface SwitcherSectionMatches {
  section: SwitcherEntrySection | "recents";
  entries: SwitcherEntry[];
}

/** Fixed section order of the palette; `recents` is prepended only by the empty-query path. */
export const SWITCHER_SECTIONS: readonly SwitcherEntrySection[] = ["pages", "agents", "activities"];

/** Main-nav pages, in nav order (lib/nav-group-collapse.ts already applies released + admin visibility). */
export function buildPageEntries(
  pages: ReadonlyArray<{ key: string; title: string }>,
): SwitcherEntry[] {
  return pages.map((page) => ({
    id: `page:${page.key}`,
    section: "pages",
    title: page.title,
    detail: null,
    to: `/${page.key}`,
    routeState: null,
    busy: null,
  }));
}

/** Configured coding agents, opening where they are configured (Models, Local CLI); the command line is the row's secondary text. */
export function buildAgentEntries(
  agents: ReadonlyArray<{ id: string; title: string; command: string }>,
): SwitcherEntry[] {
  return agents.map((agent) => ({
    id: `agent:${agent.id}`,
    section: "agents",
    title: agent.title,
    detail: agent.command,
    to: "/models?view=local",
    routeState: null,
    busy: null,
  }));
}

/** This project's activities, detail is the ref address (product code / ref number). */
export function buildActivityEntries(
  items: ReadonlyArray<{ id: string; title: string; productCode: string; refNum: number }>,
): SwitcherEntry[] {
  return items.map((item) => ({
    id: `activity:${item.id}`,
    section: "activities",
    title: item.title,
    detail: `${item.productCode} / ${item.refNum}`,
    to: `/activities/${encodeURIComponent(item.id)}`,
    routeState: null,
    busy: null,
  }));
}

/** Rank of one entry against a query: higher wins, 0 = no match. Case-insensitive on both sides. */
export function switcherMatchScore(title: string, detail: string | null, query: string): number {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const t = title.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  if (t.includes(q)) return 250;
  if (detail !== null && detail.toLowerCase().includes(q)) return 150;
  if (isSubsequence(q, t)) return 100;
  return 0;
}

/** Every character of `query` appears in `text` in order (gaps allowed) — the fuzzy last rank. */
export function isSubsequence(query: string, text: string): boolean {
  let at = 0;
  for (const ch of query) {
    at = text.indexOf(ch, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/** Cursor advance with wrap-around, pure so the boundary behavior is unit-testable (open-design convention). */
export function nextSwitcherCursor(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return 0;
  if (direction === 1) return (current + 1) % total;
  return (current - 1 + total) % total;
}

/** How many recents the empty query surfaces (the stored list is capped at the same number). */
export const SWITCHER_RECENTS_SHOWN = 5;

/**
 * The palette's groups for `query`.
 *
 * Empty query: recent selections first (stored ids resolved against today's entries, in
 * recents order — stale ids and duplicates ignored, capped), then every entry under its
 * section. A query: each section keeps its matches, best rank first, and empties drop
 * out — sections always stay grouped, so a page prefix match never scatters the list.
 */
export function filterSwitcherEntries(
  query: string,
  entries: readonly SwitcherEntry[],
  recents: readonly string[] = [],
): SwitcherSectionMatches[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    const byId = new Map(entries.map((e) => [e.id, e]));
    const recentSet = new Set<string>();
    const recentEntries: SwitcherEntry[] = [];
    for (const id of recents) {
      const hit = byId.get(id);
      if (hit === undefined || recentSet.has(id)) continue;
      recentEntries.push(hit);
      recentSet.add(id);
      if (recentEntries.length >= SWITCHER_RECENTS_SHOWN) break;
    }
    const groups: SwitcherSectionMatches[] = [];
    if (recentEntries.length > 0) groups.push({ section: "recents", entries: recentEntries });
    for (const section of SWITCHER_SECTIONS) {
      const rest = entries.filter((e) => e.section === section && !recentSet.has(e.id));
      if (rest.length > 0) groups.push({ section, entries: rest });
    }
    return groups;
  }
  const groups: SwitcherSectionMatches[] = [];
  for (const section of SWITCHER_SECTIONS) {
    const matched = entries
      .filter((e) => e.section === section)
      .map((e) => ({ e, score: switcherMatchScore(e.title, e.detail, q) }))
      .filter((m) => m.score > 0)
      // Stable sort: equal ranks keep the section's own order.
      .sort((a, b) => b.score - a.score)
      .map((m) => m.e);
    if (matched.length > 0) groups.push({ section, entries: matched });
  }
  return groups;
}
