/**
 * The terminal panel's body (「命令行终端」): the conversation's shells as a strip of tabs — the
 * shared panel strip the browser's pages use, so the dock's pills above and these tabs never
 * read as one strip — with a "+" for another shell and a × on each, and the shown shell's screen
 * below.
 *
 * The strip lists exactly the conversation's live shells as the server reports them, on its
 * machine (dock-terminal.ts `ownTerminals`): a shell opened for it on another device shows up
 * here too, and no other conversation's ever does. The shown one is kept per conversation in the
 * dock store, falling back to the newest. An explicitly opened Session panel starts its first shell
 * if necessary. Closing the last shell leaves the tab strip available.
 *
 * The screen is the pooled xterm view (terminal-view-pool.tsx), adopted by DOM handoff and
 * claimed only while this body is on screen, so tab churn never reconnects a shell and a hidden
 * dock costs no live view.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, ConfirmModal, GlyphIcon, ICON_SIZE, PanelTabs } from "@prismshadow/penguin-ui";
import type { PanelTabItem } from "@prismshadow/penguin-ui";
import {
  S,
  NAV_ICONS,
  createShell,
  dockVersion,
  ownTerminals,
  selectTerminal,
  shownTerminalId,
  subscribeDock,
  useDockSessionId,
  useShortcutLabel,
  type DockPanelBodyProps,
} from "@prismshadow/penguin-web/internal";
import type { SessionWorkbenchScope } from "@prismshadow/penguin-web-plugin";
import { useTerminalChrome } from "./terminal-appearance";
import {
  displayTitle,
  killTerminal,
  liveTerminals,
  refreshTerminals,
  subscribeTerminals,
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
    container
      .querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
      ?.focus({ preventScroll: true });
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

export function TerminalPanel({
  active,
  scope,
}: DockPanelBodyProps & { scope?: SessionWorkbenchScope }) {
  const chrome = useTerminalChrome();
  const current = useDockSessionId();
  const sessionId = scope?.sessionId ?? current;
  useSyncExternalStore(subscribeTerminals, liveTerminals);
  useSyncExternalStore(subscribeDock, dockVersion);
  const owner = JSON.stringify([scope?.projectId, scope?.machineId, sessionId]);
  const [checkedOwner, setCheckedOwner] = useState<string | null>(null);
  const latestScope = useRef(scope);
  latestScope.current = scope;
  // A scoped page is opened explicitly beside its Session. Polls, a hidden panel and the
  // resource directory never allocate. Closing the last tab does not re-run this effect.
  useEffect(() => {
    if (!active || !sessionId) return;
    let left = false;
    const group = latestScope.current;
    setCheckedOwner(null);
    void refreshTerminals().then(async () => {
      if (left) return;
      if (ownTerminals(group).length === 0) await createShell(group, true);
      if (!left) setCheckedOwner(owner);
    });
    return () => {
      left = true;
    };
  }, [active, sessionId, owner]);
  const shells = ownTerminals(scope);
  const shown = shownTerminalId(scope);
  const closeShortcut = useShortcutLabel("terminal.close");

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
    setConfirmKill(null);
    void killTerminal(confirmKill.id);
  };

  // The terminal.close keys inside the shown shell take the ×'s path, confirmation included —
  // only for a shell this panel lists. The ref keeps one subscription per mount while the
  // handler reads the current strip.
  const closeRequest = useRef<(id: string) => void>(() => {});
  closeRequest.current = askKill;
  useEffect(
    () => (active ? subscribeTerminalCloseRequests((id) => closeRequest.current(id)) : undefined),
    [active],
  );

  return (
    <div data-testid="terminal-panel" className="flex h-full min-h-0 flex-col">
      {(items.length > 0 || (scope && checkedOwner === owner)) && (
        <PanelTabs
          tabs={items}
          active={shown}
          onSelect={(id) => selectTerminal(id, scope)}
          onClose={askKill}
          onNew={() => void createShell(scope)}
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
      )}
      {shown !== null ? (
        <TerminalScreen key={shown} id={shown} active={active} />
      ) : sessionId && checkedOwner !== owner ? (
        <span role="status" className="m-auto text-sm text-fg-muted">
          {S.terminal.status.connecting}
        </span>
      ) : scope ? null : (
        <div className={`flex min-h-0 flex-1 items-center justify-center ${chrome.surface}`}>
          <Button
            size="sm"
            data-testid="terminal-new-tab"
            disabled={sessionId === null}
            onClick={() => void createShell(scope)}
          >
            {S.terminal.newShell}
          </Button>
        </div>
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
