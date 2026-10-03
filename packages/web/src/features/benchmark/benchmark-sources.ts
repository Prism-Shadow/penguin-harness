/**
 * The Evaluation Center's reads, fanned out over this server and every machine it holds.
 *
 * This server is asked first and what it holds renders the moment it answers; the machines are
 * asked after that, and each one's answer joins the merge when it comes. A machine that holds its
 * connection but answers nothing — the network behind it went quiet, or its server is stuck —
 * must not keep this server's Benchmarks behind a skeleton for as long as its calls take to time
 * out. A machine that cannot answer is left out rather than failing the read: its
 * scoreboard is missing from the merge, which is what "could not read it" means. Only when NO
 * source answered is there an error to report.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BenchmarkCaseSummary, BenchmarkSummary } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { mergeBenchmarkCases, mergeBenchmarks } from "../../lib/benchmark-merge";
import type { MergedBenchmark, MergedCase } from "../../lib/benchmark-merge";

/** The Project's Benchmarks as far as the sources have answered. */
export interface BenchmarksView {
  /**
   * Every answer in hand, merged (this server's first); null until this server has answered —
   * or, when it failed, until a machine has, or every source is done.
   */
  benchmarks: MergedBenchmark[] | null;
  /** Why this server could not be read, once no source answered and none is still out. */
  error: unknown;
  /** Machines asked whose answer has not landed yet. */
  pending: string[];
}

const NOTHING_YET: BenchmarksView = { benchmarks: null, error: null, pending: [] };

/**
 * One Project's Benchmark reads, kept across re-reads. A source keeps its last answer while it is
 * asked again — after another machine connects, or a delete that leaves a machine's copy behind —
 * so the merged history never shrinks and grows back; a machine that leaves the set takes its
 * answer with it; and a late answer never replaces a newer one.
 */
export class BenchmarkSources {
  readonly #projectId: string;
  readonly #onChange: (view: BenchmarksView) => void;
  #machineIds: string[] = [];
  readonly #answers = new Map<string | null, BenchmarkSummary[]>();
  /** Each source's newest ask; an answer to an older one is dropped. */
  readonly #asks = new Map<string | null, number>();
  readonly #out = new Set<string | null>();
  #hereFailure: unknown = null;
  #seq = 0;
  #disposed = false;

  constructor(projectId: string, onChange: (view: BenchmarksView) => void) {
    this.#projectId = projectId;
    this.#onChange = onChange;
  }

  /** Asks this server and `machineIds` again. */
  read(machineIds: readonly string[]): void {
    this.#machineIds = [...machineIds];
    for (const source of [...this.#answers.keys(), ...this.#out]) {
      if (source !== null && !this.#machineIds.includes(source)) {
        this.#answers.delete(source);
        this.#out.delete(source);
      }
    }
    const asks = new Map<string | null, number>();
    for (const source of [null, ...this.#machineIds]) {
      asks.set(source, ++this.#seq);
      this.#asks.set(source, asks.get(source)!);
      this.#out.add(source);
    }
    this.#report();
    // The machines once this server has answered, unless a newer read has asked them since.
    void this.#ask(null, asks.get(null)!).then(() => {
      for (const machineId of this.#machineIds) {
        const ask = asks.get(machineId);
        if (ask !== undefined && this.#asks.get(machineId) === ask) void this.#ask(machineId, ask);
      }
    });
  }

  #ask(source: string | null, ask: number): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    return api.listBenchmarks(this.#projectId, source).then(
      (res) => this.#land(source, ask, () => this.#answers.set(source, res.benchmarks)),
      (err: unknown) =>
        this.#land(source, ask, () => {
          if (source === null) this.#hereFailure = err;
        }),
    );
  }

  /** Takes a Benchmark this server deleted out of its answer, without asking again. */
  removeHere(benchmarkId: string): void {
    const here = this.#answers.get(null);
    if (here === undefined) return;
    this.#answers.set(
      null,
      here.filter((b) => b.id !== benchmarkId),
    );
    this.#report();
  }

  /** Stops reporting: the page left the Project. */
  dispose(): void {
    this.#disposed = true;
  }

  view(): BenchmarksView {
    const sources = [null, ...this.#machineIds];
    const answered = sources.flatMap((machineId) => {
      const benchmarks = this.#answers.get(machineId);
      return benchmarks === undefined ? [] : [{ machineId, benchmarks }];
    });
    const pending = this.#machineIds.filter((machineId) => this.#out.has(machineId));
    const hereAnswered = this.#answers.has(null);
    const hereOut = this.#out.has(null);
    if (!hereAnswered && (hereOut || (answered.length === 0 && pending.length > 0))) {
      return { benchmarks: null, error: null, pending };
    }
    if (answered.length === 0) return { benchmarks: null, error: this.#hereFailure, pending };
    return { benchmarks: mergeBenchmarks(answered), error: null, pending };
  }

  #land(source: string | null, ask: number, apply: () => void): void {
    if (this.#disposed || this.#asks.get(source) !== ask) return;
    this.#out.delete(source);
    apply();
    this.#report();
  }

  #report(): void {
    if (!this.#disposed) this.#onChange(this.view());
  }
}

/**
 * The Project's Benchmarks as this server and the given machines hold them, merged as each
 * answers. A new Project starts over; a change of machines or of `reloadKey` asks again with
 * what is on screen kept. `removeHere` drops a Benchmark this server deleted.
 */
export function useBenchmarksAcross(
  projectId: string | null,
  machineIds: readonly string[],
  reloadKey = 0,
): BenchmarksView & { removeHere: (benchmarkId: string) => void } {
  const [view, setView] = useState<BenchmarksView>(NOTHING_YET);
  const sources = useRef<BenchmarkSources | null>(null);
  useEffect(() => {
    setView(NOTHING_YET);
    if (projectId === null) return;
    const next = new BenchmarkSources(projectId, setView);
    sources.current = next;
    return () => {
      next.dispose();
      if (sources.current === next) sources.current = null;
    };
  }, [projectId]);
  const machinesKey = machineIds.join(",");
  useEffect(() => {
    sources.current?.read(machinesKey === "" ? [] : machinesKey.split(","));
  }, [projectId, machinesKey, reloadKey]);
  const removeHere = useCallback((benchmarkId: string) => {
    sources.current?.removeHere(benchmarkId);
  }, []);
  return { ...view, removeHere };
}

/** One Benchmark's Cases as far as its copies have answered. */
export interface CasesView {
  /** The Cases every copy that answered holds, merged; null until one has answered. */
  cases: MergedCase[] | null;
  /** Why the first copy could not be read, once every copy failed. */
  error: unknown;
}

/**
 * One Benchmark's Cases from the servers that hold a copy of it — this server first when it holds
 * one, the machines after it answers — merged as each answers, the first source winning a shared
 * id. Returns a function that stops the reports.
 */
export function watchBenchmarkCases(
  projectId: string,
  benchmark: Pick<MergedBenchmark, "id" | "machineIds">,
  onChange: (view: CasesView) => void,
): () => void {
  const sources = [...benchmark.machineIds];
  const answers = new Map<string | null, readonly BenchmarkCaseSummary[]>();
  const failures = new Map<string | null, unknown>();
  let live = true;
  const report = () => {
    if (!live) return;
    const answered = sources.flatMap((machineId) => {
      const cases = answers.get(machineId);
      return cases === undefined ? [] : [{ machineId, cases }];
    });
    if (answered.length > 0) {
      onChange({ cases: mergeBenchmarkCases(answered), error: null });
    } else if (failures.size === sources.length && sources.length > 0) {
      onChange({ cases: null, error: failures.get(sources[0]!) });
    }
  };
  const ask = (machineId: string | null): Promise<void> =>
    live
      ? api.listBenchmarkCases(projectId, benchmark.id, machineId).then(
          (res) => {
            answers.set(machineId, res.cases);
            report();
          },
          (err: unknown) => {
            failures.set(machineId, err);
            report();
          },
        )
      : Promise.resolve();
  const machines = sources.filter((machineId) => machineId !== null);
  const askMachines = () => {
    for (const machineId of machines) void ask(machineId);
  };
  if (sources.includes(null)) void ask(null).then(askMachines);
  else askMachines();
  return () => {
    live = false;
  };
}
