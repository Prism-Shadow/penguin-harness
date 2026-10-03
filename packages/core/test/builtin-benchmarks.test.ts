/**
 * The built-in Harbor Benchmarks, as default_agent provisions them into a Project.
 *
 * - Given a new Project, when default_agent is initialized, five Harbor Benchmarks are written
 *   beside the example and recorded as given: published, one run per case, no evaluations, and a
 *   [harbor] table that names the benchmark repository, its ref and the task folder.
 * - Every case is one Harbor task: its directory names the task after `CASE-NNN-` within the
 *   API's id rules, its statement links into the repository at that ref and launches exactly
 *   that task, and its rubric is the verifier's reward, worth 100 points.
 * - Loading default_agent again rewrites nothing.
 * - A Project is given each one once: a deleted one stays deleted, and one the user changed is
 *   left exactly as the user left it.
 * - A release that adds a built-in gives a Project that already has the others just the new one.
 * - A Benchmark of the user's own that took a built-in id first is never written into; the
 *   built-in is given once that directory is gone.
 * - A write that fails part-way leaves neither a directory nor a record of it.
 * - Two processes provisioning one Project at once (the server and a CLI on one data root) keep
 *   each other's records: a Benchmark the other one placed between this one's check and its
 *   rename counts as given here too, so deleting it afterwards sticks.
 * - Staging debris an hour old is cleared; a younger entry, another process's Benchmark in the
 *   making, is left alone.
 * - An unreadable marker gives nothing, is left as it is, and is reported once however many
 *   loads read it.
 * - Release guard: what ships names the repository by a commit. Expected to fail until the
 *   results commit is pinned, at which point it turns into a plain test.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import {
  DEFAULT_PROJECT_ID,
  EXAMPLE_BENCHMARK_ID,
  SEEDED_BENCHMARKS_FILE,
  benchmarksDir,
  isValidId,
  loadAgentState,
  provisionProjectBenchmarks,
  type BuiltinBenchmark,
} from "../src/state/index.js";
import { BUILTIN_BENCHMARKS } from "../src/state/builtin-benchmarks-data.js";
import { provisionSeeds, type BenchmarkSeed } from "../src/state/project-benchmarks.js";

const BUILTIN_IDS = [
  "automation-bench",
  "deep-swe",
  "rag-bench-essential",
  "terminal-bench",
  "terminal-bench-science",
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

/** The ids the Project's marker records as given. */
async function given(): Promise<string[]> {
  const marker = JSON.parse(
    await fs.readFile(path.join(dir(), SEEDED_BENCHMARKS_FILE), "utf8"),
  ) as { seeded: string[] };
  return marker.seeded;
}

/** The Benchmark directories under `benchmarks/`. */
async function benchmarkDirs(): Promise<string[]> {
  const entries = await fs.readdir(dir(), { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
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

/**
 * A built-in seed writing one file that names who wrote it; `meanwhile` runs after that write and
 * before the rename, which is where a second process provisioning the Project can cut in.
 */
function seed(id: string, by: string, meanwhile?: () => Promise<void>): BenchmarkSeed {
  return {
    id,
    adoptExisting: false,
    write: async (benchDir) => {
      await fs.writeFile(path.join(benchDir, "benchmark_config.toml"), `title = "${by}"\n`);
      await meanwhile?.();
    },
  };
}

/** A built-in a later release might add: the first shipped one's shape, under a new id. */
function laterBuiltin(
  id: string,
  cases = BUILTIN_BENCHMARKS[0]!.cases.slice(0, 1),
): BuiltinBenchmark {
  return { ...BUILTIN_BENCHMARKS[0]!, id, title: `Later ${id}`, cases };
}

describe("built-in Harbor Benchmarks", () => {
  it("default_agent's initialization writes five published Harbor Benchmarks beside the example, recorded as given", async () => {
    await loadAgentState({ init: {} });

    const harborIds: string[] = [];
    for (const name of await benchmarkDirs()) {
      if ((await readConfig(name)).kind === "harbor") harborIds.push(name);
    }
    expect(harborIds).toEqual(BUILTIN_IDS);
    expect(await benchmarkDirs()).toContain(EXAMPLE_BENCHMARK_ID);
    expect((await given()).sort()).toEqual([...BUILTIN_IDS, EXAMPLE_BENCHMARK_ID].sort());

    for (const id of BUILTIN_IDS) {
      const config = await readConfig(id);
      expect(config.status).toBe("published");
      expect(Number(config.runs)).toBe(1);
      const harbor = config.harbor as Record<string, unknown>;
      expect(String(harbor.repo)).toMatch(/^https:\/\/github\.com\//);
      expect(String(harbor.ref)).not.toBe("");
      expect(harbor.path).toBe(`benchmarks/${id}/tasks`);
      const scoreboard = parseYaml(
        await fs.readFile(path.join(dir(), id, "scoreboard.yaml"), "utf8"),
      ) as { evaluations: unknown[] };
      expect(scoreboard.evaluations).toEqual([]);
    }
  });

  it("every case names one Harbor task, links into the repository at its ref and launches that task", async () => {
    await loadAgentState({ init: {} });

    for (const id of BUILTIN_IDS) {
      const harbor = (await readConfig(id)).harbor as Record<string, string>;
      const caseIds = (await fs.readdir(path.join(dir(), id))).filter((n) => n.startsWith("CASE-"));
      expect(caseIds.length, id).toBeGreaterThan(0);
      for (const caseId of caseIds) {
        expect(isValidId(caseId), caseId).toBe(true);
        const task = /^CASE-\d{3}-(.+)$/.exec(caseId)?.[1] ?? "";
        expect(task, caseId).not.toBe("");
        const statement = await fs.readFile(
          path.join(dir(), id, caseId, "statement", "README.md"),
          "utf8",
        );
        expect(statement, caseId).toMatch(/^# \S/);
        expect(statement, caseId).toContain(`${harbor.repo}/tree/${harbor.ref}/`);
        expect(statement, caseId).toContain(`${harbor.path}/${task}`);
        expect(statement, caseId).toContain(`harbor run -p ${harbor.path} -i ${task} `);
        const rubric = await fs.readFile(
          path.join(dir(), id, caseId, "rubric", "README.md"),
          "utf8",
        );
        const points = [...rubric.matchAll(/^- (\d+) pts:/gm)].map((m) => Number(m[1]));
        expect(
          points.reduce((a, b) => a + b, 0),
          caseId,
        ).toBe(100);
      }
    }
  });

  it("loading default_agent again rewrites nothing", async () => {
    await loadAgentState({ init: {} });
    await backdate(dir());
    const before = await tree(dir());

    await loadAgentState();

    expect(await tree(dir())).toEqual(before);
  });

  it("is given once: a deleted one stays deleted on later loads", async () => {
    await loadAgentState({ init: {} });
    await fs.rm(path.join(dir(), "automation-bench"), { recursive: true });
    await backdate(dir());
    const before = await tree(dir());

    await loadAgentState();
    await loadAgentState();

    expect(await benchmarkDirs()).not.toContain("automation-bench");
    expect(await tree(dir())).toEqual(before);
  });

  it("leaves a built-in Benchmark the user changed exactly as the user left it", async () => {
    await loadAgentState({ init: {} });
    const bench = path.join(dir(), "terminal-bench");
    const [dropped] = (await fs.readdir(bench)).filter((n) => n.startsWith("CASE-"));
    await fs.rm(path.join(bench, dropped!), { recursive: true });
    await fs.writeFile(path.join(bench, "scoreboard.yaml"), "evaluations:\n  - time: kept\n");
    await backdate(bench);
    const before = await tree(bench);

    await loadAgentState();

    expect(await tree(bench)).toEqual(before);
    expect(await fs.readdir(bench)).not.toContain(dropped);
  });

  it("a release that adds a built-in gives a Project that has the others just the new one", async () => {
    await loadAgentState({ init: {} });
    await fs.rm(path.join(dir(), "deep-swe"), { recursive: true });
    await backdate(dir());
    const before = await tree(dir());

    await provisionProjectBenchmarks(tmpRoot, DEFAULT_PROJECT_ID, [
      ...BUILTIN_BENCHMARKS,
      laterBuiltin("later-bench"),
    ]);

    expect((await readConfig("later-bench")).kind).toBe("harbor");
    expect(await benchmarkDirs()).not.toContain("deep-swe");
    expect(await given()).toContain("later-bench");
    const after = await tree(dir());
    for (const [file, stamp] of before) {
      if (file !== SEEDED_BENCHMARKS_FILE) expect(after.get(file), file).toEqual(stamp);
    }
  });

  it("never writes into a Benchmark of the user's own under a built-in id, and gives the built-in once it is gone", async () => {
    const mine = path.join(dir(), "deep-swe");
    await fs.mkdir(mine, { recursive: true });
    await fs.writeFile(path.join(mine, "benchmark_config.toml"), 'title = "mine"\n');

    await loadAgentState({ init: {} });

    expect(await fs.readdir(mine)).toEqual(["benchmark_config.toml"]);
    expect(await fs.readFile(path.join(mine, "benchmark_config.toml"), "utf8")).toBe(
      'title = "mine"\n',
    );

    await fs.rm(mine, { recursive: true });
    await loadAgentState();

    expect((await readConfig("deep-swe")).kind).toBe("harbor");
    expect(await given()).toContain("deep-swe");
  });

  it("a write that fails part-way leaves neither a directory nor a record of it", async () => {
    await loadAgentState({ init: {} });
    const [first, second] = BUILTIN_BENCHMARKS[0]!.cases;
    // A task name the filesystem refuses, after a case that writes fine.
    const broken = laterBuiltin("broken-bench", [first!, { ...second!, task: "bad\u0000task" }]);

    await expect(
      provisionProjectBenchmarks(tmpRoot, DEFAULT_PROJECT_ID, [...BUILTIN_BENCHMARKS, broken]),
    ).rejects.toThrow();

    expect(await exists(path.join(dir(), "broken-bench"))).toBe(false);
    expect(await given()).not.toContain("broken-bench");
  });

  it("two processes provisioning at once keep each other's records, and what the other placed first stays deleted once deleted", async () => {
    // The other process cuts in after this one found `raced` missing and before its rename: it
    // places `raced` itself and records it beside `theirs`, an id only it gives.
    const other = [seed("raced", "other"), seed("theirs", "other")];
    const mine = [seed("raced", "mine", () => provisionSeeds(dir(), other)), seed("ours", "mine")];

    await provisionSeeds(dir(), mine);

    expect((await given()).sort()).toEqual(["ours", "raced", "theirs"]);
    expect(await benchmarkDirs()).toEqual(["ours", "raced", "theirs"]);
    // The rename that lost dropped its own copy.
    expect(await fs.readFile(path.join(dir(), "raced", "benchmark_config.toml"), "utf8")).toBe(
      'title = "other"\n',
    );
    expect(await exists(path.join(dir(), ".seeding"))).toBe(false);

    await fs.rm(path.join(dir(), "raced"), { recursive: true });
    await provisionSeeds(dir(), mine);

    expect(await benchmarkDirs()).toEqual(["ours", "theirs"]);
  });

  it("clears staging debris an hour old and leaves a younger entry, another process's work in progress, alone", async () => {
    const crashed = path.join(dir(), ".seeding", "terminal-bench-crashed");
    const inProgress = path.join(dir(), ".seeding", "deep-swe-writing");
    await fs.mkdir(crashed, { recursive: true });
    await fs.mkdir(inProgress, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(crashed, twoHoursAgo, twoHoursAgo);

    await loadAgentState({ init: {} });

    expect(await exists(crashed)).toBe(false);
    expect(await exists(inProgress)).toBe(true);
    expect((await given()).sort()).toEqual([...BUILTIN_IDS, EXAMPLE_BENCHMARK_ID].sort());
  });

  it("an unreadable marker gives nothing, stays as it is, and is reported once however many loads read it", async () => {
    await loadAgentState({ init: {} });
    const marker = path.join(dir(), SEEDED_BENCHMARKS_FILE);
    await fs.writeFile(marker, "{ not json");
    await fs.rm(path.join(dir(), "deep-swe"), { recursive: true });
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      await loadAgentState();
      await loadAgentState();
    } finally {
      stderr.mockRestore();
    }

    expect(await benchmarkDirs()).not.toContain("deep-swe");
    expect(await fs.readFile(marker, "utf8")).toBe("{ not json");
    const reports = lines.filter(
      (line) => line.startsWith("[benchmarks]") && line.includes(marker),
    );
    expect(reports).toHaveLength(1);
  });

  // Release guard: flip `it.fails` to `it` in the change that pins the results commit.
  it.fails(
    "ships the benchmark repository pinned to a commit (expected to fail until the results commit is pinned)",
    async () => {
      await loadAgentState({ init: {} });
      const harbor = (await readConfig("terminal-bench")).harbor as Record<string, unknown>;
      expect(String(harbor.ref)).toMatch(/^[0-9a-f]{40}$/);
    },
  );
});
