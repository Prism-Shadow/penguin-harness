/**
 * The terminal panel's body (「命令行终端」): the conversation's shells as a strip of tabs — the
 * shared panel strip the browser's pages use, so the dock's pills above and these tabs never
 * read as one strip — with a "+" for another shell and a × on each, and the shown shell's screen
 * below.
 *
 * The strip lists exactly the conversation's live shells as the server reports them, on its
 * machine (dock-terminal.ts `ownTerminals`): a shell opened for it on another device shows up
 * here too, and no other conversation's ever does. The shown one is kept per conversation in the
 * dock store, falling back to the newest. The panel is never empty: brought on screen with no
 * shell it starts one. A tab's × ends its shell after a confirm (the terminal.close keys inside
 * the shell take the same path); when the last shell ends — closed with ×, or exiting by itself —
 * the panel closes with it, and Ctrl+` opens it again with a fresh shell. A first shell that fails
 * to start closes it too: the toast says why, and the next open tries again.
 *
 * The screen is the pooled xterm view (terminal-view-pool.tsx), adopted by DOM handoff and
 * claimed only while this body is on screen, so tab churn never reconnects a shell and a hidden
 * dock costs no live view.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ConfirmModal, GlyphIcon, ICON_SIZE, PanelTabs } from "@prismshadow/penguin-ui";
import type { PanelTabItem } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { NAV_ICONS } from "../../lib/nav-icons";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { dockVersion, setShownShell, subscribeDock } from "../dock/dock-state";
import {
  createShell,
  ensureShell,
  ownTerminals,
  shownTerminalId,
  useDockSessionId,
} from "../dock/dock-terminal";
import { useDockPanel } from "../dock/panel-context";
import type { DockPanelBodyProps } from "../dock/panel-registry";
import { useTerminalChrome } from "./terminal-appearance";
import {
  displayTitle,
  killTerminal,
  liveTerminals,
  subscribeTerminals,
  terminalListComplete,
} from "./terminal-list";
import type { TerminalInfo } from "./terminal-view";
import {
  claimTerminalView,
  subscribeTerminalCloseRequests,
  subscribeTerminalViewStates,
  terminalViewContainer,
  terminalViewState,
} from "./terminal-view-pool";

/** A shell's tab label: its stable number and live title, like a tmux status line. */
function shellLabel(info: TerminalInfo, ordinal: number): string {
  return `${info.seq ?? ordinal}: ${displayTitle(info.title) || info.name}`;
}

/**
 * The shown shell's screen: adopts the pooled container while on screen. A hidden dock is not on
 * screen either: the claim goes with it and the pool disposes the view, building a fresh
 * container on the way back (the shell keeps running server-side and its screen is restored on
 * reattach; xterm refits once the container has real size again).
 */
function TerminalScreen({ id, active }: { id: string; active: boolean }) {
  const chrome = useTerminalChrome();
  // Machine-readable connection state on the body root, for tests and tooling — the screen
  // itself is the visible status.
  const viewState = useSyncExternalStore(subscribeTerminalViewStates, () =>
    terminalViewState(active ? id : null),
  );
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !active) return;
    const release = claimTerminalView(id);
    const container = terminalViewContainer(id);
    body.appendChild(container);
    return () => {
      if (container.parentElement === body) body.removeChild(container);
      release();
    };
  }, [id, active]);
  return (
    <div
      ref={bodyRef}
      data-testid="dock-terminal-body"
      data-terminal-id={id}
      data-status={viewState.status}
      className={`flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1 ${chrome.surface}`}
    />
  );
}

export function TerminalPanel({ active }: DockPanelBodyProps) {
  const handle = useDockPanel();
  const chrome = useTerminalChrome();
  const sessionId = useDockSessionId();
  useSyncExternalStore(subscribeTerminals, liveTerminals);
  useSyncExternalStore(subscribeDock, dockVersion);
  const shells = ownTerminals();
  const shown = shownTerminalId();
  const closeShortcut = useShortcutLabel("terminal.close");

  // Two ways to have no shell, two answers. The conversation's shells all ended while the panel
  // listed them — the last exited by itself, or was ended elsewhere — and the panel closes with
  // them, once a complete list says so (a machine missing one round is not their end). Brought
  // on screen with none yet, it starts one. Which way is per conversation: the body outlives a
  // switch to another one, whose shells it has not listed yet.
  const listedFor = useRef<string | null>(null);
  const closing = useRef(false);
  /** Closes the panel's tab, once; what it listed is forgotten with it. */
  const closePanel = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    listedFor.current = null;
    handle.close();
  }, [handle]);
  // The body can outlive its own close (its dock animating away) and be shown again: coming back
  // on screen is a fresh start.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) closing.current = false;
    wasActive.current = active;
  }, [active]);
  const empty = shells.length === 0;
  const listComplete = useSyncExternalStore(subscribeTerminals, terminalListComplete);
  useEffect(() => {
    if (sessionId === null || closing.current) return;
    if (!empty) {
      listedFor.current = sessionId;
      return;
    }
    if (listedFor.current === sessionId) {
      if (listComplete) closePanel();
      return;
    }
    if (!active) return;
    void ensureShell().then((started) => {
      if (!started) closePanel();
    });
  }, [active, empty, sessionId, listComplete, closePanel]);

  // A shell's × ends the shell itself (server-side) — an easy mis-click beside its tab, so it
  // confirms first.
  const [confirmKill, setConfirmKill] = useState<{ id: string; label: string } | null>(null);
  const items: PanelTabItem[] = shells.map((info, index) => ({
    key: info.id,
    label: shellLabel(info, index + 1),
    icon: (
      <span aria-hidden className="shrink-0 text-fg-subtle">
        <GlyphIcon d={NAV_ICONS.terminal} size={ICON_SIZE.inlineGlyph} />
      </span>
    ),
    title: `${info.name} — ${info.cwd}`,
    titleExtra: true,
  }));
  const askKill = (id: string): void => {
    const item = items.find((candidate) => candidate.key === id);
    if (item !== undefined) setConfirmKill({ id, label: item.label });
  };
  const killConfirmed = (): void => {
    if (confirmKill === null) return;
    const last = shells.length === 1 && shells[0]!.id === confirmKill.id;
    setConfirmKill(null);
    if (last) closePanel();
    void killTerminal(confirmKill.id);
  };

  // The terminal.close keys inside the shown shell take the ×'s path, confirmation included —
  // only for a shell this panel lists. The ref keeps one subscription per mount while the
  // handler reads the current strip.
  const closeRequest = useRef<(id: string) => void>(() => {});
  closeRequest.current = askKill;
  useEffect(() => subscribeTerminalCloseRequests((id) => closeRequest.current(id)), []);

  return (
    <div data-testid="terminal-panel" className="flex h-full min-h-0 flex-col">
      <PanelTabs
        tabs={items}
        active={shown}
        onSelect={(id) => setShownShell(id)}
        onClose={askKill}
        onNew={() => void createShell()}
        listLabel={S.terminal.tabsLabel}
        newLabel={S.terminal.newShell}
        closeLabel={S.terminal.killShell}
        closeHint={
          closeShortcut !== null
            ? `${S.terminal.killShell} (${closeShortcut})`
            : S.terminal.killShell
        }
        testIdPrefix="terminal"
      />
      {shown !== null ? (
        <TerminalScreen key={shown} id={shown} active={active} />
      ) : (
        <div className={`min-h-0 flex-1 ${chrome.surface}`} />
      )}
      <ConfirmModal
        open={confirmKill !== null}
        title={S.dock.killConfirmTitle}
        onClose={() => setConfirmKill(null)}
        onConfirm={killConfirmed}
        confirmLabel={S.terminal.killShell}
        cancelLabel={S.common.cancel}
      >
        {confirmKill !== null && (
          <p className="break-words text-sm text-gray-600 dark:text-gray-300">
            {S.dock.killConfirmBody(confirmKill.label)}
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
