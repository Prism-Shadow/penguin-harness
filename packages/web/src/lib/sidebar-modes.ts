import type { ComponentType } from "react";
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import type { ModeState, NavBadge, SidebarMode, SidebarSection } from "./sidebar-contributions";
import {
  DEFAULT_MODE,
  type NavBadgeData,
  type SidebarModeData,
  type SidebarSectionData,
} from "./sidebar-slot-data";

export interface SectionEntry extends SidebarSectionData {
  id: string;
  section: SidebarSection;
}

export interface ModeEntry extends SidebarModeData {
  id: string;
  mode: SidebarMode;
}

export interface BadgeEntry extends NavBadgeData {
  id: string;
  badge: NavBadge;
}

/** A slot's contributions with their code, by `order`. */
function byOrder<D extends { order: number }, C, E>(
  contributions: readonly Contributed[],
  entry: (data: D, id: string, code: C) => E,
): E[] {
  return contributions
    .map((c) => ({ data: c.data as unknown as D, id: c.id, code: c.code as C }))
    .sort((a, b) => a.data.order - b.data.order)
    .map((c) => entry(c.data, c.id, c.code));
}

export const sectionsOf = (contributions: readonly Contributed[]): readonly SectionEntry[] =>
  byOrder<SidebarSectionData, SidebarSection, SectionEntry>(contributions, (d, id, section) => ({
    ...d,
    id,
    section,
  }));

export const modesOf = (contributions: readonly Contributed[]): readonly ModeEntry[] =>
  byOrder<SidebarModeData, SidebarMode, ModeEntry>(contributions, (d, id, mode) => ({
    ...d,
    id,
    mode,
  }));

export const badgesOf = (contributions: readonly Contributed[]): readonly BadgeEntry[] =>
  byOrder<NavBadgeData, NavBadge, BadgeEntry>(contributions, (d, id, badge) => ({
    ...d,
    id,
    badge,
  }));

/** The sections of one mode at one place, in order. */
export function sectionsIn(
  sections: readonly SectionEntry[],
  mode: string,
  place: SidebarSectionData["place"],
): readonly SectionEntry[] {
  return sections.filter((s) => s.mode === mode && s.place === place);
}

/** The index of the current contributed mode — the first available one that says it is current — or -1 for the default. */
export function currentModeIndex(states: readonly ModeState[]): number {
  return states.findIndex((s) => s.available && s.current);
}

/** The key of the mode the frame stands in. */
export function currentModeKey(modes: readonly ModeEntry[], states: readonly ModeState[]): string {
  const at = currentModeIndex(states);
  return at < 0 ? DEFAULT_MODE : modes[at]!.key;
}

/** The marks contributed to one anchor, in order. */
export function marksFor(
  badges: readonly BadgeEntry[],
  anchor: string,
): ReadonlyArray<{ id: string; Mark: ComponentType }> {
  return badges.flatMap((b) =>
    b.anchor === anchor && b.badge.Mark !== undefined ? [{ id: b.id, Mark: b.badge.Mark }] : [],
  );
}

/** One hook over every mode's `useMode` (see the header for why the loop is sound). */
export function composeModes(modes: readonly ModeEntry[]): () => readonly ModeState[] {
  return () => modes.map((m) => m.mode.useMode());
}

/** One hook over every badge's `useNote`: the note on each anchor (the first contribution's, in order). */
export function composeNotes(badges: readonly BadgeEntry[]): () => ReadonlyMap<string, string> {
  const noting = badges.filter((b) => b.badge.useNote !== undefined);
  return () => {
    const notes = new Map<string, string>();
    for (const b of noting) {
      const note = b.badge.useNote!();
      if (note !== null && !notes.has(b.anchor)) notes.set(b.anchor, note);
    }
    return notes;
  };
}
