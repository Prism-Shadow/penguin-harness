/**
 * Fetch the Benchmark manifests and Case Markdown at build time for packaging.
 * Content lives in penguin-harness-benchmark/packages; this repository keeps no copy in git.
 * --refresh fetches the pinned commit again. Update REF to ship a new package revision.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BENCHMARKS_DIR = path.join(ROOT, "node_modules", ".cache", "penguin-benchmarks");
const REPOSITORY = "https://github.com/Prism-Shadow/penguin-harness-benchmark.git";
const REF = "a9945e66cfe308c53bab3a50b170b306143dcac5";
const require = createRequire(path.join(ROOT, "packages/core/package.json"));
const { parse } = require("smol-toml");

export async function buildBenchmarks({ refresh = false } = {}) {
  if (!/^[0-9a-f]{40}$/.test(REF))
    throw new Error("Benchmark REF must be a full lowercase commit id.");
  if (!refresh) {
    try {
      await fs.access(path.join(BENCHMARKS_DIR, "catalog.json"));
      if ((await fs.readFile(path.join(BENCHMARKS_DIR, ".ref"), "utf8")) === REF) return;
    } catch {
      // Fetch on the first build or when the configured commit changes.
    }
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-benchmarks-"));
  try {
    const checkout = path.join(temp, "repo");
    const git = (args) => execFileSync("git", args, { stdio: "pipe" });
    git(["init", checkout]);
    git(["-C", checkout, "remote", "add", "origin", REPOSITORY]);
    git(["-C", checkout, "config", "remote.origin.promisor", "true"]);
    git(["-C", checkout, "config", "remote.origin.partialclonefilter", "blob:none"]);
    git(["-C", checkout, "sparse-checkout", "set", "packages"]);
    git(["-C", checkout, "fetch", "--depth=1", "--filter=blob:none", "origin", REF]);
    git(["-C", checkout, "checkout", "--detach", "FETCH_HEAD"]);
    const packages = path.join(checkout, "packages");
    const staged = path.join(temp, "packages");
    await fs.mkdir(staged);
    const catalog = [];
    for (const entry of (await fs.readdir(packages, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = path.join(packages, entry.name);
      if (!existsSync(path.join(dir, "benchmark_config.toml"))) continue;
      const manifest = await fs.readFile(path.join(dir, "benchmark_config.toml"), "utf8");
      const { description_zh: descriptionZh, ...config } = parse(manifest);
      if (config.id !== entry.name)
        throw new Error(`Benchmark id does not match its directory: ${dir}`);
      const dest = path.join(staged, entry.name);
      await fs.mkdir(dest);
      await fs.writeFile(path.join(dest, "benchmark_config.toml"), manifest);
      const cases = [];
      for (const item of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (!item.isDirectory() || !item.name.startsWith("CASE-")) continue;
        const caseDir = path.join(dir, item.name);
        const statement = await fs.readFile(path.join(caseDir, "statement/README.md"), "utf8");
        const rubric = await fs.readFile(path.join(caseDir, "rubric/README.md"), "utf8");
        for (const [part, text] of [
          ["statement", statement],
          ["rubric", rubric],
        ]) {
          const target = path.join(dest, item.name, part);
          await fs.mkdir(target, { recursive: true });
          await fs.writeFile(path.join(target, "README.md"), text, "utf8");
        }
        cases.push({
          id: item.name,
          title: /^#\s+(.+)$/m.exec(statement)?.[1] ?? item.name,
          statement,
          rubric,
        });
      }
      if (cases.length === 0) throw new Error(`Benchmark has no cases: ${dir}`);
      catalog.push({ ...config, ...(descriptionZh === undefined ? {} : { descriptionZh }), cases });
    }
    if (catalog.length === 0) throw new Error(`No Benchmark packages found in ${packages}`);
    // The browser gallery consumes the same texts, without importing Node's filesystem loader.
    await fs.writeFile(path.join(staged, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
    await fs.rm(BENCHMARKS_DIR, { recursive: true, force: true });
    await fs.cp(staged, BENCHMARKS_DIR, { recursive: true });
    await fs.writeFile(path.join(BENCHMARKS_DIR, ".ref"), REF);
    console.log(`Benchmark packages: ${catalog.length} staged from ${REPOSITORY} (${REF})`);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

/** The core, bundled CLI and desktop carry the files beside their JavaScript bundles. */
export async function stageBenchmarks(dest) {
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(BENCHMARKS_DIR, dest, {
    recursive: true,
    filter: (file) =>
      !["catalog.json", ".ref"].some((name) => file === path.join(BENCHMARKS_DIR, name)),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: { refresh: { type: "boolean" }, stage: { type: "string" } },
  });
  if (values.stage) await stageBenchmarks(path.resolve(values.stage));
  else await buildBenchmarks({ refresh: values.refresh });
}
