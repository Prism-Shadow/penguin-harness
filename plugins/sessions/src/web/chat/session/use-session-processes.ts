/**
 * The background processes the conversation started (the details card's list): polled while the
 * list can still change, and the Stop / Remove / clear-exited actions on its rows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionInfo, SessionProcessInfo } from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { apiErrorText } from "../../../lib/api-error";
import { exitedProcessIds, reportableProcessFailure } from "../process-list";
import type { SessionStreamState } from "../use-session-stream";

/** How often the background-process list refreshes while it can still change (a run may promote a command at any time; a running process can exit on its own). */
const PROCESS_POLL_MS = 15_000;

export function useSessionProcesses({
  selected,
  selectedSessionId,
  stream,
  infoOpen,
  processes,
  setProcesses,
}: {
  selected: SessionInfo | null;
  selectedSessionId: string | null;
  stream: Pick<SessionStreamState, "taskState">;
  infoOpen: boolean;
  processes: SessionProcessInfo[];
  setProcesses: (next: SessionProcessInfo[]) => void;
}) {
  // procBusy marks the rows whose Stop / Remove requests are in flight (every exited row at
  // once while "clear exited" runs).
  const [procBusy, setProcBusy] = useState<readonly string[] | null>(null);
  /** A running process whose Stop awaits confirmation: it ends the process and drops its output. */
  const [procToKill, setProcToKill] = useState<SessionProcessInfo | null>(null);
  // The currently selected Session, readable from an async callback that captured an older
  // one (the process actions below): a state value read through a closure would be the value
  // at click time, which is exactly what must not decide where a late response lands.
  const selectedSessionIdRef = useRef<string | null>(selectedSessionId);
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  // Background-process list: fetched on session entry, then kept fresh while it can still
  // change — during a run (a foreground command may promote to background at any moment),
  // while any listed process is still running (it can exit on its own), and while the
  // details popover shows the list. Otherwise no timer runs: an idle session with no
  // processes has nothing to poll for. Fail-soft — a failed poll keeps the last list.
  const runningProcessCount = processes.filter((p) => p.running).length;
  // The Workspace's open pull request, for the chip at the end of the header row.
  const processesCanChange =
    stream.taskState !== "idle" || runningProcessCount > 0 || (infoOpen && processes.length > 0);
  // The row's own count moves the moment the server sees a process promoted or gone (the
  // user channel's session_background), so a change there re-reads the list at once instead
  // of a poll interval later — the popover stays in step with the header's count.
  const backgroundProcessCount = selected?.backgroundTasks?.processes ?? 0;
  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    const refresh = () => {
      api
        .getSessionProcesses(selectedSessionId)
        .then((res) => {
          if (!cancelled) setProcesses(res.processes);
        })
        .catch(() => undefined);
    };
    refresh();
    if (!processesCanChange) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(refresh, PROCESS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedSessionId, stream.taskState, processesCanChange, backgroundProcessCount]);

  /**
   * Shared body of the process actions (a row's Stop / Remove, the list's "clear exited"):
   * one action at a time (procBusy), one request per entry through the per-entry route, the
   * statuses that only mean "the list was stale" swallowed instead of toasted (at most one
   * toast for the whole batch — see reportableProcessFailure), and the list refreshed
   * however the requests ended — the truth comes from the refresh, not from the responses.
   * The refresh is applied ONLY while its own session is still selected: switching sessions
   * mid-request would otherwise paint the previous session's processes into the new
   * session's card, and with the popover closed and nothing running there is no poll to
   * correct it.
   */
  const runProcessAction = useCallback(
    async (
      processIds: readonly string[],
      request: (sessionId: string, processId: string) => Promise<void>,
      staleStatuses: readonly number[],
    ) => {
      if (!selected || procBusy !== null) return;
      const sessionId = selected.sessionId;
      setProcBusy(processIds);
      try {
        const results = await Promise.allSettled(
          processIds.map((processId) => request(sessionId, processId)),
        );
        const failure = reportableProcessFailure(results, staleStatuses);
        if (failure !== null) toastError(apiErrorText(failure.error));
      } finally {
        setProcBusy(null);
        api
          .getSessionProcesses(sessionId)
          .then((res) => {
            if (selectedSessionIdRef.current === sessionId) setProcesses(res.processes);
          })
          .catch(() => undefined);
      }
    },
    [selected, procBusy],
  );

  // Stop one background process: the kill also removes it from the server-side registry,
  // so the follow-up refresh drops the row (a 404 means it already exited/was reaped —
  // same outcome, not an error worth surfacing).
  const onKillProcess = useCallback(
    (processId: string) => runProcessAction([processId], api.killSessionProcess, [404]),
    [runProcessAction],
  );

  // Remove one EXITED process entry from the list (#312; running rows offer Stop instead).
  // A 404 means the entry is already gone, a 409 that it is in fact (still) running —
  // either way the follow-up refresh shows the truth, so neither is surfaced as an error.
  const onRemoveProcess = useCallback(
    (processId: string) => runProcessAction([processId], api.removeSessionProcess, [404, 409]),
    [runProcessAction],
  );

  // Clear every EXITED entry at once: the rows' own Remove, sent for each of them through the
  // same route, so every entry meets the same checks (an entry that turns out to be running
  // stays, one already gone is no error) and running rows are never touched.
  const exitedIds = useMemo(() => exitedProcessIds(processes), [processes]);
  const onClearExitedProcesses = useCallback(
    () => runProcessAction(exitedIds, api.removeSessionProcess, [404, 409]),
    [runProcessAction, exitedIds],
  );
  return {
    procBusy,
    procToKill,
    setProcToKill,
    exitedIds,
    onKillProcess,
    onRemoveProcess,
    onClearExitedProcesses,
  };
}
