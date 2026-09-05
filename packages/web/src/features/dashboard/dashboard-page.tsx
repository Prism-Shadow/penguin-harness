/**
 * The dashboard: a page sized for a phone that answers one question — where is work
 * happening, and where is a person needed. One row per Workspace with a Session running or
 * finished since this browser last looked at it, over every machine the Project's Sessions
 * live on; two numbers per row and nothing else. The counts are the sidebar's own glyph
 * states, read against the same per-browser seen markers, so the board and the list agree.
 * Reached from the user menu, under System settings; not in the nav.
 *
 * Every server is asked itself: this one, and each machine that can be reached — the same
 * way the session list learns of Sessions elsewhere. A machine that does not answer is
 * counted and said, never silently dropped; a page that shows fewer rows than there are
 * Workspaces must say why. Non-admins cannot list machines, so they get this server's own.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../../api/endpoints";
import { useProject } from "../../state/project";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneDot, toneInk, toneStrip } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import { ICON_GAP } from "../../lib/icon-scale";
import { workspaceMachines } from "../../lib/workspace-machines";
import { useSessionSeen } from "../../lib/session-seen";
import { EmptyState } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { dashboardRows, dashboardTotals } from "./dashboard-view";
import type { DashboardSource } from "./dashboard-view";

/** A running Session moves in seconds; the board follows at a pace a phone's battery forgives. */
const REFRESH_MS = 15_000;

interface Server {
  machineId: string | null;
  label: string;
  local: boolean;
}

const THIS_SERVER: Server = { machineId: null, label: "", local: true };

/** One count with its meaning beside it, so the number never stands on colour alone. */
function Count({ tone, n, label }: { tone: Tone; n: number; label: string }) {
  const ink = n > 0 ? toneInk[tone] : toneInk.muted;
  const dot = n > 0 ? toneDot[tone] : toneDot.muted;
  return (
    <span className={`inline-flex items-center ${ICON_GAP.tight} tabular-nums ${ink}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span>{n}</span>
      <span className="text-xs">{label}</span>
    </span>
  );
}

export function DashboardPage() {
  const { currentProject } = useProject();
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
    return () => clearInterval(timer);
  }, [load]);

  const totals = rows === null ? null : dashboardTotals(rows);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {S.dashboard.title}
          </h1>
          {totals !== null && (
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
              <li key={row.key} className="flex items-center justify-between gap-3 px-3 py-3">
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
                <div className="flex shrink-0 gap-3 text-sm">
                  <Count tone="busy" n={row.running} label={S.dashboard.running} />
                  <Count tone="attention" n={row.pendingReview} label={S.dashboard.pendingReview} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
