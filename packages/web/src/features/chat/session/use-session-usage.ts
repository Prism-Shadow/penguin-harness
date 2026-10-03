/**
 * Per-Session readings that reset on a Session switch: the file cards' existence cache, and the
 * session cost and Token buckets from the usage fetch behind the header's cost chip.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo, SessionProcessInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../../api/endpoints";
import { applyUsageFetch, createCostStatHold } from "../header-stats";
import type { StagedThinkingSwitch } from "../../model-picker";
import type { SessionStreamState } from "../use-session-stream";

/**
 * Server-enforced ceiling on paths per files/stat call (STAT_MAX_PATHS in the sessions routes,
 * which 400s above it). A Task-level summary aggregates candidates across the whole Task and can
 * exceed it, so cache misses are checked in chunks of this size.
 */
const STAT_PATHS_PER_REQUEST = 100;

export function useSessionUsage({
  routeSessionId,
  projectId,
  selected,
  stream,
  infoOpen,
  setThinkingSwitch,
  setModelSwitchAsk,
  setProcesses,
}: {
  routeSessionId: string | null;
  projectId: string | null;
  selected: SessionInfo | null;
  stream: Pick<SessionStreamState, "taskState">;
  infoOpen: boolean;
  setThinkingSwitch: (next: StagedThinkingSwitch | null) => void;
  setModelSwitchAsk: (next: null) => void;
  setProcesses: (next: SessionProcessInfo[]) => void;
}) {
  // Cost chip state lives in a mutable per-session hold (header-stats.ts, pure/unit-tested):
  // the fetched session cost + a client-settled live base + the last shown value, advanced once
  // per render by advanceCostStat (which also resets it on session switch). usageAppliedRef
  // marks the session whose usage fetch has applied ("initial fetch done"); usageStamp only
  // forces a repaint when a fetch resolves outside the stream's own version bumps.
  const costHoldRef = useRef(createCostStatHold());
  const usageAppliedRef = useRef<string | null>(null);
  const [, bumpUsageStamp] = useState(0);
  // Session Token buckets from the last usage fetch (the popover's tokens-line breakdown):
  // server-recorded values — they can trail the live chip mid-run and reconcile on idle.
  const [usageBuckets, setUsageBuckets] = useState<{
    cacheRead: number;
    cacheWrite: number;
    output: number;
  } | null>(null);
  // Positive-only existence cache for file summary cards (session-level): normalized relative
  // path -> true, or the shared in-flight lookup. Missing files aren't retained — a later Task may
  // create the same path, so its summary must re-check instead of inheriting stale false state.
  const statCacheRef = useRef(new Map<string, true | Promise<boolean>>());

  // Session switch: resets the usage-fetch marker, the file-card existence cache, any
  // thinking-level switch staged behind its dialog (per-session UI state — a compaction
  // that self-heals to a new session id routes through here too and drops the held pick),
  // a model switch waiting behind its own dialog (it was asked of the conversation left),
  // and the popover's per-session data (process list / token buckets),
  // avoiding stale data from the previous Session (the panel jump commands reset in their
  // own effect above, and the cost hold re-keys itself inside advanceCostStat). The thinking level itself needs no reset — it is read off the
  // selected Session row, so it changes with the session by construction.
  useEffect(() => {
    usageAppliedRef.current = null;
    setThinkingSwitch(null);
    setModelSwitchAsk(null);
    statCacheRef.current = new Map();
    setProcesses([]);
    setUsageBuckets(null);
  }, [routeSessionId]);

  // Batched existence check for file summaries: cache stable positive results and share in-flight
  // requests, but never retain a negative result. Each pending lookup mutates the cache only while
  // it is still the current entry, so an old request can't delete or overwrite a newer one.
  const statFiles = useCallback(
    async (paths: string[]): Promise<ReadonlySet<string>> => {
      const sessionId = selected?.sessionId ?? null;
      const cache = statCacheRef.current;
      const misses = sessionId === null ? [] : paths.filter((p) => !cache.has(p));
      if (sessionId !== null && misses.length > 0) {
        for (let i = 0; i < misses.length; i += STAT_PATHS_PER_REQUEST) {
          const chunk = misses.slice(i, i + STAT_PATHS_PER_REQUEST);
          const batch = api
            .statSessionFiles(sessionId, chunk)
            .then((res) => new Set(res.existing))
            .catch(() => null);
          for (const p of chunk) {
            const pending = batch.then((existing) => existing?.has(p) ?? false);
            cache.set(p, pending);
            void pending.then((exists) => {
              if (cache.get(p) !== pending) return;
              if (exists) cache.set(p, true);
              else cache.delete(p);
            });
          }
        }
      }
      const result = new Set<string>();
      await Promise.all(
        paths.map(async (p) => {
          const hit = cache.get(p);
          if (hit === true || (hit instanceof Promise && (await hit))) result.add(p);
        }),
      );
      return result;
    },
    [selected?.sessionId],
  );

  // Session's cumulative cost (priced by the server in real time from its usage rows): fetched
  // once when the session becomes selected — even mid-run, so a page load during an active run
  // recovers the already-accrued total instead of waiting for idle — then refreshed on every
  // return to idle (the authoritative reconcile, as before). usageAppliedRef marks the initial
  // fetch done only when a response applies, so a cancelled/failed attempt retries on the next
  // transition rather than polling. The cancelled flag doubles as a staleness guard: any
  // task-state change re-runs the effect and discards an in-flight response fetched under the
  // previous run state (whose total would misalign with the live buckets it is snapshotted
  // against — see applyUsageFetch).
  // infoOpen is a refresh trigger on top of the original conditions: opening the details
  // popover mid-run re-fetches once, so its token breakdown isn't a whole Task stale
  // (applyUsageFetch is designed for mid-run reconciles — see header-stats.ts).
  useEffect(() => {
    if (!projectId || !selected) return;
    if (usageAppliedRef.current === selected.sessionId && stream.taskState !== "idle" && !infoOpen)
      return;
    let cancelled = false;
    api
      .getUsage(projectId, { groupBy: "session", agentId: selected.agentId })
      .then((res) => {
        if (cancelled) return;
        usageAppliedRef.current = selected.sessionId;
        const row = res.groups.find((g) => g.key === selected.sessionId);
        applyUsageFetch(costHoldRef.current, selected.sessionId, row ?? null);
        setUsageBuckets(
          row ? { cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, output: row.output } : null,
        );
        bumpUsageStamp((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, selected, stream.taskState, infoOpen]);
  return { costHoldRef, usageBuckets, statFiles };
}
