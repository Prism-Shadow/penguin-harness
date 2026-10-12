/**
 * The start page's server reads (start-dashboard.tsx): what its counts count.
 *
 * The plugin library's RSI toolkits (GET /api/plugins) are the same for every Project and change
 * only with the build, so they are read once per page load and shared by every later mount: a
 * locale switch remounts the whole tree, and a new chat must not flash placeholders the last one
 * had already filled. A failed read is not kept, so the next mount asks again.
 *
 * A Project's Benchmarks change as evaluations land, so they are read again on every mount —
 * starting from the list the previous mount saw, which keeps the Benchmarks count steady instead
 * of dropping back to "—" while the fresh list is on its way.
 */
import { useEffect, useState } from "react";
import type { BenchmarkSummary, PluginItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";

/** The plugin library's category the self-evolution toolkits are filed under. */
export const RSI_CATEGORY = "rsi";

/** A hook returning `read()`'s answer, read at most once per page load (null until it lands). */
function readOncePerPageLoad<T>(read: () => Promise<T>): () => T | null {
  let value: T | null = null;
  let pending: Promise<T> | null = null;
  return function useOncePerPageLoad(): T | null {
    const [current, setCurrent] = useState<T | null>(value);
    useEffect(() => {
      // Landed between this mount's render and its effect.
      if (value !== null) {
        setCurrent(value);
        return;
      }
      let cancelled = false;
      pending ??= read().then((answer) => {
        value = answer;
        return answer;
      });
      pending.then(
        (answer) => {
          if (!cancelled) setCurrent(answer);
        },
        () => {
          pending = null;
        },
      );
      return () => {
        cancelled = true;
      };
    }, []);
    return current;
  };
}

/** The library's self-evolution toolkits: the plugins of its `rsi` category (GET /api/plugins). */
export const useRsiToolkits = readOncePerPageLoad<PluginItem[]>(async () => {
  const library = await api.getPluginLibrary();
  return library.groups.find((group) => group.id === RSI_CATEGORY)?.plugins ?? [];
});

/** The last Benchmark list read per Project in this page load. */
const benchmarkLists = new Map<string, BenchmarkSummary[]>();

export interface ProjectBenchmarks {
  /** The Project's Benchmarks on this server; null until the first list arrives. */
  benchmarks: BenchmarkSummary[] | null;
  /** The read failed with no earlier list to show. */
  failed: boolean;
}

/**
 * This Project's Benchmarks as this server holds them — the Evaluation Center's own list, without
 * the machines it reaches: the start page summarises the server it is talking to.
 */
export function useProjectBenchmarks(projectId: string): ProjectBenchmarks {
  const [state, setState] = useState<ProjectBenchmarks & { projectId: string }>(() => ({
    projectId,
    benchmarks: benchmarkLists.get(projectId) ?? null,
    failed: false,
  }));
  useEffect(() => {
    let cancelled = false;
    api.listBenchmarks(projectId).then(
      (res) => {
        benchmarkLists.set(projectId, res.benchmarks);
        if (!cancelled) setState({ projectId, benchmarks: res.benchmarks, failed: false });
      },
      () => {
        if (cancelled) return;
        // An earlier list stays on screen: one failed refresh says nothing about what it showed.
        setState((prev) =>
          prev.projectId === projectId && prev.benchmarks !== null
            ? prev
            : { projectId, benchmarks: null, failed: true },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  // A Project switch without a remount shows that Project's cached list until its read lands.
  if (state.projectId !== projectId) {
    return { benchmarks: benchmarkLists.get(projectId) ?? null, failed: false };
  }
  return { benchmarks: state.benchmarks, failed: state.failed };
}
