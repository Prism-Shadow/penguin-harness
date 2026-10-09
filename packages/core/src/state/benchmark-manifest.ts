/**
 * A Benchmark's manifest, `benchmark.json`: the file that makes a directory under a Project's
 * `benchmarks/` a Benchmark, and what that Benchmark is.
 *
 * A Benchmark is a directory named by its id. Its **package** is the directory minus the state
 * this copy keeps for itself: `benchmark.json` and every `CASE-*` tree (a `statement/` and a
 * `rubric/`, each indexed by its README.md). `scoreboard.yaml`, the `.jobs/` Harbor trials, any
 * other dot-entry and symlinks belong to the copy, never to the package. The manifest describes
 * the package the way a plugin's `plugin.json` does: the id (the directory name, repeated so that
 * a zip of the folder describes itself), title, description, a date version, the build status,
 * the runs per case and where this copy came from. Nothing about Agents or models: those are
 * recorded on each evaluation.
 *
 * The version is a date with a sequence number, `YYYY.MM.DD.N`, the plugins' format: whatever an
 * Agent may edit on disk carries one, so a copy says which revision of its content it holds. A
 * Benchmark starts at the day's `.1` (nextDateVersion); benchmark-design moves it on whenever it
 * changes a case or the status; an import keeps the package's own. Nothing compares them for
 * updates: a Benchmark is frozen once created, so there is never a newer one to offer.
 *
 * compat(0.3.0): before benchmark.json, a Benchmark's config was `benchmark_config.toml` (title,
 * description, runs, status), and installed copies of the agent-tuning plugin from those releases
 * still read and write it. readBenchmarkManifest adopts such a directory when it reads it: it
 * writes the benchmark.json the TOML describes beside it and leaves the TOML in place for those
 * copies; from then on the JSON is the truth. A draft is read but not converted, because the
 * copy still designing it writes `published` or `failed` into the TOML when it finishes. At the
 * 0.3.0 release preparation, whoever prepares the release removes the adoption (legacyManifest,
 * LEGACY_SEEDED_IDS, BENCHMARK_LEGACY_CONFIG and the smol-toml import here) with its tests; see
 * changelog/unreleased/2026-10-09-backward-compatibility.md.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { formatLocalDate } from "../internal/dates.js";
import {
  PLUGIN_VERSION_PATTERN,
  comparePluginVersions,
  parsePluginVersion,
} from "../plugins/index.js";
import { isValidId } from "./agent-state.js";

/** The manifest's file name, at the root of a Benchmark's directory. */
export const BENCHMARK_MANIFEST = "benchmark.json";
/** compat(0.3.0): the file every Benchmark had before benchmark.json. */
export const BENCHMARK_LEGACY_CONFIG = "benchmark_config.toml";

/**
 * Whether the Skill that builds a Benchmark is done with it: `draft` while benchmark-design is
 * still writing and calibrating the cases, `published` once it is frozen (a Benchmark made any
 * other way starts here), `failed` when calibration ended without a result to freeze.
 */
export type BenchmarkStatus = "draft" | "published" | "failed";

/**
 * Where a copy came from: `builtin` (seeded when the Project was created), `manual` (the create
 * form), `agent` (benchmark-design wrote it), `git` (an Agent imported a repository folder) or
 * `zip` (an uploaded package).
 */
export type BenchmarkOriginKind = "builtin" | "manual" | "agent" | "git" | "zip";

export interface BenchmarkOrigin {
  kind: BenchmarkOriginKind;
  /** git: the folder link as the user gave it (a GitHub tree URL); absent for the other kinds. */
  url?: string;
  /** git: the 40-hex commit the import resolved the link to. */
  ref?: string;
  /** git: the folder inside the repository, e.g. `packages/penguinharness-benchmark-sec-a`. */
  path?: string;
  /** git / zip: when this copy was written, ISO 8601. */
  imported_at?: string;
}

export interface BenchmarkManifest {
  /** The directory name: letters, digits, `_` and `-`. */
  id: string;
  /** 1 to 200 characters, not blank. */
  title: string;
  /** Up to 2000 characters; absent rather than empty. */
  description?: string;
  /** `YYYY.MM.DD.N`. */
  version: string;
  status: BenchmarkStatus;
  /** Runs per case, an integer from 1 to 1000. */
  runs: number;
  origin: BenchmarkOrigin;
}

/** A manifest that cannot be used: `code` says which rule it broke, `message` says how. */
export class BenchmarkManifestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BenchmarkManifestError";
  }
}

/** The create form's limits (the server's create route refuses anything beyond them). */
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const MAX_RUNS = 1000;

const STATUSES: readonly string[] = ["draft", "published", "failed"];
const ORIGIN_KINDS: readonly string[] = ["builtin", "manual", "agent", "git", "zip"];
const ORIGIN_TEXT_FIELDS = ["url", "ref", "path", "imported_at"] as const;

function invalid(message: string): BenchmarkManifestError {
  return new BenchmarkManifestError("benchmark_manifest_invalid", `benchmark.json: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** An http(s) link: anything else (a `javascript:` URL above all) is not a place to send a reader. */
function isWebLink(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function parseOrigin(raw: unknown): BenchmarkOrigin {
  if (!isRecord(raw) || typeof raw.kind !== "string" || !ORIGIN_KINDS.includes(raw.kind)) {
    throw invalid(`"origin" must be an object whose "kind" is one of ${ORIGIN_KINDS.join(", ")}.`);
  }
  const origin: BenchmarkOrigin = { kind: raw.kind as BenchmarkOriginKind };
  for (const field of ORIGIN_TEXT_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || value === "") {
      throw invalid(`"origin.${field}" must be a non-empty string.`);
    }
    origin[field] = value;
  }
  if (origin.url !== undefined && !isWebLink(origin.url)) {
    throw invalid(`"origin.url" must be an http(s) link.`);
  }
  return origin;
}

/**
 * Reads the text of a `benchmark.json` found in the directory `dirId`. Strict: a field that is
 * missing or out of shape is an error naming it, and so is an `id` other than the directory's
 * (`benchmark_id_mismatch`). Fields it does not know are ignored, so a manifest written by a
 * later release still reads.
 */
export function parseBenchmarkManifest(text: string, dirId: string): BenchmarkManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw invalid(`not valid JSON (${(error as Error).message}).`);
  }
  if (!isRecord(raw)) throw invalid("must hold a JSON object.");
  const { id, title, description, version, status, runs } = raw;
  if (typeof id !== "string" || !isValidId(id)) {
    throw invalid(`"id" must be the directory name: letters, digits, "_" and "-".`);
  }
  if (id !== dirId) {
    throw new BenchmarkManifestError(
      "benchmark_id_mismatch",
      `benchmark.json: "id" is ${JSON.stringify(id)}, but the directory is ${JSON.stringify(dirId)}.`,
    );
  }
  if (typeof title !== "string" || title.trim() === "" || title.length > MAX_TITLE) {
    throw invalid(`"title" must be text of 1 to ${MAX_TITLE} characters.`);
  }
  if (
    description !== undefined &&
    description !== null &&
    (typeof description !== "string" || description.length > MAX_DESCRIPTION)
  ) {
    throw invalid(`"description" must be text of at most ${MAX_DESCRIPTION} characters.`);
  }
  if (typeof version !== "string" || !PLUGIN_VERSION_PATTERN.test(version)) {
    throw invalid(`"version" must be a date version, YYYY.MM.DD.N.`);
  }
  if (typeof status !== "string" || !STATUSES.includes(status)) {
    throw invalid(`"status" must be one of ${STATUSES.join(", ")}.`);
  }
  if (typeof runs !== "number" || !Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
    throw invalid(`"runs" must be an integer from 1 to ${MAX_RUNS}.`);
  }
  return {
    id,
    title,
    ...(typeof description === "string" && description !== "" ? { description } : {}),
    version,
    status: status as BenchmarkStatus,
    runs,
    origin: parseOrigin(raw.origin),
  };
}

/** The manifest as written: two-space JSON with a trailing newline, the fields in one order. */
function serializeBenchmarkManifest(manifest: BenchmarkManifest): string {
  const origin: BenchmarkOrigin = { kind: manifest.origin.kind };
  for (const field of ORIGIN_TEXT_FIELDS) {
    const value = manifest.origin[field];
    if (value !== undefined) origin[field] = value;
  }
  const ordered = {
    id: manifest.id,
    title: manifest.title,
    ...(manifest.description !== undefined && manifest.description !== ""
      ? { description: manifest.description }
      : {}),
    version: manifest.version,
    status: manifest.status,
    runs: manifest.runs,
    origin,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Writes `manifest` as `benchDir/benchmark.json`, replacing it atomically. `benchDir` may be a
 * staging directory that is renamed into place afterwards, so its name is not checked against the
 * id; every other rule is, and a manifest this module would refuse to read is never written.
 */
export async function writeBenchmarkManifest(
  benchDir: string,
  manifest: BenchmarkManifest,
): Promise<void> {
  const text = serializeBenchmarkManifest(manifest);
  parseBenchmarkManifest(text, manifest.id);
  await atomicWriteFile(path.join(benchDir, BENCHMARK_MANIFEST), text);
}

/**
 * The version a Benchmark's next revision carries: the day's `.1`, or the next sequence number
 * when `previous` is from that day. A version never goes backwards, so a `previous` dated later
 * than `now` (a clock that ran ahead) also takes its next number. The day is the local calendar
 * day, the one the Agents read as their Environment's date.
 */
export function nextDateVersion(previous?: string, now: Date = new Date()): string {
  const today = formatLocalDate(now).replace(/-/g, ".");
  const last = previous === undefined ? null : parsePluginVersion(previous);
  if (last !== null && last.date >= today) return `${last.date}.${last.seq + 1}`;
  return `${today}.1`;
}

/** Orders two Benchmark versions: by date, then by sequence number. The plugins' ordering. */
export const compareDateVersions = comparePluginVersions;

/**
 * compat(0.3.0): the ids the releases before benchmark.json seeded into every new Project, the
 * example and PenguinHarness Benchmark Sec A to Sec E. A legacy copy under one of them is adopted
 * as `builtin`, any other as `agent`. The list is history, not the current seeding: Benchmarks
 * seeded from now on are written with their manifest.
 */
const LEGACY_SEEDED_IDS: ReadonlySet<string> = new Set([
  "example-benchmark",
  "penguinharness-benchmark-sec-a",
  "penguinharness-benchmark-sec-b",
  "penguinharness-benchmark-sec-c",
  "penguinharness-benchmark-sec-d",
  "penguinharness-benchmark-sec-e",
]);

/**
 * compat(0.3.0): the manifest a legacy `benchmark_config.toml` describes, read as leniently as the
 * TOML always was: a missing or unusable title is the directory name, an unusable description is
 * left out, runs default to 1 (and stop at the limit), and only a literal `draft` or `failed` is
 * one; anything else is published. The version is the day the TOML was last written, `.1`.
 */
function legacyManifest(
  config: Record<string, unknown>,
  id: string,
  writtenAt: Date,
): BenchmarkManifest {
  const { title, description, runs, status } = config;
  return {
    id,
    title:
      typeof title === "string" && title.trim() !== "" && title.length <= MAX_TITLE ? title : id,
    ...(typeof description === "string" &&
    description !== "" &&
    description.length <= MAX_DESCRIPTION
      ? { description }
      : {}),
    version: `${formatLocalDate(writtenAt).replace(/-/g, ".")}.1`,
    status: status === "draft" ? "draft" : status === "failed" ? "failed" : "published",
    runs:
      typeof runs === "number" && Number.isInteger(runs) && runs >= 1
        ? Math.min(runs, MAX_RUNS)
        : 1,
    origin: { kind: LEGACY_SEEDED_IDS.has(id) ? "builtin" : "agent" },
  };
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** compat(0.3.0): see the module comment. Null when there is no TOML either. */
async function adoptLegacyConfig(benchDir: string, id: string): Promise<BenchmarkManifest | null> {
  const file = path.join(benchDir, BENCHMARK_LEGACY_CONFIG);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const { mtime: writtenAt } = await fs.stat(file);
  let config: unknown;
  try {
    config = parseToml(text);
  } catch (error) {
    throw new BenchmarkManifestError(
      "benchmark_config_invalid",
      `${BENCHMARK_LEGACY_CONFIG}: not valid TOML (${(error as Error).message}).`,
    );
  }
  const manifest = legacyManifest(isRecord(config) ? config : {}, id, writtenAt);
  if (manifest.status !== "draft") {
    try {
      await writeBenchmarkManifest(benchDir, manifest);
    } catch {
      // A data root that cannot be written to keeps the TOML as its source; the next read tries
      // again, and nothing the caller sees depends on the write.
    }
  }
  return manifest;
}

/**
 * The manifest of the Benchmark in `benchDir`, or null when the directory is not a Benchmark:
 * its name is not an id (`.seeding/`, `.harbor/`), or it holds no manifest. A directory with only
 * the legacy `benchmark_config.toml` is adopted first (compat(0.3.0), see the module comment);
 * when both files are there, benchmark.json is the one read. A manifest that is there but cannot
 * be read throws: a BenchmarkManifestError for what it holds, the filesystem's error otherwise.
 */
export async function readBenchmarkManifest(benchDir: string): Promise<BenchmarkManifest | null> {
  const id = path.basename(benchDir);
  if (!isValidId(id)) return null;
  let text: string;
  try {
    text = await fs.readFile(path.join(benchDir, BENCHMARK_MANIFEST), "utf8");
  } catch (error) {
    if (!isMissing(error)) throw error;
    return adoptLegacyConfig(benchDir, id);
  }
  return parseBenchmarkManifest(text, id);
}
