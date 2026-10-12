/**
 * The built-in Benchmarks, as a new Project's provisioning writes them.
 *
 * - A new Project's benchmarks/ holds the example and seven published built-ins, each with one
 *   run per case, no evaluations and at least one case, and no staging left behind; each is
 *   written in the package format, a benchmark_config.toml that names its id, a date version and
 *   origin `builtin`, and that the manifest reader takes as written.
 * - Every built-in's manifest is a plain Benchmark manifest: its id, title, description, a date
 *   version, status, runs and origin `builtin`, nothing that marks how its cases run.
 * - Every case is one Harbor task: its directory names the task after `CASE-NNN-` within the
 *   API's id rules; its statement links the task's folder in the repository, the repository's
 *   rules for running a task and, where the repository has them, the measured results, and
 *   launches that same task with its caps — the time-budget sentence word for word where the
 *   benchmark's measured runs told the agent its budget, the no-network line only for deep-swe
 *   and GDPevo (whose gold answers are public), and the shared-network line for every other
 *   benchmark, whose tasks have a public agent phase, as the repository's rules allow; its
 *   rubric is worth 100 points.
 * - The Secs list in A to E order, each description opening by naming the original benchmark;
 *   every built-in's description names the original its cases cite as their source.
 * - GDPevo Train and GDPevo Test are one task directory split in two: the train Benchmark holds
 *   only train tasks, the test Benchmark only test tasks, no task is in both, and every task
 *   group the test Benchmark draws on is one the train Benchmark trains on.
 * - Provisioning again writes nothing; a directory already under an id, built-in or the
 *   example, is left exactly as it is.
 * - A write that fails part-way leaves neither its directory nor staging debris, and the error
 *   reaches the caller.
 * - Initializing or loading default_agent never writes into benchmarks/.
 * - Release guard: every link into the repository, and the checkout every launch runs from, is at
 *   a commit, never a branch.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import {
  DEFAULT_PROJECT_ID,
  EXAMPLE_BENCHMARK_ID,
  benchmarksDir,
  isValidId,
  loadAgentState,
  provisionProjectBenchmarks,
  readBenchmarkManifest,
  type BuiltinBenchmark,
} from "../src/state/index.js";
import { BUILTIN_BENCHMARKS } from "../src/state/builtin-benchmarks-data.js";

const BUILTIN_IDS = [
  "penguinharness-benchmark-sec-a",
  "penguinharness-benchmark-sec-b",
  "penguinharness-benchmark-sec-c",
  "penguinharness-benchmark-sec-d",
  "penguinharness-benchmark-sec-e",
  "penguinharness-benchmark-gdpevo-train",
  "penguinharness-benchmark-gdpevo-test",
];

let tmpRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-builtin-bench-"));
  process.env.PENGUIN_HOME = tmpRoot;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const GDPEVO_TRAIN = "penguinharness-benchmark-gdpevo-train";
const GDPEVO_TEST = "penguinharness-benchmark-gdpevo-test";

const dir = () => benchmarksDir(tmpRoot, DEFAULT_PROJECT_ID);
const provision = (builtins?: readonly BuiltinBenchmark[]) =>
  provisionProjectBenchmarks(tmpRoot, DEFAULT_PROJECT_ID, builtins);
const byName = (a: string, b: string) => a.localeCompare(b);
/** `text` as a literal inside a regular expression. */
const quote = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** The Benchmark's benchmark_config.toml, as the file holds it. */
async function readConfig(benchmarkId: string): Promise<Record<string, unknown>> {
  return parseToml(
    await fs.readFile(path.join(dir(), benchmarkId, "benchmark_config.toml"), "utf8"),
  ) as Record<string, unknown>;
}

/** Every entry under `benchmarks/`, staging included, in listing order. */
async function entries(): Promise<string[]> {
  return (await fs.readdir(dir())).sort(byName);
}

async function caseIds(benchmarkId: string): Promise<string[]> {
  return (await fs.readdir(path.join(dir(), benchmarkId)))
    .filter((n) => n.startsWith("CASE-"))
    .sort(byName);
}

async function readCase(benchmarkId: string, caseId: string, part: "statement" | "rubric") {
  return fs.readFile(path.join(dir(), benchmarkId, caseId, part, "README.md"), "utf8");
}

/** Every file under `root`, relative path → content and modification time. */
async function tree(root: string): Promise<Map<string, { text: string; mtimeMs: number }>> {
  const out = new Map<string, { text: string; mtimeMs: number }>();
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    out.set(path.relative(root, file), {
      text: await fs.readFile(file, "utf8"),
      mtimeMs: (await fs.stat(file)).mtimeMs,
    });
  }
  return out;
}

/** Backdates every file under `root`, so that any later write shows in its mtime. */
async function backdate(root: string): Promise<void> {
  const past = new Date("2001-01-01T00:00:00Z");
  for (const file of (await tree(root)).keys()) await fs.utimes(path.join(root, file), past, past);
}

describe("built-in Benchmarks", () => {
  it("a new Project's benchmarks/ holds the example and seven published built-ins, each with one run per case, no evaluations and at least one case", async () => {
    await provision();

    expect(await entries()).toEqual([EXAMPLE_BENCHMARK_ID, ...BUILTIN_IDS].sort(byName));
    for (const id of BUILTIN_IDS) {
      const config = await readConfig(id);
      expect(config.status, id).toBe("published");
      expect(Number(config.runs), id).toBe(1);
      const scoreboard = parseYaml(
        await fs.readFile(path.join(dir(), id, "scoreboard.yaml"), "utf8"),
      ) as { evaluations: unknown[] };
      expect(scoreboard.evaluations, id).toEqual([]);
      expect((await caseIds(id)).length, id).toBeGreaterThan(0);
    }
  });

  it("every Benchmark a new Project starts with is written in the package format, which the manifest reader takes as written", async () => {
    await provision();

    for (const id of [EXAMPLE_BENCHMARK_ID, ...BUILTIN_IDS]) {
      const manifest = await readBenchmarkManifest(path.join(dir(), id));
      expect(manifest?.id, id).toBe(id);
      expect(manifest?.version, id).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
      expect(manifest?.origin, id).toEqual({ kind: "builtin" });
      // The file spells the Chinese description `description_zh`; the reader calls it descriptionZh.
      const { descriptionZh, ...rest } = manifest!;
      expect(await readConfig(id), id).toEqual({
        ...rest,
        ...(descriptionZh !== undefined ? { description_zh: descriptionZh } : {}),
      });
    }
  });

  it("every built-in's manifest is a plain Benchmark manifest, seeded as builtin, with nothing that marks how its cases run", async () => {
    await provision();

    for (const id of BUILTIN_IDS) {
      const config = await readConfig(id);
      expect(Object.keys(config).sort(), id).toEqual([
        "description",
        "description_zh",
        "id",
        "origin",
        "runs",
        "status",
        "title",
        "version",
      ]);
      expect(config.origin, id).toEqual({ kind: "builtin" });
    }
  });

  it("every case names one Harbor task: its statement links that task's folder and the repository's run rules, and launches that same task with its caps; its rubric is worth 100 points", async () => {
    await provision();

    for (const bench of BUILTIN_BENCHMARKS) {
      const ids = await caseIds(bench.id);
      expect(ids.length, bench.id).toBeGreaterThan(0);
      for (const caseId of ids) {
        expect(isValidId(caseId), caseId).toBe(true);
        const task = /^CASE-\d{3}-(.+)$/.exec(caseId)?.[1] ?? "";
        expect(task, caseId).not.toBe("");
        const statement = await readCase(bench.id, caseId, "statement");
        expect(statement, caseId).toMatch(/^# \S/);

        // The launch runs this task, from its benchmark's folder in the repository.
        const launch = /harbor run -p (benchmarks\/([^/\s]+)\/tasks) -i (\S+) /.exec(statement);
        expect(launch?.[3], caseId).toBe(task);
        const [, taskFolder, repoDir] = launch!;
        expect(statement, caseId).toMatch(
          new RegExp(
            `^- Task: \`${quote(task)}\` in https://\\S+/tree/[^/\\s]+/${quote(`${taskFolder}/${task}`)}$`,
            "m",
          ),
        );
        expect(statement, caseId).toContain(
          `--ak run_timeout=${bench.runTimeout} --ak max_turns=${bench.maxTurns} `,
        );
        // The time budget the measured runs told the agent, as one shell word, and only there.
        const budget = /^ {2}--ak time_budget_note='([^']*)' \\$/m.exec(statement)?.[1];
        expect(budget, caseId).toBe(bench.timeBudgetNote);
        // The repository's rules for running a task, and its measured results where it has them.
        expect(statement, caseId).toMatch(
          /https:\/\/\S+\/blob\/[^/\s]+\/README\.md#running-a-task-for-agents/,
        );
        expect(/https:\/\/\S+\/blob\/[^/\s]+\/results\/\S+/.test(statement), caseId).toBe(
          bench.results !== undefined,
        );
        // The network lines the repository's rules call for, and only those: a no-network
        // benchmark allows its model's host and never joins the shared network, which every
        // task with a public agent phase joins. GDPevo's gold answers are public, so its agent
        // phase must not reach the internet.
        const offline = repoDir === "deep-swe" || repoDir === "gdpevo";
        expect(statement.includes("--allow-agent-host "), caseId).toBe(offline);
        expect(
          statement.includes("--extra-docker-compose tools/docker/shared-network.yaml"),
          caseId,
        ).toBe(!offline);

        const rubric = await readCase(bench.id, caseId, "rubric");
        const points = [...rubric.matchAll(/^- (\d+) pts:/gm)].map((m) => Number(m[1]));
        expect(
          points.reduce((a, b) => a + b, 0),
          caseId,
        ).toBe(100);
      }
    }
  });

  it("the Secs list in A to E order, and every description names the original benchmark its cases cite", async () => {
    await provision();

    const firstWord = (text: string) => text.split(/[\s,(]/)[0]!;
    const letters: string[] = [];
    for (const id of BUILTIN_IDS) {
      const { title, description } = await readConfig(id);
      const named = /^Sec ([A-Z]) is ([^:]+):/.exec(String(description));
      if (/-sec-[a-z]$/.test(id)) {
        expect(named, id).not.toBeNull();
        expect(String(title), id).toMatch(new RegExp(`Sec ${named![1]}$`));
        letters.push(named![1]!);
      }
      // Every case statement cites as its source an original the description names.
      for (const caseId of await caseIds(id)) {
        const source = /^- Benchmark: .+? — (.+?) · Category: /m.exec(
          await readCase(id, caseId, "statement"),
        )?.[1];
        expect(String(description), caseId).toContain(firstWord(source ?? ""));
      }
    }
    expect(letters.join("")).toBe("ABCDE");
  });

  it("GDPevo Train and GDPevo Test split one task directory: train tasks to optimize on, held-out test tasks of the same groups to evaluate on", async () => {
    await provision();

    /** Each case's Harbor task, `tg<group>-<split>-<n>`, and the folder its launch runs it from. */
    const tasks = async (id: string) =>
      Promise.all(
        (await caseIds(id)).map(async (caseId) => {
          const statement = await readCase(id, caseId, "statement");
          const [, folder, task] = /harbor run -p (\S+) -i (\S+) /.exec(statement)!;
          const [, group, split] = /^(tg\d+)-(train|test)-\d+$/.exec(task!) ?? [];
          return { folder, task, group, split };
        }),
      );
    const train = await tasks(GDPEVO_TRAIN);
    const test = await tasks(GDPEVO_TEST);

    expect(new Set([...train, ...test].map((t) => t.folder))).toEqual(
      new Set(["benchmarks/gdpevo/tasks"]),
    );
    expect(new Set(train.map((t) => t.split))).toEqual(new Set(["train"]));
    expect(new Set(test.map((t) => t.split))).toEqual(new Set(["test"]));
    const trainTasks = new Set(train.map((t) => t.task));
    expect(test.filter((t) => trainTasks.has(t.task))).toEqual([]);
    const trainGroups = new Set(train.map((t) => t.group));
    expect(test.filter((t) => !trainGroups.has(t.group))).toEqual([]);
  });

  it("provisioning again writes nothing", async () => {
    await provision();
    await backdate(dir());
    const before = await tree(dir());

    await provision();

    expect(await tree(dir())).toEqual(before);
    expect(await entries()).toEqual([EXAMPLE_BENCHMARK_ID, ...BUILTIN_IDS].sort(byName));
  });

  it("leaves a directory already under a built-in or the example id exactly as it is", async () => {
    const mine = path.join(dir(), BUILTIN_IDS[0]!);
    const example = path.join(dir(), EXAMPLE_BENCHMARK_ID);
    await fs.mkdir(mine, { recursive: true });
    await fs.mkdir(example, { recursive: true });
    await fs.writeFile(path.join(mine, "benchmark_config.toml"), 'title = "mine"\n');
    await fs.writeFile(path.join(example, "scoreboard.yaml"), "evaluations:\n  - time: kept\n");
    await backdate(dir());
    const before = await tree(dir());

    await provision();

    const after = await tree(dir());
    for (const [file, stamp] of before) expect(after.get(file), file).toEqual(stamp);
    expect(await fs.readdir(mine)).toEqual(["benchmark_config.toml"]);
    expect(await fs.readdir(example)).toEqual(["scoreboard.yaml"]);
    for (const id of BUILTIN_IDS.slice(1))
      expect((await readConfig(id)).status, id).toBe("published");
  });

  it("a write that fails part-way leaves neither its directory nor staging debris, and the error reaches the caller", async () => {
    const [first, second] = BUILTIN_BENCHMARKS[0]!.cases;
    // A task name the filesystem refuses, after a case that writes fine.
    const broken: BuiltinBenchmark = {
      ...BUILTIN_BENCHMARKS[0]!,
      id: "broken-bench",
      cases: [first!, { ...second!, task: "bad\u0000task" }],
    };

    await expect(provision([...BUILTIN_BENCHMARKS, broken])).rejects.toThrow();

    expect(await exists(path.join(dir(), "broken-bench"))).toBe(false);
    expect(await exists(path.join(dir(), ".seeding"))).toBe(false);
  });

  it("initializing or loading default_agent never writes into benchmarks/", async () => {
    await fs.mkdir(dir(), { recursive: true });

    await loadAgentState({ init: {} });
    await loadAgentState();

    expect(await fs.readdir(dir())).toEqual([]);
  });

  // Release guard: a statement that links a branch would follow whatever that branch holds later.
  it("release guard: every link into the repository, and every launch's checkout, is at a commit", async () => {
    await provision();
    for (const id of BUILTIN_IDS) {
      for (const caseId of await caseIds(id)) {
        const statement = await readCase(id, caseId, "statement");
        const revisions = [
          ...statement.matchAll(/penguin-harness-benchmark\/(?:tree|blob)\/([^/\s]+)\//g),
        ].map((m) => m[1]);
        // The task's folder and the run rules at least.
        expect(revisions.length, caseId).toBeGreaterThanOrEqual(2);
        const checkout = /a checkout at commit `([^`]+)`/.exec(statement)?.[1];
        for (const revision of [...revisions, checkout]) {
          expect(revision, caseId).toMatch(/^[0-9a-f]{40}$/);
        }
      }
    }
  });
});
