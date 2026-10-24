/**
 * Workbench tabs beside Chat, and the page a workbench tab shows.
 *
 * The strip lists the Agent's workbenches that ship a UI (lib/workbench-tabs.ts); the frame
 * is that UI in an iframe served from the workbench's own `ui/` folder, plus a thin bar
 * with the workbench's version, its load error when the current files do not boot, a
 * reload, and a history fold with one restore button per recorded version. The list
 * refetches when the server announces `workbench_updated` for this Agent, so an Agent
 * editing its own workbench sees the tab update (the iframe keys on `uiRev`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { WorkbenchInfo, WorkbenchVersion } from "@prismshadow/penguin-server/api";
import { Button, ConfirmModal, NoticeStrip } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { formatDateTime } from "../../lib/format";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  forwardFrameKeys,
  PAGE_FRAME_SANDBOX,
  readDocumentTheme,
  themeWorkbenchFrame,
} from "../../lib/workbench-theme";
import {
  FILL_APP_MESSAGE,
  settleActiveTab,
  WORKBENCH_UPDATED_EVENT,
  workbenchAppPath,
  workbenchNoticesOf,
  workbenchTabsOf,
  workbenchUiUrl,
  type WorkbenchNotice,
  type WorkbenchTab,
  type WorkbenchUpdatedDetail,
} from "../../lib/workbench-tabs";
import { useLocale } from "../../state/locale";
import { useTheme } from "../../state/theme";
import { localizedText } from "../chat";

/** The Agent's workbench tabs, kept fresh by the server's `workbench_updated` events. */
export function useWorkbenchTabs(
  projectId: string | null,
  agentId: string | null,
  machineId: string | null = null,
  selectionKey = "",
  initialTab: string | null = null,
) {
  const scope = JSON.stringify([projectId, agentId, machineId]);
  const selectionScope = JSON.stringify([scope, selectionKey]);
  const [loaded, setLoaded] = useState<{
    scope: string;
    tabs: WorkbenchTab[];
    notices: WorkbenchNotice[];
  } | null>(null);
  const [selection, setSelection] = useState<{ scope: string; id: string | null } | null>(null);
  const tabs = loaded?.scope === scope ? loaded.tabs : [];
  const notices = loaded?.scope === scope ? loaded.notices : [];
  const active = selection?.scope === selectionScope ? selection.id : initialTab;
  const setActiveRaw = useCallback(
    (id: string | null) => setSelection({ scope: selectionScope, id }),
    [selectionScope],
  );

  // Which Agent the newest request was for. A slow answer for the Agent just left must not
  // land on the one now open: the strip would show its tabs beside another Agent's chat, and
  // a Remove from there would address the wrong Agent's workbench.
  const asked = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++asked.current;
    if (projectId === null || agentId === null) {
      setLoaded({ scope, tabs: [], notices: [] });
      return;
    }
    try {
      const res = await api.getWorkbenches(projectId, agentId, machineId);
      if (asked.current !== mine) return;
      setLoaded({
        scope,
        tabs: workbenchTabsOf(res.workbenches, machineId),
        notices: workbenchNoticesOf(res.workbenches),
      });
    } catch {
      // The strip is a convenience over the chat: a failed list leaves it as it was.
    }
  }, [projectId, agentId, machineId, scope]);

  useEffect(() => {
    void refresh();
    return () => {
      asked.current++;
    };
  }, [refresh]);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const d = (e as CustomEvent<WorkbenchUpdatedDetail>).detail;
      if (d.projectId === projectId && d.agentId === agentId) void refresh();
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
  }, [projectId, agentId, refresh]);

  const settled = settleActiveTab(active, tabs);
  // A tab that is gone is forgotten, not merely filtered: kept, the raw id would pull the
  // frame back over the chat the moment a workbench of the same id reappears — which is what
  // an Agent rewriting its folder (delete, then write) looks like from here.
  useEffect(() => {
    if (loaded?.scope === scope && active !== null && settled === null) setActiveRaw(null);
  }, [active, settled, loaded, scope, setActiveRaw]);
  const activeTab = settled === null ? null : (tabs.find((t) => t.tabId === settled) ?? null);
  return { tabs, notices, active: settled, activeTab, setActive: setActiveRaw, refresh };
}

/** How long a page that never finishes loading stays hidden before it is shown as it is. */
const FRAME_REVEAL_TIMEOUT_MS = 4000;

const TAB_BASE =
  "relative h-9 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400";
const TAB_ACTIVE = "border-accent font-medium text-gray-900 dark:text-gray-100";
const TAB_IDLE =
  "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200";

export function WorkbenchTabStrip({
  tabs,
  notices = [],
  active,
  onSelect,
}: {
  tabs: readonly WorkbenchTab[];
  /** Workbenches with nothing to show but something to say; see workbenchNoticesOf. */
  notices?: readonly WorkbenchNotice[];
  active: string | null;
  onSelect: (tabId: string | null) => void;
}) {
  const { locale } = useLocale();
  if (tabs.length === 0 && notices.length === 0) return null;
  return (
    <>
      {notices.map((n) => (
        <NoticeStrip
          key={n.workbenchId}
          tone={n.error === null ? "neutral" : "attention"}
          role="status"
          className="shrink-0 truncate px-3 py-1 text-xs"
          data-tooltip={n.error ?? n.hints.join("\n")}
          data-tooltip-content="text"
          data-tooltip-extra={n.error === null && n.hints.length > 1}
        >
          <span className="font-mono">{n.workbenchId}</span>: {n.error ?? n.hints[0]}
        </NoticeStrip>
      ))}
      {tabs.length > 0 && (
        <div
          role="tablist"
          aria-label={S.workbenches.tabsLabel}
          className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-gray-200 px-2 dark:border-gray-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={active === null}
            className={`${TAB_BASE} ${active === null ? TAB_ACTIVE : TAB_IDLE}`}
            onClick={() => onSelect(null)}
          >
            {S.workbenches.chatTab}
          </button>
          {tabs.map((t) => (
            <button
              key={t.tabId}
              type="button"
              role="tab"
              aria-selected={active === t.tabId}
              data-tooltip={t.error ?? undefined}
              data-tooltip-extra={t.error !== null}
              className={`${TAB_BASE} ${active === t.tabId ? TAB_ACTIVE : TAB_IDLE}`}
              onClick={() => onSelect(t.tabId)}
            >
              {localizedText(locale, t.title, t.titleZh)}
              {t.error !== null && (
                <span className={`ml-1.5 ${toneInk.danger}`} aria-label={S.workbenches.brokenMark}>
                  !
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function WorkbenchFrame({
  projectId,
  agentId,
  tab,
  bare = false,
  onChanged,
  onRemoved,
}: {
  projectId: string;
  agentId: string;
  tab: WorkbenchTab;
  /** The page alone, no bar: the full-page route (its palette carries the actions). */
  bare?: boolean;
  /** The workbench was reloaded or restored; the caller refetches the list. */
  onChanged: (workbench: WorkbenchInfo) => void;
  /** The workbench and its versions are gone; the caller drops the tab (the list refetch confirms). */
  onRemoved: () => void;
}) {
  const { dark, themeId, accent, textSize, fontLatin, fontCjk } = useTheme();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [busy, setBusy] = useState<"reload" | "rollback" | "remove" | null>(null);
  // Removal is armed by a first click and sent by the second; the arm drops when the tab changes.
  const [removeArmed, setRemoveArmed] = useState(false);
  useEffect(() => setRemoveArmed(false), [tab.workbenchId]);
  const [failure, setFailure] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<WorkbenchVersion[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  /** A revision whose restore awaits confirmation: it replaces the workbench's files. */
  const [restoring, setRestoring] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      setVersions(
        (await api.getWorkbenchHistory(projectId, agentId, tab.workbenchId, tab.machineId))
          .versions,
      );
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId, agentId, tab.workbenchId, tab.machineId]);

  useEffect(() => {
    if (historyOpen) void loadHistory();
  }, [historyOpen, loadHistory, tab.revision]);

  const reload = async () => {
    setBusy("reload");
    setFailure(null);
    try {
      onChanged(
        (await api.reloadWorkbench(projectId, agentId, tab.workbenchId, tab.machineId)).workbench,
      );
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (revision: string) => {
    setBusy("rollback");
    setFailure(null);
    try {
      onChanged(
        (await api.rollbackWorkbench(projectId, agentId, tab.workbenchId, revision, tab.machineId))
          .workbench,
      );
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // The page is a separate document: the app's dark class, theme, accent, fonts and root font
  // size stop at the frame, so they are copied in (lib/workbench-theme.ts) on load and on every appearance
  // change. Past the commit, because the provider that stamps them on the app's own document
  // is an ancestor and its effect runs after this one's.
  const applyTheme = useCallback(() => {
    themeWorkbenchFrame(frameRef.current, readDocumentTheme(document));
  }, []);
  useEffect(() => {
    const id = requestAnimationFrame(applyTheme);
    return () => cancelAnimationFrame(id);
  }, [applyTheme, dark, themeId, accent, textSize, fontLatin, fontCjk, tab.uiRev]);

  // A page is its own document: until it has loaded and been themed it paints the browser's
  // white canvas, and then its own unstyled markup — a white flash in a dark app, on every
  // tab switch and every reload. So the frame stays invisible over the app's own background
  // until the theme is on it, and fades in. The timer is for a page that never fires `load`
  // (a hung subresource): it is shown anyway rather than hidden forever.
  const frameKey = `${tab.tabId}@${tab.uiRev}`;
  const [shownKey, setShownKey] = useState<string | null>(null);
  const detachKeys = useRef<() => void>(() => undefined);
  useEffect(() => () => detachKeys.current(), []);
  const onFrameLoad = useCallback(() => {
    applyTheme();
    // The page's keys reach the app too, so the palette still answers after focus moves
    // into the full-page workbench.
    detachKeys.current();
    detachKeys.current = forwardFrameKeys(frameRef.current);
    setShownKey(frameKey);
  }, [applyTheme, frameKey]);
  useEffect(() => {
    const id = setTimeout(() => setShownKey(frameKey), FRAME_REVEAL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [frameKey]);

  const remove = async () => {
    setBusy("remove");
    setFailure(null);
    try {
      await api.removeWorkbench(projectId, agentId, tab.workbenchId, tab.machineId);
      onRemoved();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setBusy(null);
      setRemoveArmed(false);
    }
  };

  // Filling the app: the bar's button, or the page asking for it itself
  // (`parent.postMessage({ type: "penguin:fill-app" }, "*")`) — only from our own frame.
  const navigate = useNavigate();
  const location = useLocation();
  const paletteShortcut = useShortcutLabel("palette.toggle");
  const fillApp = useCallback(
    () =>
      void navigate(workbenchAppPath(projectId, agentId, tab.workbenchId, tab.key, tab.machineId), {
        state: { returnTo: location.pathname + location.search },
      }),
    [
      navigate,
      projectId,
      agentId,
      tab.workbenchId,
      tab.key,
      tab.machineId,
      location.pathname,
      location.search,
    ],
  );
  useEffect(() => {
    if (bare) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type === FILL_APP_MESSAGE) fillApp();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bare, fillApp]);

  const historyId = `workbench-history-${tab.workbenchId}`;
  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-950">
      <div
        hidden={bare}
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
      >
        <span className="font-medium text-gray-800 dark:text-gray-200">{tab.name}</span>
        {tab.version !== null && <span>v{tab.version}</span>}
        <span className="font-mono">{tab.revision}</span>
        <span className="flex-1" />
        <Button
          variant="secondary"
          size="sm"
          title={S.workbenches.fillAppHint(paletteShortcut)}
          data-tooltip-extra
          onClick={fillApp}
        >
          {S.workbenches.fillApp}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => void reload()}
        >
          {busy === "reload" ? S.workbenches.reloading : S.workbenches.reload}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={historyOpen}
          aria-controls={historyId}
          onClick={() => setHistoryOpen((v) => !v)}
        >
          {S.workbenches.history}
        </Button>
        {removeArmed ? (
          <>
            <span className={toneInk.danger}>{S.workbenches.removeConfirm}</span>
            <Button
              variant="danger"
              size="sm"
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              {busy === "remove" ? S.workbenches.removing : S.workbenches.removeYes}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => setRemoveArmed(false)}
            >
              {S.workbenches.removeNo}
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => setRemoveArmed(true)}
          >
            {S.workbenches.remove}
          </Button>
        )}
      </div>
      {tab.error !== null && !bare && (
        <NoticeStrip banner tone="danger" className="shrink-0 px-3 py-1.5 text-xs">
          {S.workbenches.loadError}: {tab.error}
        </NoticeStrip>
      )}
      {failure !== null && (
        <NoticeStrip banner tone="danger" className="shrink-0 px-3 py-1.5 text-xs">
          {failure}
        </NoticeStrip>
      )}
      <div
        id={historyId}
        hidden={!historyOpen || bare}
        className="max-h-64 shrink-0 overflow-y-auto border-b border-gray-200 dark:border-gray-800"
      >
        {historyError !== null ? (
          <div className="flex items-center gap-3 px-3 py-2 text-xs">
            <span role="alert" className="min-w-0 flex-1">
              {historyError}
            </span>
            <Button variant="secondary" size="sm" onClick={() => void loadHistory()}>
              {S.workbenches.retryHistory}
            </Button>
          </div>
        ) : versions === null ? (
          <p className="px-3 py-2 text-xs text-gray-500">{S.workbenches.loadingHistory}</p>
        ) : versions.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-500">{S.workbenches.noHistory}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {versions.map((v) => {
              const current = v.revision === tab.revision;
              return (
                <li key={v.revision} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                  <span className="font-mono">{v.revision}</span>
                  <span className="text-gray-500">{formatDateTime(v.savedAt)}</span>
                  {v.version !== null && <span className="text-gray-500">v{v.version}</span>}
                  <span className="text-gray-400">{S.workbenches.fileCount(v.files.length)}</span>
                  <span className="flex-1" />
                  {current ? (
                    <span className={toneInk.success}>{S.workbenches.current}</span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => setRestoring(v.revision)}
                    >
                      {S.workbenches.restore}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <iframe
        key={frameKey}
        ref={frameRef}
        onLoad={onFrameLoad}
        title={tab.title}
        src={workbenchUiUrl(tab)}
        className={`min-h-0 flex-1 border-0 transition-opacity duration-150 motion-reduce:transition-none ${
          shownKey === frameKey ? "opacity-100" : "opacity-0"
        }`}
        sandbox={PAGE_FRAME_SANDBOX}
      />
      <ConfirmModal
        open={restoring !== null}
        title={S.workbenches.restoreTitle}
        onClose={() => setRestoring(null)}
        onConfirm={() => {
          if (restoring !== null) void rollback(restoring);
          setRestoring(null);
        }}
        confirmLabel={S.workbenches.restore}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {restoring !== null ? S.workbenches.restoreConfirm(restoring) : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}
