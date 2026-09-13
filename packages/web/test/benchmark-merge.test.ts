/**
 * benchmark-merge.ts unit tests: one Agent's Benchmarks read off several machines and folded
 * into one list. The Agent is one identity, so the merge is by benchmark id — the machine is
 * attribution (which scoreboard recorded a round, whose disk holds a Case's files), never a
 * grouping key. The order rule is the subtle one: a single scoreboard keeps the append order
 * it was written in, and only a history joined from two disks is ordered by time.
 */
import { describe, expect, it } from "vitest";
import type { BenchmarkEvaluation, BenchmarkSummary } from "@prismshadow/penguin-server/api";
import { mergeAgents, mergeBenchmarks, mergeBenchmarkCases } from "../src/lib/benchmark-merge";

const MACHINE = "noeSE0FFHhNXl2J5";

const evaluation = (time: string, over: Partial<BenchmarkEvaluation> = {}): BenchmarkEvaluation =>
  ({
    time,
    modelId: "claude-4-8",
    provider: "custom",
    thinkingLevel: "medium",
    version: 1,
    score: 80,
    cost: null,
    durationMs: 1000,
    cases: [],
    ...over,
  }) as BenchmarkEvaluation;

const benchmark = (id: string, over: Partial<BenchmarkSummary> = {}): BenchmarkSummary =>
  ({
    id,
    title: id,
    caseCount: 2,
    evaluations: [],
    ...over,
  }) as BenchmarkSummary;

describe("mergeBenchmarks", () => {
  it("folds one benchmark id into one entry, recording every machine that holds it", () => {
    const merged = mergeBenchmarks([
      {
        machineId: null,
        benchmarks: [benchmark("example", { evaluations: [evaluation("2026-09-01T00:00:00Z")] })],
      },
      {
        machineId: MACHINE,
        benchmarks: [benchmark("example", { evaluations: [evaluation("2026-09-02T00:00:00Z")] })],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.machineIds).toEqual([null, MACHINE]);
    expect(merged[0]!.evaluations.map((e) => e.machineId)).toEqual([null, MACHINE]);
  });

  it("orders a joined history by time — two scoreboards share no append order", () => {
    const merged = mergeBenchmarks([
      {
        machineId: null,
        benchmarks: [
          benchmark("example", {
            evaluations: [evaluation("2026-09-01T00:00:00Z"), evaluation("2026-09-03T00:00:00Z")],
          }),
        ],
      },
      {
        machineId: MACHINE,
        benchmarks: [benchmark("example", { evaluations: [evaluation("2026-09-02T00:00:00Z")] })],
      },
    ]);
    expect(merged[0]!.evaluations.map((e) => e.time)).toEqual([
      "2026-09-01T00:00:00Z",
      "2026-09-02T00:00:00Z",
      "2026-09-03T00:00:00Z",
    ]);
  });

  it("leaves a single machine's scoreboard in its written order, timestamps or not", () => {
    // The append order IS the evaluation sequence: re-sorting it would reorder Agent versions
    // on the strength of a timestamp the file may not even have got right.
    const merged = mergeBenchmarks([
      {
        machineId: null,
        benchmarks: [
          benchmark("example", {
            evaluations: [
              evaluation("2026-09-05T00:00:00Z", { version: 1 }),
              evaluation("2026-09-01T00:00:00Z", { version: 2 }),
            ],
          }),
        ],
      },
    ]);
    expect(merged[0]!.evaluations.map((e) => e.version)).toEqual([1, 2]);
  });

  it("keeps the first source's description and the largest case count", () => {
    const merged = mergeBenchmarks([
      {
        machineId: null,
        benchmarks: [benchmark("example", { title: "Here", runs: 3, caseCount: 2 })],
      },
      {
        machineId: MACHINE,
        benchmarks: [benchmark("example", { title: "There", runs: 9, caseCount: 5 })],
      },
    ]);
    expect(merged[0]).toMatchObject({ title: "Here", runs: 3, caseCount: 5 });
  });

  it("lists a benchmark only a machine has, after this server's own", () => {
    const merged = mergeBenchmarks([
      { machineId: null, benchmarks: [benchmark("here")] },
      { machineId: MACHINE, benchmarks: [benchmark("there")] },
    ]);
    expect(merged.map((b) => b.id)).toEqual(["here", "there"]);
    expect(merged[1]!.machineIds).toEqual([MACHINE]);
    expect(mergeBenchmarks([])).toEqual([]);
  });

  it("never mutates the answers it was given", () => {
    const mine = benchmark("example", { evaluations: [evaluation("2026-09-01T00:00:00Z")] });
    mergeBenchmarks([
      { machineId: null, benchmarks: [mine] },
      {
        machineId: MACHINE,
        benchmarks: [benchmark("example", { evaluations: [evaluation("2026-09-02T00:00:00Z")] })],
      },
    ]);
    expect(mine.evaluations).toHaveLength(1);
    expect(mine.evaluations[0]).not.toHaveProperty("machineId");
  });
});

describe("mergeAgents", () => {
  const agent = (agentId: string, name?: string) =>
    ({ agentId, ...(name === undefined ? {} : { name }) }) as never;

  it("lists an Agent only a machine has — its Benchmarks had no row to hang off", () => {
    const merged = mergeAgents([
      { machineId: null, agents: [agent("default_agent")] },
      { machineId: MACHINE, agents: [agent("default_agent"), agent("revival_worker")] },
    ]);
    expect(merged.map((m) => [m.agent.agentId, m.machineIds])).toEqual([
      ["default_agent", [null, MACHINE]],
      ["revival_worker", [MACHINE]],
    ]);
  });

  it("keeps the first source's description of a shared Agent", () => {
    const merged = mergeAgents([
      { machineId: null, agents: [agent("default_agent", "Here")] },
      { machineId: MACHINE, agents: [agent("default_agent", "There")] },
    ]);
    expect(merged[0]!.agent.name).toBe("Here");
    expect(mergeAgents([])).toEqual([]);
  });
});

describe("mergeBenchmarkCases", () => {
  it("takes the union, first source winning a shared id, and records where each is read from", () => {
    const merged = mergeBenchmarkCases([
      {
        machineId: null,
        cases: [
          { id: "case-1", title: "Here" },
          { id: "case-2", title: "Only here" },
        ],
      },
      {
        machineId: MACHINE,
        cases: [
          { id: "case-1", title: "There" },
          { id: "case-3", title: "Only there" },
        ],
      },
    ]);
    expect(merged.map((c) => [c.id, c.title, c.machineId])).toEqual([
      ["case-1", "Here", null],
      ["case-2", "Only here", null],
      ["case-3", "Only there", MACHINE],
    ]);
  });
});
