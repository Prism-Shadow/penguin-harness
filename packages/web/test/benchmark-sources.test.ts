/**
 * The Evaluation Center's reads over this server and the machines it holds
 * (features/benchmark/benchmark-sources.ts), against the fetch fake.
 *
 * - Given machines, this server is asked first and its Benchmarks are listed as soon as it
 *   answers; the machines are asked after that, and a machine's Benchmark joins when it answers.
 * - Given Benchmarks on screen, asking again as another machine connects keeps them on screen
 *   while the sources are asked; a machine that leaves the set takes its Benchmarks with it.
 * - Given this server failing and no machine answering, the read reports this server's failure.
 * - Given a Benchmark's copies, its Cases are listed with the first copy to answer, and a copy
 *   still out never holds them back.
 */
import { describe, expect, it } from "vitest";
import type { BenchmarkSummary } from "@prismshadow/penguin-server/api";
import { BenchmarkSources, watchBenchmarkCases } from "../src/features/benchmark/benchmark-sources";
import type { BenchmarksView, CasesView } from "../src/features/benchmark/benchmark-sources";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FetchRequest } from "./helpers/fetch";

const bench = (id: string): BenchmarkSummary => ({
  id,
  title: id,
  status: "published",
  runs: 1,
  caseCount: 1,
  evaluations: [],
  agentIds: [],
});

/** Each source's Benchmarks; a source in `held` answers only when released. */
function world(lists: Record<string, BenchmarkSummary[]>, failing: string[] = []) {
  const held = new Map<string, Array<() => void>>();
  const answer = (request: FetchRequest) => {
    const source = request.machine ?? "here";
    if (failing.includes(source)) return apiError(500, "internal");
    if (request.path.endsWith("/cases")) {
      return json({
        cases: (lists[source] ?? []).map((b) => ({ id: `${source}-${b.id}`, title: source })),
      });
    }
    return json({ benchmarks: lists[source] ?? [] });
  };
  const fetch = stubFetch((request) => {
    const source = request.machine ?? "here";
    const queue = held.get(source);
    if (queue === undefined) return answer(request);
    return new Promise<Response>((resolve) => queue.push(() => resolve(answer(request))));
  });
  return {
    fetch,
    hold: (source: string) => held.set(source, []),
    release: (source: string) => {
      const queue = held.get(source) ?? [];
      held.delete(source);
      for (const go of queue) go();
    },
  };
}

const ids = (view: BenchmarksView | undefined) => view?.benchmarks?.map((b) => b.id) ?? null;

/** Lets the fake's answers and the reads behind them settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the Project's Benchmarks", () => {
  it("asks this server first and lists its own as soon as it answers; a machine's joins after", async () => {
    const w = world({ here: [bench("local")], M1: [bench("remote")] });
    w.hold("here");
    w.hold("M1");
    const views: BenchmarksView[] = [];
    const sources = new BenchmarkSources("p", (view) => views.push(view));
    sources.read(["M1"]);
    await settle();
    expect(ids(views.at(-1))).toBeNull();
    expect(w.fetch.requests.filter((r) => r.machine === "M1")).toHaveLength(0);

    w.release("here");
    await settle();
    expect(ids(views.at(-1))).toEqual(["local"]);
    expect(views.at(-1)?.pending).toEqual(["M1"]);

    w.release("M1");
    await settle();
    expect(ids(views.at(-1))).toEqual(["local", "remote"]);
    expect(views.at(-1)?.pending).toEqual([]);
  });

  it("keeps what is on screen while it asks again, and drops a machine that left", async () => {
    const w = world({ here: [bench("local")], M1: [bench("remote")], M2: [bench("other")] });
    const views: BenchmarksView[] = [];
    const sources = new BenchmarkSources("p", (view) => views.push(view));
    sources.read(["M1"]);
    await settle();
    expect(ids(views.at(-1))).toEqual(["local", "remote"]);

    w.hold("here");
    w.hold("M1");
    const before = views.length;
    sources.read(["M1", "M2"]);
    await settle();
    expect(views.slice(before).every((view) => ids(view)?.join() === "local,remote")).toBe(true);
    w.release("here");
    await settle();
    expect(ids(views.at(-1))).toEqual(["local", "remote", "other"]);

    sources.read(["M2"]);
    expect(ids(views.at(-1))).toEqual(["local", "other"]);
  });

  it("reports this server's failure once no source answered", async () => {
    world({}, ["here"]);
    const views: BenchmarksView[] = [];
    new BenchmarkSources("p", (view) => views.push(view)).read([]);
    await settle();
    expect(views.at(-1)?.benchmarks).toBeNull();
    expect(views.at(-1)?.error).not.toBeNull();
  });
});

describe("a Benchmark's Cases", () => {
  it("are listed with the first copy to answer, while another copy is still out", async () => {
    const w = world({ here: [bench("b")], M1: [bench("b")] });
    w.hold("M1");
    const views: CasesView[] = [];
    watchBenchmarkCases("p", { id: "b", machineIds: [null, "M1"] }, (view) => views.push(view));
    await settle();
    expect(views.at(-1)?.cases?.map((c) => c.machineId)).toEqual([null]);
    w.release("M1");
    await settle();
    expect(views.at(-1)?.cases?.map((c) => c.machineId)).toEqual([null, "M1"]);
  });
});
