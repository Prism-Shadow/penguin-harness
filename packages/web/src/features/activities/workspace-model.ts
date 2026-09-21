/**
 * The model behind the activity workspace: which sections the rail offers, what the
 * detail pane is showing, and how wide the rail is. Kept pure so the rail and the pane
 * cannot disagree about what is selected, and so the width rules are testable without
 * a pointer.
 */

/** The parts of an activity the rail navigates between. */
export type WorkspaceSection =
  "description" | "specification" | "scenes" | "speech" | "library" | "module" | "history";

export interface WorkspaceSectionEntry {
  key: WorkspaceSection;
  /** Whether the section can be opened yet, and why not when it cannot. */
  enabled: boolean;
}

export interface WorkspaceState {
  /** A saved specification exists, so scenes and media have something to describe. */
  hasSpec: boolean;
  /** A media plan exists, so the scene tree has assets to show. */
  hasPlan: boolean;
  /** An assembled module exists, so a preview can be shown. */
  hasModule: boolean;
}

/**
 * The rail in order. Sections whose subject does not exist yet stay visible but
 * disabled: hiding them would make the activity look like it has fewer parts than it
 * does, and an author would not know what is missing.
 */
export function workspaceSections(state: WorkspaceState): WorkspaceSectionEntry[] {
  return [
    { key: "description", enabled: true },
    { key: "specification", enabled: true },
    // Always reachable: the action that builds the media plan lives inside this
    // section, so gating the section would hide its own entry point. The pane says
    // what is missing instead.
    { key: "scenes", enabled: true },
    { key: "speech", enabled: state.hasSpec && state.hasPlan },
    { key: "library", enabled: true },
    { key: "module", enabled: state.hasModule },
    { key: "history", enabled: true },
  ];
}

/** The section to open, honouring a choice only while it is still available. */
export function resolveSection(
  chosen: WorkspaceSection | null,
  state: WorkspaceState,
): WorkspaceSection {
  const sections = workspaceSections(state);
  const wanted = sections.find((section) => section.key === chosen);
  if (wanted?.enabled) return wanted.key;
  return sections.find((section) => section.enabled)?.key ?? "description";
}

/** The rail's width bounds, in pixels. */
export const RAIL_MIN_WIDTH = 220;
export const RAIL_MAX_WIDTH = 520;
export const RAIL_DEFAULT_WIDTH = 300;

/** Keep a dragged or stored width inside the bounds, and reject anything unreadable. */
export function clampRailWidth(width: number): number {
  if (!Number.isFinite(width)) return RAIL_DEFAULT_WIDTH;
  return Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, Math.round(width)));
}

/**
 * The rail width a viewport can afford. A rail that leaves the editor too narrow to
 * hold the current-against-replacement comparison defeats the layout, so the rail
 * gives way on a small window rather than the editor.
 */
export function railWidthFor(stored: number, available: number): number {
  const width = clampRailWidth(stored);
  if (!Number.isFinite(available) || available <= 0) return width;
  const affordable = available - EDITOR_MIN_WIDTH;
  if (affordable < RAIL_MIN_WIDTH) return RAIL_MIN_WIDTH;
  return Math.min(width, affordable);
}

/** Below this the editor stops being able to show two previews side by side. */
export const EDITOR_MIN_WIDTH = 480;

/** The narrowest workspace that can hold the rail at its minimum and a usable editor. */
export const WORKSPACE_TWO_PANE_WIDTH = RAIL_MIN_WIDTH + EDITOR_MIN_WIDTH;

/**
 * Whether the rail can sit beside the editor at all. Below the two-pane width the rail
 * would leave the editor a sliver — on a 390-pixel phone, under 170 pixels — so the two
 * take turns instead, and the caller shows one at a time.
 *
 * An unmeasured workspace counts as wide enough, so the first paint is the two-pane
 * layout rather than a phone layout that flashes and then reflows.
 */
export function railFitsBeside(available: number): boolean {
  if (!Number.isFinite(available) || available <= 0) return true;
  return available >= WORKSPACE_TWO_PANE_WIDTH;
}

/** Whether the editor has room for the two-up comparison at this width. */
export function fitsComparison(editorWidth: number): boolean {
  return Number.isFinite(editorWidth) && editorWidth >= 640;
}

export const RAIL_WIDTH_KEY = "penguin.activityRailWidth";
export const RAIL_COLLAPSED_KEY = "penguin.activityRailCollapsed";

/** Reads the stored width; anything unreadable falls back to the default. */
export function readRailWidth(storage?: Pick<Storage, "getItem">): number {
  try {
    const raw = (storage ?? localStorage).getItem(RAIL_WIDTH_KEY);
    return raw ? clampRailWidth(Number(raw)) : RAIL_DEFAULT_WIDTH;
  } catch {
    // Private windows and blocked site data throw rather than return null.
    return RAIL_DEFAULT_WIDTH;
  }
}

/** Only an explicit "collapsed" collapses, so unreadable storage opens the rail. */
export function readRailCollapsed(storage?: Pick<Storage, "getItem">): boolean {
  try {
    return (storage ?? localStorage).getItem(RAIL_COLLAPSED_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function writeRailWidth(width: number, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? localStorage).setItem(RAIL_WIDTH_KEY, String(clampRailWidth(width)));
  } catch {
    // A remembered width is a convenience; losing it is not worth failing a drag.
  }
}

export function writeRailCollapsed(collapsed: boolean, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? localStorage).setItem(RAIL_COLLAPSED_KEY, collapsed ? "collapsed" : "open");
  } catch {
    // As above.
  }
}

/** How far an arrow key moves the divider, and how far with a modifier. */
export const RAIL_STEP = 16;
export const RAIL_STEP_LARGE = 64;

/** The width a keyboard press produces, so the divider is usable without a pointer. */
export function railWidthAfterKey(width: number, key: string, large = false): number | null {
  const step = large ? RAIL_STEP_LARGE : RAIL_STEP;
  if (key === "ArrowLeft") return clampRailWidth(width - step);
  if (key === "ArrowRight") return clampRailWidth(width + step);
  if (key === "Home") return RAIL_MIN_WIDTH;
  if (key === "End") return RAIL_MAX_WIDTH;
  return null;
}
