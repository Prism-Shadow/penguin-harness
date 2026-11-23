/**
 * Shipped Benchmark packages, as a new Project's provisioning copies them.
 *
 * - Given a catalogue of packages, when a Project is provisioned, its benchmarks/ holds the
 *   example and every package, each with an empty scoreboard: evaluations belong to the Project.
 * - Every shipped package, whatever the catalogue holds, is copied byte for byte.
 * - A hot update's packages are the ones a new Project gets.
 * - Provisioning again writes nothing.
 * - A directory already under a package's or the example's id is left exactly as it is.
 * - A write that fails part-way leaves neither its directory nor staging debris, and the error
 *   reaches the caller.
 * - Initializing or loading default_agent never writes into benchmarks/.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  DEFAULT_PROJECT_ID,
  EXAMPLE_BENCHMARK_ID,
  benchmarksDir,
  loadAgentState,
  provisionProjectBenchmarks,
  readBuiltinBenchmarks,
  usePushedBenchmarkDirectory,
  type BuiltinBenchmark,
} from "../src/state/index.js";

let tmpRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-builtin-bench-"));
  process.env.PENGUIN_HOME = tmpRoot;
});

afterEach(async () => {
  usePushedBenchmarkDirectory(null);
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const dir = () => benchmarksDir(tmpRoot, DEFAULT_PROJECT_ID);
const provision = (builtins?: readonly BuiltinBenchmark[]) =>
  provisionProjectBenchmarks(tmpRoot, DEFAULT_PROJECT_ID, builtins);
const byName = (a: string, b: string) => a.localeCompare(b);
async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** The packages of a fixture catalogue: what the build would clone, written by hand. */
const FIXTURE: Record<string, Record<string, string>> = {
  "alpha-bench": {
    "benchmark_config.toml": 'title = "Alpha"\nstatus = "published"\n',
    "CASE-001-first/statement/README.md": "# Do the first thing\n",
    "CASE-001-first/rubric/README.md": "- 100 pts: done\n",
  },
  "beta-bench": {
    "benchmark_config.toml": 'title = "Beta"\nstatus = "draft"\nruns = 3\n',
    "CASE-001-only/statement/README.md": "# Do the only thing\n",
  },
};

/** Writes the fixture catalogue under `root` and returns its packages as the catalogue lists them. */
async function fixtureCatalogue(
  root = path.join(tmpRoot, "catalogue"),
): Promise<BuiltinBenchmark[]> {
  for (const [id, files] of Object.entries(FIXTURE)) {
    for (const [rel, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, id, rel)), { recursive: true });
      await fs.writeFile(path.join(root, id, rel), text);
    }
  }
  return Object.keys(FIXTURE).map((id) => ({ id, directory: path.join(root, id) }));
}

/** Every entry under `benchmarks/`, staging included, in listing order. */
async function entries(): Promise<string[]> {
  return (await fs.readdir(dir())).sort(byName);
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
  it("a new Project's benchmarks/ holds the example and every shipped package, each with an empty scoreboard", async () => {
    const catalogue = await fixtureCatalogue();

    await provision(catalogue);

    expect(await entries()).toEqual([EXAMPLE_BENCHMARK_ID, ...Object.keys(FIXTURE)].sort(byName));
    for (const { id } of catalogue) {
      const scoreboard = parseYaml(
        await fs.readFile(path.join(dir(), id, "scoreboard.yaml"), "utf8"),
      ) as { evaluations: unknown[] };
      expect(scoreboard.evaluations, id).toEqual([]);
    }
  });

  it("copies every shipped package's manifest and Case files byte for byte, whatever the catalogue holds", async () => {
    // The default source: the catalogue the build fetched. Nothing here assumes what it holds.
    const shipped = await readBuiltinBenchmarks();

    await provision();

    for (const bench of shipped) {
      const packaged = await tree(bench.directory);
      const copied = await tree(path.join(dir(), bench.id));
      expect([...copied.keys()].sort()).toEqual([...packaged.keys(), "scoreboard.yaml"].sort());
      for (const [file, value] of packaged) expect(copied.get(file)?.text, file).toBe(value.text);
    }
  });

  it("uses the packages carried by a hot update", async () => {
    const assets = path.join(tmpRoot, "assets");
    await fs.mkdir(path.join(assets, "alpha-bench"), { recursive: true });
    await fs.writeFile(path.join(assets, "alpha-bench", "benchmark_config.toml"), 'title = "A"\n');
    usePushedBenchmarkDirectory(assets);

    await provision();

    expect(await entries()).toEqual([EXAMPLE_BENCHMARK_ID, "alpha-bench"].sort(byName));
    expect(
      await fs.readFile(path.join(dir(), "alpha-bench", "benchmark_config.toml"), "utf8"),
    ).toBe('title = "A"\n');
  });

  it("provisioning again writes nothing", async () => {
    const catalogue = await fixtureCatalogue();
    await provision(catalogue);
    await backdate(dir());
    const before = await tree(dir());

    await provision(catalogue);

    expect(await tree(dir())).toEqual(before);
    expect(await entries()).toEqual([EXAMPLE_BENCHMARK_ID, ...Object.keys(FIXTURE)].sort(byName));
  });

  it("leaves a directory already under a built-in or the example id exactly as it is", async () => {
    const catalogue = await fixtureCatalogue();
    const mine = path.join(dir(), "alpha-bench");
    const example = path.join(dir(), EXAMPLE_BENCHMARK_ID);
    await fs.mkdir(mine, { recursive: true });
    await fs.mkdir(example, { recursive: true });
    await fs.writeFile(path.join(mine, "benchmark_config.toml"), 'title = "mine"\n');
    await fs.writeFile(path.join(example, "scoreboard.yaml"), "evaluations:\n  - time: kept\n");
    await backdate(dir());
    const before = await tree(dir());

    await provision(catalogue);

    const after = await tree(dir());
    for (const [file, stamp] of before) expect(after.get(file), file).toEqual(stamp);
    expect(await fs.readdir(mine)).toEqual(["benchmark_config.toml"]);
    expect(await fs.readdir(example)).toEqual(["scoreboard.yaml"]);
    // The package nobody took is still provisioned.
    expect(await fs.readFile(path.join(dir(), "beta-bench", "benchmark_config.toml"), "utf8")).toBe(
      FIXTURE["beta-bench"]!["benchmark_config.toml"],
    );
  });

  it("a write that fails part-way leaves neither its directory nor staging debris, and the error reaches the caller", async () => {
    const broken: BuiltinBenchmark = {
      id: "broken-bench",
      directory: path.join(tmpRoot, "missing-package"),
    };

    await expect(provision([...(await fixtureCatalogue()), broken])).rejects.toThrow();

    expect(await exists(path.join(dir(), "broken-bench"))).toBe(false);
    expect(await exists(path.join(dir(), ".seeding"))).toBe(false);
  });

  it("initializing or loading default_agent never writes into benchmarks/", async () => {
    await fs.mkdir(dir(), { recursive: true });

    await loadAgentState({ init: {} });
    await loadAgentState();

    expect(await fs.readdir(dir())).toEqual([]);
  });
});
