/**
 * Workflow tabs beside Chat, and the page a workflow tab shows.
 *
 * The strip lists the Agent's workflows that ship a UI (lib/workflow-tabs.ts); the frame
 * is that UI in an iframe served from the workflow's own `ui/` folder, plus a thin bar
 * with the workflow's version, its load error when the current files do not boot, a
 * reload, and a history fold with one restore button per recorded version. The list
 * refetches when the server announces `workflow_updated` for this Agent, so an Agent
 * editing its own workflow sees the tab update (the iframe keys on `uiRev`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { WorkflowInfo, WorkflowVersion } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { forwardFrameKeys, readDocumentTheme, themeWorkflowFrame } from "../../lib/workflow-theme";
import {
  FILL_APP_MESSAGE,
  settleActiveTab,
  WORKFLOW_UPDATED_EVENT,
  workflowAppPath,
  workflowNoticesOf,
  workflowTabsOf,
  workflowUiUrl,
  type WorkflowNotice,
  type WorkflowTab,
  type WorkflowUpdatedDetail,
} from "../../lib/workflow-tabs";
import { useLocale } from "../../state/locale";
import { useTheme } from "../../state/theme";
import { localizedText } from "../chat/skill-use";

/** The Agent's workflow tabs, kept fresh by the server's `workflow_updated` events. */
export function useWorkflowTabs(projectId: string | null, agentId: string | null) {
  const [tabs, setTabs] = useState<WorkflowTab[]>([]);
  const [notices, setNotices] = useState<WorkflowNotice[]>([]);
  const [active, setActiveRaw] = useState<string | null>(null);

  // Which Agent the newest request was for. A slow answer for the Agent just left must not
  // land on the one now open: the strip would show its tabs beside another Agent's chat, and
  // a Remove from there would address the wrong Agent's workflow.
  const asked = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++asked.current;
    if (projectId === null || agentId === null) {
      setTabs([]);
      setNotices([]);
      return;
    }
    try {
      const res = await api.getWorkflows(projectId, agentId);
      if (asked.current !== mine) return;
      setTabs(workflowTabsOf(res.workflows));
      setNotices(workflowNoticesOf(res.workflows));
    } catch {
      // The strip is a convenience over the chat: a failed list leaves it as it was.
    }
  }, [projectId, agentId]);

  useEffect(() => {
    setActiveRaw(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const d = (e as CustomEvent<WorkflowUpdatedDetail>).detail;
      if (d.projectId === projectId && d.agentId === agentId) void refresh();
    };
    window.addEventListener(WORKFLOW_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(WORKFLOW_UPDATED_EVENT, onUpdated);
  }, [projectId, agentId, refresh]);

  const settled = settleActiveTab(active, tabs);
  // A tab that is gone is forgotten, not merely filtered: kept, the raw id would pull the
  // frame back over the chat the moment a workflow of the same id reappears — which is what
  // an Agent rewriting its folder (delete, then write) looks like from here.
  useEffect(() => {
    if (active !== null && settled === null) setActiveRaw(null);
  }, [active, settled]);
  const activeTab = settled === null ? null : (tabs.find((t) => t.tabId === settled) ?? null);
  return { tabs, notices, active: settled, activeTab, setActive: setActiveRaw, refresh };
}

/** How long a page that never finishes loading stays hidden before it is shown as it is. */
const FRAME_REVEAL_TIMEOUT_MS = 4000;

const TAB_BASE =
  "relative h-9 shrink-0 border-b-2 px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400";
const TAB_ACTIVE = "border-[var(--accent-bg)] font-medium text-gray-900 dark:text-gray-100";
const TAB_IDLE =
  "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200";

export function WorkflowTabStrip({
  tabs,
  notices = [],
  active,
  onSelect,
}: {
  tabs: readonly WorkflowTab[];
  /** Workflows with nothing to show but something to say; see workflowNoticesOf. */
  notices?: readonly WorkflowNotice[];
  active: string | null;
  onSelect: (tabId: string | null) => void;
}) {
  const { locale } = useLocale();
  if (tabs.length === 0 && notices.length === 0) return null;
  return (
    <>
      {notices.map((n) => (
        <div
          key={n.workflowId}
          role="status"
          className={`shrink-0 truncate px-3 py-1 text-xs ${
            n.error === null ? toneStrip.muted : toneStrip.attention
          }`}
          title={n.error ?? n.hints.join("\n")}
        >
          <span className="font-mono">{n.workflowId}</span>: {n.error ?? n.hints[0]}
        </div>
      ))}
      {tabs.length > 0 && (
        <div
          role="tablist"
          aria-label={S.workflows.tabsLabel}
          className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-gray-200 px-2 dark:border-gray-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={active === null}
            className={`${TAB_BASE} ${active === null ? TAB_ACTIVE : TAB_IDLE}`}
            onClick={() => onSelect(null)}
          >
            {S.workflows.chatTab}
          </button>
          {tabs.map((t) => (
            <button
              key={t.tabId}
              type="button"
              role="tab"
              aria-selected={active === t.tabId}
              title={t.error ?? undefined}
              className={`${TAB_BASE} ${active === t.tabId ? TAB_ACTIVE : TAB_IDLE}`}
              onClick={() => onSelect(t.tabId)}
            >
              {localizedText(locale, t.title, t.titleZh)}
              {t.error !== null && (
                <span className={`ml-1.5 ${toneInk.danger}`} aria-label={S.workflows.brokenMark}>
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

export function WorkflowFrame({
  projectId,
  agentId,
  tab,
  bare = false,
  onChanged,
  onRemoved,
}: {
  projectId: string;
  agentId: string;
  tab: WorkflowTab;
  /** The page alone, no bar: the full-page route (its palette carries the actions). */
  bare?: boolean;
  /** The workflow was reloaded or restored; the caller refetches the list. */
  onChanged: (workflow: WorkflowInfo) => void;
  /** The workflow and its versions are gone; the caller drops the tab (the list refetch confirms). */
  onRemoved: () => void;
}) {
  const { dark, accent, fontScale } = useTheme();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [busy, setBusy] = useState<"reload" | "rollback" | "remove" | null>(null);
  // Removal is armed by a first click and sent by the second; the arm drops when the tab changes.
  const [removeArmed, setRemoveArmed] = useState(false);
  useEffect(() => setRemoveArmed(false), [tab.workflowId]);
  const [failure, setFailure] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<WorkflowVersion[] | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setVersions((await api.getWorkflowHistory(projectId, agentId, tab.workflowId)).versions);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
  }, [projectId, agentId, tab.workflowId]);

  useEffect(() => {
    if (historyOpen) void loadHistory();
  }, [historyOpen, loadHistory, tab.revision]);

  const reload = async () => {
    setBusy("reload");
    setFailure(null);
    try {
      onChanged((await api.reloadWorkflow(projectId, agentId, tab.workflowId)).workflow);
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
        (await api.rollbackWorkflow(projectId, agentId, tab.workflowId, revision)).workflow,
      );
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // The page is a separate document: the app's dark class, accent and root font size stop at
  // the frame, so they are copied in (lib/workflow-theme.ts) on load and on every appearance
  // change. Past the commit, because the provider that stamps them on the app's own document
  // is an ancestor and its effect runs after this one's.
  const applyTheme = useCallback(() => {
    themeWorkflowFrame(frameRef.current, readDocumentTheme(document));
  }, []);
  useEffect(() => {
    const id = requestAnimationFrame(applyTheme);
    return () => cancelAnimationFrame(id);
  }, [applyTheme, dark, accent, fontScale, tab.uiRev]);

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
    // The page's keys reach the app too, so the palette — the only way out of the full-page
    // route — still answers once the reader has clicked into the page.
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
      await api.removeWorkflow(projectId, agentId, tab.workflowId);
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
  const fillApp = useCallback(
    () => void navigate(workflowAppPath(projectId, agentId, tab.workflowId, tab.key)),
    [navigate, projectId, agentId, tab.workflowId, tab.key],
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

  const historyId = `workflow-history-${tab.workflowId}`;
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
        <Button variant="secondary" size="sm" title={S.workflows.fillAppHint} onClick={fillApp}>
          {S.workflows.fillApp}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => void reload()}
        >
          {busy === "reload" ? S.workflows.reloading : S.workflows.reload}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={historyOpen}
          aria-controls={historyId}
          onClick={() => setHistoryOpen((v) => !v)}
        >
          {S.workflows.history}
        </Button>
        {removeArmed ? (
          <>
            <span className={toneInk.danger}>{S.workflows.removeConfirm}</span>
            <Button
              variant="danger"
              size="sm"
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              {busy === "remove" ? S.workflows.removing : S.workflows.removeYes}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => setRemoveArmed(false)}
            >
              {S.workflows.removeNo}
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => setRemoveArmed(true)}
          >
            {S.workflows.remove}
          </Button>
        )}
      </div>
      {tab.error !== null && !bare && (
        <div className={`shrink-0 px-3 py-1.5 text-xs ${toneStrip.danger}`}>
          {S.workflows.loadError}: {tab.error}
        </div>
      )}
      {failure !== null && (
        <div className={`shrink-0 px-3 py-1.5 text-xs ${toneStrip.danger}`}>{failure}</div>
      )}
      <div
        id={historyId}
        hidden={!historyOpen || bare}
        className="max-h-64 shrink-0 overflow-y-auto border-b border-gray-200 dark:border-gray-800"
      >
        {versions === null ? (
          <p className="px-3 py-2 text-xs text-gray-500">{S.workflows.loadingHistory}</p>
        ) : versions.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-500">{S.workflows.noHistory}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {versions.map((v) => {
              const current = v.revision === tab.revision;
              return (
                <li key={v.revision} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                  <span className="font-mono">{v.revision}</span>
                  <span className="text-gray-500">{formatDateTime(v.savedAt)}</span>
                  {v.version !== null && <span className="text-gray-500">v{v.version}</span>}
                  <span className="text-gray-400">{S.workflows.fileCount(v.files.length)}</span>
                  <span className="flex-1" />
                  {current ? (
                    <span className={toneInk.success}>{S.workflows.current}</span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void rollback(v.revision)}
                    >
                      {S.workflows.restore}
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
        src={workflowUiUrl(tab)}
        className={`min-h-0 flex-1 border-0 transition-opacity duration-150 motion-reduce:transition-none ${
          shownKey === frameKey ? "opacity-100" : "opacity-0"
        }`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      />
    </div>
  );
}
