/**
 * The dashboard: a page sized for a phone that answers one question — where is work
 * happening, and where is a person needed. One row per Workspace with a Session running or
 * finished since this browser last looked at it, over every machine the Project's Sessions
 * live on; two numbers per row, and a count unfolds into the Sessions it counts, one line each,
 * that open the conversation. The counts are the sidebar's own glyph states, read against the
 * same per-browser seen markers, so the board and the list agree. A count of zero is not
 * shown: the number a row exists for is the one that is not zero.
 * Reached from the user menu, under System settings; not in the nav.
 *
 * Every server is asked itself: this one, and each machine that can be reached — the same
 * way the session list learns of Sessions elsewhere. A machine that does not answer is
 * counted and said, never silently dropped; a page that shows fewer rows than there are
 * Workspaces must say why. Non-admins cannot list machines, so they get this server's own.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import * as api from "../../api/endpoints";
import { useProject } from "../../state/project";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneDot, toneInk, toneStrip } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import { ICON_GAP } from "../../lib/icon-scale";
import { workspaceMachines } from "../../lib/workspace-machines";
import { noteSessionSeen, useSessionSeen } from "../../lib/session-seen";
import { rememberSessionMachine } from "../../lib/session-machines";
import { EmptyState } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { SessionActivityIcon } from "../../components/ui/session-activity-icon";
import { shortSessionId } from "../chat/agent-topology";
import { dashboardRows, dashboardTotals } from "./dashboard-view";
import type { DashboardRow, DashboardSession, DashboardSource } from "./dashboard-view";

/** A running Session moves in seconds; the board follows at a pace a phone's battery forgives. */
const REFRESH_MS = 15_000;

interface Server {
  machineId: string | null;
  label: string;
  local: boolean;
}

const THIS_SERVER: Server = { machineId: null, label: "", local: true };

/** The two lists a row can unfold, by the count that names each. */
type Kind = "running" | "pendingReview";
const KINDS: readonly Kind[] = ["running", "pendingReview"];
const TONE: Record<Kind, Tone> = { running: "busy", pendingReview: "attention" };
const listKey = (row: DashboardRow, kind: Kind) => `${row.key}\0${kind}`;

/** One count with its meaning beside it, so the number never stands on colour alone. Zero says nothing. */
function Count({ tone, n, label }: { tone: Tone; n: number; label: string }) {
  if (n === 0) return null;
  return (
    <span className={`inline-flex items-center ${ICON_GAP.tight} tabular-nums ${toneInk[tone]}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} />
      <span>{n}</span>
      <span className="text-xs">{label}</span>
    </span>
  );
}

/** A row's count, as the button that unfolds the Sessions behind it. */
function CountToggle({
  tone,
  n,
  label,
  expanded,
  onToggle,
}: {
  tone: Tone;
  n: number;
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (n === 0) return null;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      title={S.dashboard.toggleList}
      onClick={onToggle}
      className={`inline-flex items-center rounded px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 ${
        expanded ? "bg-gray-100 dark:bg-gray-800" : ""
      }`}
    >
      <Count tone={tone} n={n} label={label} />
    </button>
  );
}

/**
 * The Sessions behind one count, one line each: the glyph the sidebar row wears, the title
 * truncated to the line, and the id's short tail — the title alone can repeat ("New chat"
 * three times), and the tail is how a Session is told apart everywhere else in the app.
 */
function SessionLines({
  sessions,
  onOpen,
}: {
  sessions: readonly DashboardSession[];
  onOpen: (s: DashboardSession) => void;
}) {
  return (
    <ul className="border-t border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40">
      {sessions.map((s) => (
        <li key={s.sessionId}>
          <button
            type="button"
            onClick={() => onOpen(s)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <SessionActivityIcon activity={s.activity} />
            <span className="min-w-0 flex-1 truncate">{s.title ?? S.chat.defaultSessionTitle}</span>
            <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
              {shortSessionId(s.sessionId)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { currentProject, setCurrentAgentId } = useProject();
  const projectId = currentProject?.projectId ?? null;
  useDocumentTitle(S.dashboard.title);
  const [sources, setSources] = useState<DashboardSource[] | null>(null);
  const seen = useSessionSeen(projectId);
  const rows = useMemo(
    () => (sources === null ? null : dashboardRows(sources, seen)),
    [sources, seen],
  );
  const [silent, setSilent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** The lists unfolded, by row and count; keyed on the row's stable key so a poll leaves them open. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const load = useCallback(async () => {
    if (projectId === null) return;
    let servers: Server[] = [THIS_SERVER];
    try {
      const machines = workspaceMachines(await api.getMachines(projectId)).filter(
        (m) => m.local || (m.selectable && m.id !== null),
      );
      if (machines.length > 0) {
        servers = machines.map((m) => ({ machineId: m.id, label: m.label, local: m.local }));
      }
    } catch {
      // The machine list is admin-only; everyone else reads this server, which holds its own.
    }
    const answers = await Promise.allSettled(
      servers.map(async (server): Promise<DashboardSource> => {
        const { sessions } = await api.getSessionsOverview(projectId, server.machineId);
        return {
          machineId: server.machineId,
          machineLabel: server.label,
          local: server.local,
          sessions,
        };
      }),
    );
    const sources = answers.flatMap((a) => (a.status === "fulfilled" ? [a.value] : []));
    const failed = answers.flatMap((a) => (a.status === "rejected" ? [a.reason as unknown] : []));
    if (sources.length === 0) {
      setError(apiErrorText(failed[0]));
      return;
    }
    setError(null);
    setSilent(failed.length);
    setSources(sources);
  }, [projectId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    // Coming back to the tab asks again at once: on a phone the board is glanced at between
    // other things, and a fifteen-second-old answer is the one it would otherwise show first.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  /**
   * Opening is what the sidebar does for one of its rows (sidebar.tsx openSession): stamp the
   * Session read, make its Agent current, go. Plus one thing the sidebar had already done by
   * listing it — record which machine holds it, so the chat page's calls about it go there.
   */
  const open = (s: DashboardSession) => {
    rememberSessionMachine(s.sessionId, s.machineId);
    noteSessionSeen(projectId, s.sessionId, s.lastActiveAt);
    setCurrentAgentId(s.agentId);
    navigate(`/chat/${s.sessionId}`);
  };

  const totals = rows === null ? null : dashboardTotals(rows);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {S.dashboard.title}
          </h1>
          {totals !== null && (totals.running > 0 || totals.pendingReview > 0) && (
            <div className="flex gap-3 text-sm">
              <Count tone="busy" n={totals.running} label={S.dashboard.running} />
              <Count tone="attention" n={totals.pendingReview} label={S.dashboard.pendingReview} />
            </div>
          )}
        </header>

        {error !== null && (
          <p role="alert" className={`text-sm ${toneInk.danger}`}>
            {S.dashboard.loadFailed}: {error}
          </p>
        )}
        {/* Said before the list, as a notice, never after it in small print: a board
            missing a machine's answer is not a board that says "nothing is running". */}
        {silent > 0 && (
          <p role="status" className={`rounded-md border px-3 py-2 text-sm ${toneStrip.attention}`}>
            {S.dashboard.silentMachines(silent)}
          </p>
        )}
        {rows === null && error === null && <SkeletonList rows={4} />}
        {rows !== null && rows.length === 0 && (
          <EmptyState
            title={silent > 0 ? S.dashboard.emptyHere : S.dashboard.empty}
            description={S.dashboard.emptyHint}
          />
        )}
        {rows !== null && rows.length > 0 && (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-950">
            {rows.map((row) => (
              <li key={row.key}>
                <div className="flex items-center justify-between gap-3 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {row.temporary ? S.dashboard.temporaryWorkspaces : row.label}
                    </p>
                    {row.machineLabel !== null && (
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {row.machineLabel}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2 text-sm">
                    {KINDS.map((kind) => (
                      <CountToggle
                        key={kind}
                        tone={TONE[kind]}
                        n={row[kind].length}
                        label={S.dashboard[kind]}
                        expanded={expanded.has(listKey(row, kind))}
                        onToggle={() => toggle(listKey(row, kind))}
                      />
                    ))}
                  </div>
                </div>
                {KINDS.map(
                  (kind) =>
                    row[kind].length > 0 &&
                    expanded.has(listKey(row, kind)) && (
                      <SessionLines key={kind} sessions={row[kind]} onOpen={open} />
                    ),
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
