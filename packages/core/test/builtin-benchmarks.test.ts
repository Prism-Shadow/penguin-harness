/** Shipped Benchmark packages are copied unchanged, once, without carrying evaluations. */
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
  readBuiltinBenchmarks,
  usePushedBenchmarkDirectory,
  type BuiltinBenchmark,
} from "../src/state/index.js";
const BUILTIN_BENCHMARKS = await readBuiltinBenchmarks();
const BUILTIN_IDS = BUILTIN_BENCHMARKS.map((bench) => bench.id);

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
  it("a new Project's benchmarks/ holds the example and the shipped packages, each with one run per case, no evaluations and at least one case", async () => {
    expect(BUILTIN_IDS.length).toBeGreaterThan(0);
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

  it("copies each package's manifest and Case files byte for byte", async () => {
    await provision();
    for (const bench of BUILTIN_BENCHMARKS) {
      const packaged = await tree(bench.directory);
      const copied = await tree(path.join(dir(), bench.id));
      expect([...copied.keys()].sort()).toEqual([...packaged.keys(), "scoreboard.yaml"].sort());
      for (const [file, value] of packaged) expect(copied.get(file)?.text, file).toBe(value.text);
      for (const caseId of await caseIds(bench.id)) expect(isValidId(caseId), caseId).toBe(true);
    }
  });

  it("uses the packages carried by a hot update", async () => {
    const assets = path.join(tmpRoot, "assets");
    const source = BUILTIN_BENCHMARKS[0]!;
    await fs.mkdir(assets);
    await fs.cp(source.directory, path.join(assets, source.id), { recursive: true });
    usePushedBenchmarkDirectory(assets);
    await provision();
    expect(await entries()).toEqual([EXAMPLE_BENCHMARK_ID, source.id].sort(byName));
    expect((await tree(path.join(dir(), source.id))).size).toBe(
      (await tree(source.directory)).size + 1,
    );
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
    const broken: BuiltinBenchmark = {
      id: "broken-bench",
      directory: path.join(tmpRoot, "missing-package"),
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
});
