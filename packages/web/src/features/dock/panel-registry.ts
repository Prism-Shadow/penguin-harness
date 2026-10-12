/**
 * The registry of dock panel kinds: one self-describing definition per kind — its id, how it is
 * named and drawn, where it sorts, whether it is offered here, and the component that renders its
 * tab's body — read by every surface that lists, names or renders panels: the dock's tab strip,
 * its "+" menu and its picker, the floating launcher's fan, and the toolbar's panel buttons.
 *
 * Why a registry rather than a list of kinds: the dock is meant to take panels from plugins, and
 * a plugin's panel must be able to arrive without the dock knowing it by name. Everything the
 * dock used to do per kind through switches — a label here, a glyph there, a body in the chat
 * page — is a field of the definition now, and the built-ins register through the same door the
 * plugins will use (features/chat/builtin-dock-panels.tsx). Loading plugins is not here; this is
 * the seam they will plug into.
 *
 * An id doubles as the tab's stored key, so a stored tab whose definition is not registered (a
 * plugin's panel before the plugin loads, or after it was removed) still has a name and a mark
 * through `panelLabel` / `panelGlyphPath` — the id itself and the puzzle piece. The dock keeps
 * such a tab and shows a placeholder body until the definition arrives.
 *
 * `offered` is a live question — the built-in browser is offered only in the desktop app's own
 * window, which the shell answers a moment after startup — so a definition brings its own change
 * feed and the registry folds every feed into the one subscription. A feed is followed from the
 * moment of registration, not from the first subscriber: the built-ins register at module load,
 * before any component is mounted to listen, and their later `offered` flips must still reach it.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import { ICONS } from "@prismshadow/penguin-ui";

/** A panel kind's id, also its tab's stored key. Built-ins keep their existing ids. */
export type PanelId = string;

export interface DockPanelBodyProps {
  /** The tab is the shown one AND its dock is open (bodies gate polling / reloads on it). */
  active: boolean;
}

export interface DockPanelDefinition {
  id: PanelId;
  /** Display name, read at call time (the locale binding `S` is live). */
  label: () => string;
  /** Icon path (ICONS / NAV_ICONS) — drawn with GlyphIcon by every surface. */
  glyph: string;
  /** Sort key for the add menu, the picker's tail and the launcher fan. Built-ins: 10, 20, … */
  order: number;
  /** Whether surfaces offer it here (the built-in browser: desktop shell only). Default: always. */
  offered?: () => boolean;
  /** Change feed for `offered`. */
  subscribeOffered?: (listener: () => void) => () => void;
  /** The tab's body. */
  Body: ComponentType<DockPanelBodyProps>;
}

interface Entry {
  definition: DockPanelDefinition;
  /** Stops following the definition's `offered` feed; null when it has none. */
  stopOffered: (() => void) | null;
}

const entries = new Map<PanelId, Entry>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/**
 * Registers (or replaces, same id) a panel kind; returns the unregister function. Replacing a
 * definition swaps the `Body` component under any open tab of that id, which remounts that body
 * (React sees a new component type) — a plugin reloading its panel starts it afresh.
 */
export function registerDockPanel(definition: DockPanelDefinition): () => void {
  entries.get(definition.id)?.stopOffered?.();
  const entry: Entry = {
    definition,
    stopOffered: definition.subscribeOffered?.(notify) ?? null,
  };
  entries.set(definition.id, entry);
  notify();
  return () => {
    // The id may have been registered again meanwhile; a stale unregister must not take the
    // newer definition down with it.
    if (entries.get(definition.id) !== entry) return;
    entry.stopOffered?.();
    entries.delete(definition.id);
    notify();
  };
}

export function dockPanelDefinition(id: PanelId): DockPanelDefinition | undefined {
  return entries.get(id)?.definition;
}

/** Registered and offered panels, by `order` then id. */
export function dockPanels(): DockPanelDefinition[] {
  return [...entries.values()]
    .map((entry) => entry.definition)
    .filter((definition) => definition.offered?.() ?? true)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Fires on registration changes AND on any definition's `offered` change. */
export function subscribeDockPanels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Monotonic change counter — the useSyncExternalStore snapshot. */
export function dockPanelsVersion(): number {
  return version;
}

/** Hook form: re-renders on registration and on `offered` changes. */
export function useDockPanels(): DockPanelDefinition[] {
  const current = useSyncExternalStore(subscribeDockPanels, dockPanelsVersion);
  // Rebuilt only when the registry changed: the list is read on every render of every dock
  // surface, and a fresh array each time would defeat the memoised props downstream.
  return useMemo(() => dockPanels(), [current]);
}

/**
 * A tab label for an id that may not be registered (yet): the definition's name, or the id
 * itself — a plugin's tab stored before the plugin loads still needs a strip label.
 */
export function panelLabel(id: PanelId): string {
  return entries.get(id)?.definition.label() ?? id;
}

/** The mark for an id that may not be registered (yet): its glyph, or the puzzle piece. */
export function panelGlyphPath(id: PanelId): string {
  return entries.get(id)?.definition.glyph ?? ICONS.puzzle;
}
