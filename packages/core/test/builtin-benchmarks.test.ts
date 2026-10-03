/**
 * The built-in Benchmarks, as a new Project's provisioning writes them.
 *
 * - A new Project's benchmarks/ holds the example and five published built-ins, each with one
 *   run per case, no evaluations and at least one case, and no staging left behind.
 * - Every built-in's config is a plain Benchmark config: title, description, runs and status,
 *   nothing that marks how its cases run.
 * - Every case is one Harbor task: its directory names the task after `CASE-NNN-` within the
 *   API's id rules; its statement links the task's folder in the repository, the repository's
 *   rules for running a task and the measured results, and launches that same task with its
 *   caps — the no-network line only for deep-swe, the shared-network line only for
 *   terminal-bench and terminal-bench-science, as the repository's rules allow; its rubric is
 *   worth 100 points.
 * - The five list in Sec A to Sec E order, and each description opens by naming the original
 *   benchmark its cases cite as their source.
 * - Provisioning again writes nothing; a directory already under an id, built-in or the
 *   example, is left exactly as it is.
 * - A write that fails part-way leaves neither its directory nor staging debris, and the error
 *   reaches the caller.
 * - Initializing or loading default_agent never writes into benchmarks/.
 * - Release guard: every statement links the repository at a commit. Expected to fail until the
 *   results commit is pinned, at which point it turns into a plain test.
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
  type BuiltinBenchmark,
} from "../src/state/index.js";
import { BUILTIN_BENCHMARKS } from "../src/state/builtin-benchmarks-data.js";

const BUILTIN_IDS = [
  "penguinharness-benchmark-sec-a",
  "penguinharness-benchmark-sec-b",
  "penguinharness-benchmark-sec-c",
  "penguinharness-benchmark-sec-d",
  "penguinharness-benchmark-sec-e",
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
  it("a new Project's benchmarks/ holds the example and five published built-ins, each with one run per case, no evaluations and at least one case", async () => {
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

  it("every built-in's config is a plain Benchmark config: title, description, runs, status and nothing else", async () => {
    await provision();

    for (const id of BUILTIN_IDS) {
      expect(Object.keys(await readConfig(id)).sort(), id).toEqual([
        "description",
        "runs",
        "status",
        "title",
      ]);
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
        // The repository's rules for running a task, and its measured results.
        expect(statement, caseId).toMatch(
          /https:\/\/\S+\/blob\/[^/\s]+\/README\.md#running-a-task-for-agents/,
        );
        expect(statement, caseId).toMatch(/https:\/\/\S+\/blob\/[^/\s]+\/results\/\S+/);
        // The network lines the repository's rules call for, and only those.
        expect(statement.includes("--allow-agent-host "), caseId).toBe(repoDir === "deep-swe");
        expect(
          statement.includes("--extra-docker-compose tools/docker/shared-network.yaml"),
          caseId,
        ).toBe(repoDir === "terminal-bench" || repoDir === "terminal-bench-science");

        const rubric = await readCase(bench.id, caseId, "rubric");
        const points = [...rubric.matchAll(/^- (\d+) pts:/gm)].map((m) => Number(m[1]));
        expect(
          points.reduce((a, b) => a + b, 0),
          caseId,
        ).toBe(100);
      }
    }
  });

  it("the five list in Sec A to Sec E order, each description naming the original benchmark its cases cite", async () => {
    await provision();

    const listed = (await entries()).filter((id) => id !== EXAMPLE_BENCHMARK_ID);
    const letters: string[] = [];
    for (const id of listed) {
      const { title, description } = await readConfig(id);
      const named = /^Sec ([A-Z]) is ([^:]+):/.exec(String(description));
      expect(named, id).not.toBeNull();
      const [, letter, original] = named!;
      expect(String(title), id).toMatch(new RegExp(`Sec ${letter}$`));
      // Every case statement cites the same original as its source.
      const firstWord = (text: string) => text.split(/[\s,(]/)[0];
      for (const caseId of await caseIds(id)) {
        const source = /^- Benchmark: .+? — (.+?) · Category: /m.exec(
          await readCase(id, caseId, "statement"),
        )?.[1];
        expect(firstWord(source ?? ""), caseId).toBe(firstWord(original!));
      }
      letters.push(letter!);
    }
    expect(letters.join("")).toBe("ABCDE");
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

  // Release guard: flip `it.fails` to `it` in the change that pins the results commit.
  it.fails(
    "release guard: every statement links the repository at a commit (expected to fail until the results commit is pinned)",
    async () => {
      await provision();
      for (const id of BUILTIN_IDS) {
        for (const caseId of await caseIds(id)) {
          const statement = await readCase(id, caseId, "statement");
          const taskLine = statement.split("\n").find((line) => line.startsWith("- Task: "));
          expect(taskLine, caseId).toMatch(/\/tree\/[0-9a-f]{40}\//);
          const runRules = /\S+#running-a-task-for-agents/.exec(statement)?.[0];
          const results = /\S+\/results\/\S+/.exec(statement)?.[0];
          expect(runRules, caseId).toMatch(/\/blob\/[0-9a-f]{40}\//);
          expect(results, caseId).toMatch(/\/blob\/[0-9a-f]{40}\//);
        }
      }
    },
  );
});
