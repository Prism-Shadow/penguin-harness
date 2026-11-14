/**
 * The docks' live terminal views, pooled OUTSIDE the dock components.
 *
 * Each shown terminal renders one TerminalView through a portal into a per-terminal
 * container div that this module owns and never destroys while the terminal is shown.
 * The terminal panel's body adopts the container with a plain appendChild. Because both the
 * React element (keyed by terminal id) and the DOM subtree survive any dock change,
 * moving the terminal panel between docks — or moving a whole dock to the other edge — never
 * remounts xterm and never drops the WebSocket; the dock chrome around it is all that
 * re-renders.
 *
 * Which terminals have a view is the bodies' to say: a body showing a shell claims its view
 * (claimTerminalView) while it is on screen and releases it when it is not, so the pool needs to
 * know nothing about docks, tabs or conversations.
 *
 * The pool also owns the per-terminal view state (status/info) consumers display.
 */
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { TerminalView, probeJson, type TerminalInfo, type TerminalStatus } from "./terminal-view";
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

/**
 * Listeners for a shown terminal asking to be closed (the terminal.close shortcut inside it,
 * ⌃⌥` / Ctrl+Alt+` by default). A view knows only its own id, while the terminal panel owns
 * the close path — the confirm-then-kill its tab's × runs — so the request is relayed by id to
 * the panel listing that shell.
 */
const closeRequestListeners = new Set<(id: string) => void>();

export function subscribeTerminalCloseRequests(listener: (id: string) => void): () => void {
  closeRequestListeners.add(listener);
  return () => closeRequestListeners.delete(listener);
}

function requestTerminalClose(id: string): void {
  for (const listener of [...closeRequestListeners]) listener(id);
}

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
    const info = await probeJson<TerminalInfo>(`/api/terminals/${encodeURIComponent(id)}`);
    if (!info) throw new Error("Terminal no longer exists.");
    return info;
  };
}

/**
 * The terminals that should have a live view right now, each claimed by the body showing it:
 * a shell behind another tab has no view — switching to it reattaches (server-side restore) —
 * and hiding its dock releases the view the same way. A count per id, so a body handing over to
 * another in the same commit (the dock moving) keeps the view alive in between.
 */
const claims = new Map<string, number>();
const claimListeners = new Set<() => void>();
let claimedSnapshot: string[] = [];

function publishClaims(): void {
  claimedSnapshot = [...claims.keys()];
  for (const listener of [...claimListeners]) listener();
}

/** A body shows terminal `id`; the returned function releases the claim. */
export function claimTerminalView(id: string): () => void {
  claims.set(id, (claims.get(id) ?? 0) + 1);
  if (claims.get(id) === 1) publishClaims();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (claims.get(id) ?? 1) - 1;
    if (left > 0) claims.set(id, left);
    else {
      claims.delete(id);
      publishClaims();
    }
  };
}

function subscribeClaims(listener: () => void): () => void {
  claimListeners.add(listener);
  return () => claimListeners.delete(listener);
}

function claimedIds(): string[] {
  return claimedSnapshot;
}

export function TerminalDockRuntime() {
  const ids = useSyncExternalStore(subscribeClaims, claimedIds);

  // (The terminal toggle is a module-scope command handler in dock-terminal.ts — binding it
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
            onCloseRequest={() => requestTerminalClose(id)}
            className="min-h-0 flex-1 overflow-hidden"
          />,
          terminalViewContainer(id),
          id,
        ),
      )}
    </>
  );
}
