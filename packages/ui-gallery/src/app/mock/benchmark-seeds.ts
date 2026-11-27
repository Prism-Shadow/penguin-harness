/**
 * The Benchmarks the pinned Self-Evolution Workbench (`@penguinharness/rsi-workbench`) writes into
 * an Agent's workbench data folder the first time it loads: its `seeds/catalog.json` lists them
 * by id, title, Chinese title and data repository, in the order the package ships them, and each
 * seed folder holds the manifest and every case's statement and rubric READMEs. The demo lists
 * them as the workbench's handler lists a freshly seeded folder.
 *
 * The package exports them as its published files (`./workbenches/*`): the catalog by its
 * subpath, the seed folders through the `@rsi-workbench-seeds` alias the gallery's Vite and
 * Vitest configs resolve from that same subpath, since a glob takes no package name. Only the
 * manifest's top-level scalars are read here (the description, the version, the run count and the
 * status): the format's own reader runs on Node only, and the tables after them say nothing the
 * list shows.
 */
import catalog from "@penguinharness/rsi-workbench/workbenches/benchmark/seeds/catalog.json";
import type { BenchmarkStatus } from "./rsi-workbench-contract";

const SEED_FILES = import.meta.glob<string>(
  "@rsi-workbench-seeds/*/{benchmark_config.toml,CASE-*/statement/README.md,CASE-*/rubric/README.md}",
  { query: "?raw", import: "default", eager: true, exhaustive: true },
);

/** The same files by their path below `seeds/`: `<id>/benchmark_config.toml`, `<id>/CASE-…/…`. */
const BY_SEED_PATH = new Map(
  Object.entries(SEED_FILES).map(([file, text]) => [
    file.replace(/^.*?(?:\/seeds\/|@rsi-workbench-seeds\/)/, ""),
    text,
  ]),
);

/** One case of a seed: the title its list shows and the two READMEs its browser opens. */
export interface SeedCase {
  id: string;
  title: string;
  statement: string;
  rubric: string;
}

/** One seed, as the workbench lists it once it is in the data folder. */
export interface SeedBenchmark {
  id: string;
  title: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
  version?: string;
  /** Runs per case; absent reads as 1. */
  runs?: number;
  status: BenchmarkStatus;
  /** The upstream repository the cases come from; the Example Benchmark has none. */
  dataUrl?: string;
  cases: SeedCase[];
}

/** The catalog's entries, as the package's build-seeds writes them. */
interface CatalogEntry {
  id: string;
  title: string;
  title_zh?: string;
  data_url?: string;
}

/**
 * The manifest's top-level keys that hold a basic string or an integer, before its first table.
 * A TOML basic string is a JSON string for every escape a manifest uses.
 */
function manifestScalars(toml: string): Record<string, string | number> {
  const head = toml.split(/^\[[^\]\n]+\]\s*$/m)[0] ?? "";
  const scalars: Record<string, string | number> = {};
  for (const line of head.split("\n")) {
    const match = /^([A-Za-z_][\w-]*)\s*=\s*("(?:[^"\\]|\\.)*"|-?\d+)\s*$/.exec(line);
    if (match === null) continue;
    const value: unknown = JSON.parse(match[2]!);
    if (typeof value === "string" || typeof value === "number") scalars[match[1]!] = value;
  }
  return scalars;
}

/** A case's title as the handler reads it: the statement's first heading without "Case N:". */
function statementTitle(statement: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(statement)?.[1]?.trim();
  return heading?.replace(/^Case\s+\d+\s*:\s*/i, "") || fallback;
}

function readSeed(entry: CatalogEntry): SeedBenchmark {
  const manifest = manifestScalars(BY_SEED_PATH.get(`${entry.id}/benchmark_config.toml`) ?? "");
  const text = (key: string) => {
    const value = manifest[key];
    return typeof value === "string" ? value : undefined;
  };
  const status = text("status");
  const runs = manifest.runs;
  // The handler lists a seed's cases by folder name.
  const cases = [...BY_SEED_PATH.keys()]
    .map((path) => /^([^/]+)\/(CASE-[^/]+)\/statement\/README\.md$/.exec(path))
    .filter((match): match is RegExpExecArray => match !== null && match[1] === entry.id)
    .map((match) => match[2]!)
    .sort()
    .map((caseId): SeedCase => {
      const statement = BY_SEED_PATH.get(`${entry.id}/${caseId}/statement/README.md`) ?? "";
      return {
        id: caseId,
        title: statementTitle(statement, caseId),
        statement,
        rubric: BY_SEED_PATH.get(`${entry.id}/${caseId}/rubric/README.md`) ?? "",
      };
    });
  return {
    id: entry.id,
    title: entry.title,
    titleZh: entry.title_zh,
    description: text("description"),
    descriptionZh: text("description_zh"),
    version: text("version"),
    runs: typeof runs === "number" ? runs : undefined,
    status: status === "draft" || status === "failed" ? status : "published",
    dataUrl: entry.data_url,
    cases,
  };
}

/** Every seed of the pinned workbench, in its catalog's order. */
export const SEED_BENCHMARKS: readonly SeedBenchmark[] = (catalog as CatalogEntry[]).map(readSeed);

/** The seed every new workbench starts with an evaluation history on. */
export const EXAMPLE_BENCHMARK_ID = "example-benchmark";
