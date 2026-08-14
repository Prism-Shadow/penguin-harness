/**
 * The dock's live terminal views, pooled OUTSIDE the pane components.
 *
 * Each shown terminal renders one TerminalView through a portal into a per-terminal
 * container div that this module owns and never destroys while the terminal is shown.
 * Panes adopt the container into their body with a plain appendChild. Because both the
 * React element (keyed by terminal id) and the DOM subtree survive any pane change,
 * moving a terminal between panes — or moving a whole pane to another edge — never
 * remounts xterm and never drops the WebSocket; the pane chrome around it is all that
 * re-renders.
 *
 * The pool also owns the per-terminal view state (status/info) the pane headers display,
 * and the global Ctrl+` hotkey (mounted exactly once, dock visible or not).
 */
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { TerminalView, fetchJson, type TerminalInfo, type TerminalStatus } from "./terminal-view";
import {
  isTerminalDockOpen,
  openPanes,
  paneCurrent,
  subscribeTerminalDock,
  toggleTerminalDock,
} from "./terminal-dock-state";
import { noteTerminalTitle, refreshTerminals } from "./terminal-list";

export interface TerminalViewState {
  status: TerminalStatus;
  info: TerminalInfo | null;
}

const containers = new Map<string, HTMLDivElement>();
const viewStates = new Map<string, TerminalViewState>();
const stateListeners = new Set<() => void>();

function notifyViewStates(): void {
  for (const listener of [...stateListeners]) listener();
}

export function subscribeTerminalViewStates(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

const IDLE_STATE: TerminalViewState = { status: "connecting", info: null };

export function terminalViewState(id: string | null): TerminalViewState {
  return (id !== null ? viewStates.get(id) : undefined) ?? IDLE_STATE;
}

/** The stable DOM node a pane adopts to display a terminal. */
export function terminalViewContainer(id: string): HTMLDivElement {
  let container = containers.get(id);
  if (!container) {
    container = document.createElement("div");
    container.className = "flex h-full w-full min-h-0 flex-col";
    containers.set(id, container);
  }
  return container;
}

function setViewState(id: string, patch: Partial<TerminalViewState>): void {
  const current = viewStates.get(id) ?? { ...IDLE_STATE };
  viewStates.set(id, { ...current, ...patch });
  notifyViewStates();
}

/** Attach-only ensure: pane logic creates terminals; the pool only ever attaches by id. */
function attachById(id: string) {
  return async (): Promise<TerminalInfo> => {
    const info = await fetchJson<TerminalInfo>(`/api/terminals/${encodeURIComponent(id)}`);
    if (!info) throw new Error("Terminal no longer exists.");
    return info;
  };
}

/** The set of terminal ids that should have a live view right now. */
function shownIds(): string[] {
  if (!isTerminalDockOpen()) return [];
  const ids: string[] = [];
  for (const pane of openPanes()) {
    const id = paneCurrent(pane);
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Stable snapshot for useSyncExternalStore. */
let shownSnapshot: string[] = [];
function shownIdsSnapshot(): string[] {
  const next = shownIds();
  if (next.length !== shownSnapshot.length || next.some((id, i) => id !== shownSnapshot[i])) {
    shownSnapshot = next;
  }
  return shownSnapshot;
}

export function TerminalDockRuntime() {
  const ids = useSyncExternalStore(subscribeTerminalDock, shownIdsSnapshot);

  // (The Ctrl+` hotkey is a module-scope listener in terminal-dock-state.ts — binding it
  // in an effect here left a post-paint window where the shortcut was dead.)

  // Containers and view state of terminals that are no longer shown can go; a re-shown
  // terminal reattaches cleanly (server-side restore) with a fresh container.
  useEffect(() => {
    for (const id of [...containers.keys()]) {
      if (!ids.includes(id)) {
        containers.get(id)?.remove();
        containers.delete(id);
        viewStates.delete(id);
      }
    }
    notifyViewStates();
  }, [ids]);

  return (
    <>
      {ids.map((id) =>
        createPortal(
          <TerminalView
            key={id}
            ensure={attachById(id)}
            onStatus={(status) => {
              setViewState(id, { status });
              if (status === "exited") void refreshTerminals();
            }}
            onInfo={(info) => {
              setViewState(id, { info });
              void refreshTerminals();
            }}
            onTitle={(title) => noteTerminalTitle(id, title)}
            className="min-h-0 flex-1 overflow-hidden"
          />,
          terminalViewContainer(id),
          id,
        ),
      )}
    </>
  );
}
