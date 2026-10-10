/**
 * A Benchmark's manifest, `benchmark_config.toml`: the file that makes a directory under a
 * Project's `benchmarks/` a Benchmark, and what that Benchmark is.
 *
 * A Benchmark is a directory named by its id. Its **package** is the directory minus the state
 * this copy keeps for itself: `benchmark_config.toml` and every `CASE-*` tree (a `statement/` and
 * a `rubric/`, each indexed by its README.md). `scoreboard.yaml`, the `.jobs/` Harbor trials, any
 * other dot-entry and symlinks belong to the copy, never to the package. The manifest describes
 * the package the way a plugin's `plugin.json` does: the title, description, runs per case and
 * build status a Benchmark's config has always held, plus the `id` (the directory name, repeated
 * so that a zip of the folder describes itself), a date `version` and an `[origin]` table saying
 * where this copy came from. Nothing about Agents or models: those are recorded on each
 * evaluation.
 *
 * Every new key is optional on read, so a file written before them reads as it always did, as it
 * is, and nothing here rewrites a file it reads: without `id` the Benchmark is its directory's,
 * without `version` it is unversioned, without `[origin]` where it came from is unknown. The older
 * keys keep their old, lenient reading: a missing or empty title is the directory name, only a
 * literal `draft` or `failed` status is one (a missing or any other value is published), and a run
 * count that is not a positive integer is left out, which counts as one run. What cannot be read
 * at all is a file that is not TOML, or one whose new keys are there but out of shape — an `id`
 * other than the directory's above all (`benchmark_id_mismatch`). Keys this module does not know
 * are ignored, so a file written by a later release still reads, and an earlier release reading a
 * file written here ignores the new keys in turn.
 *
 * What is written is held to more than what is read (checkBenchmarkManifest): the create form's
 * limits on the title, the description and the run count, and a status that is one of the three.
 * An import writes the package it unpacked through the same check, so a copy written here always
 * reads back as it was written.
 *
 * The version is a date with a sequence number, `YYYY.MM.DD.N`, the plugins' format: whatever an
 * Agent may edit on disk carries one, so a copy says which revision of its content it holds. A
 * Benchmark starts at the day's `.1` (nextDateVersion); benchmark-design moves it on whenever it
 * changes a case or the status; an import keeps the package's own. Nothing compares them for
 * updates: a Benchmark is frozen once created, so there is never a newer one to offer.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml, TomlError } from "smol-toml";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { formatLocalDate } from "../internal/dates.js";
import {
  PLUGIN_VERSION_PATTERN,
  comparePluginVersions,
  parsePluginVersion,
} from "../plugins/index.js";
import { isValidId } from "./agent-state.js";

/** The manifest's file name, at the root of a Benchmark's directory. */
export const BENCHMARK_MANIFEST = "benchmark_config.toml";

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

/** The `[origin]` table. */
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
  /** The directory name: letters, digits, `_` and `-`. A file without `id` reads as its directory's. */
  id: string;
  /** Not empty; a file without a usable one reads as the directory name. Written: 1 to 200 characters, not blank. */
  title: string;
  /** Absent rather than empty. Written: up to 2000 characters. */
  description?: string;
  /** `YYYY.MM.DD.N`; absent in a file written before versions, which is unversioned. */
  version?: string;
  /** A file that says neither `draft` nor `failed` is published. */
  status: BenchmarkStatus;
  /** Runs per case, a positive integer; absent when the file gives none, which counts as 1. Written: up to 1000. */
  runs?: number;
  /** Absent in a file written before origins: where that copy came from is unknown. */
  origin?: BenchmarkOrigin;
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
  return new BenchmarkManifestError(
    "benchmark_manifest_invalid",
    `${BENCHMARK_MANIFEST}: ${message}`,
  );
}

/** A TOML table: a plain object — not an array, and not a date, which smol-toml reads as one. */
function isTable(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
  );
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

/** Why `text` is not TOML, on one line: smol-toml's message carries a code frame below it. */
function tomlProblem(error: unknown): string {
  const first = (error as Error).message.split("\n", 1)[0]!.replace(/^Invalid TOML document: /, "");
  return error instanceof TomlError
    ? `${first} (line ${error.line}, column ${error.column})`
    : first;
}

/** The Benchmark's id: the file's `id` when it has one, which must then be `dirId`; else `dirId`. */
function idOf(raw: unknown, dirId: string): string {
  if (raw === undefined) {
    if (!isValidId(dirId)) throw invalid(`"id" is missing, and no directory name stands for it.`);
    return dirId;
  }
  if (typeof raw !== "string" || !isValidId(raw)) {
    throw invalid(`"id" must be the directory name: letters, digits, "_" and "-".`);
  }
  if (raw !== dirId) {
    throw new BenchmarkManifestError(
      "benchmark_id_mismatch",
      `${BENCHMARK_MANIFEST}: "id" is ${JSON.stringify(raw)}, but the directory is ${JSON.stringify(dirId)}.`,
    );
  }
  return raw;
}

/** The date version, when the file has one. */
function versionOf(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !PLUGIN_VERSION_PATTERN.test(raw)) {
    throw invalid(`"version" must be a date version, the string "YYYY.MM.DD.N".`);
  }
  return raw;
}

/**
 * The `[origin]` table, when the file has one: a `kind` it knows, and its other keys strings that
 * are not empty. `imported_at` may also be a TOML date-time, read as its ISO 8601 text.
 */
function originOf(raw: unknown): BenchmarkOrigin | undefined {
  if (raw === undefined) return undefined;
  if (!isTable(raw) || typeof raw.kind !== "string" || !ORIGIN_KINDS.includes(raw.kind)) {
    throw invalid(`"origin" must be a table whose "kind" is one of ${ORIGIN_KINDS.join(", ")}.`);
  }
  const origin: BenchmarkOrigin = { kind: raw.kind as BenchmarkOriginKind };
  for (const field of ORIGIN_TEXT_FIELDS) {
    let value = raw[field];
    if (value === undefined) continue;
    if (field === "imported_at" && value instanceof Date && !Number.isNaN(value.getTime())) {
      value = value.toISOString();
    }
    if (typeof value !== "string" || value === "") {
      throw invalid(`"origin.${field}" must be a non-empty string.`);
    }
    origin[field] = value;
  }
  if (origin.url !== undefined && !isWebLink(origin.url)) {
    throw invalid(`"origin.url" must be an http(s) link.`);
  }
  // The commit an import resolved its link to, never a branch or a tag that moves.
  if (origin.ref !== undefined && !/^[0-9a-f]{40}$/.test(origin.ref)) {
    throw invalid(`"origin.ref" must be a 40-character commit id.`);
  }
  return origin;
}

/**
 * Reads the text of a `benchmark_config.toml` found in the directory `dirId`, as the module doc
 * says: the new keys are optional and checked when present (an `id` other than the directory's is
 * `benchmark_id_mismatch`, anything else out of shape `benchmark_manifest_invalid`, and so is text
 * that is not TOML); the older keys are read as leniently as they always were.
 */
export function parseBenchmarkManifest(text: string, dirId: string): BenchmarkManifest {
  let config: Record<string, unknown>;
  try {
    config = parseToml(text);
  } catch (error) {
    throw invalid(`not valid TOML: ${tomlProblem(error)}.`);
  }
  const id = idOf(config.id, dirId);
  const version = versionOf(config.version);
  const origin = originOf(config.origin);
  const { title, description, runs, status } = config;
  return {
    id,
    title: typeof title === "string" && title !== "" ? title : id,
    ...(typeof description === "string" && description !== "" ? { description } : {}),
    ...(version !== undefined ? { version } : {}),
    // The two states that make a Benchmark unusable are literal: "draft" while it is still being
    // built, "failed" when its calibration never produced a result to freeze. A file written
    // before the key existed has none, and an unrecognized value is neither: both are published.
    status: status === "draft" ? "draft" : status === "failed" ? "failed" : "published",
    ...(typeof runs === "number" && Number.isInteger(runs) && runs >= 1 ? { runs } : {}),
    ...(origin !== undefined ? { origin } : {}),
  };
}

/**
 * Throws a BenchmarkManifestError (`benchmark_manifest_invalid`) when `manifest` breaks a rule a
 * written manifest keeps: an id, a title of 1 to 200 characters that is not blank, a description
 * of at most 2000, a date version and an origin in shape when present, one of the three statuses,
 * and a run count from 1 to 1000 when present. Such a manifest reads back exactly as it is.
 */
export function checkBenchmarkManifest(manifest: BenchmarkManifest): void {
  if (!isValidId(manifest.id)) {
    throw invalid(`"id" must be the directory name: letters, digits, "_" and "-".`);
  }
  const { title, description, runs } = manifest;
  if (typeof title !== "string" || title.trim() === "" || title.length > MAX_TITLE) {
    throw invalid(`"title" must be text of 1 to ${MAX_TITLE} characters.`);
  }
  if (
    description !== undefined &&
    (typeof description !== "string" || description.length > MAX_DESCRIPTION)
  ) {
    throw invalid(`"description" must be text of at most ${MAX_DESCRIPTION} characters.`);
  }
  versionOf(manifest.version);
  if (!STATUSES.includes(manifest.status)) {
    throw invalid(`"status" must be one of ${STATUSES.join(", ")}.`);
  }
  if (
    runs !== undefined &&
    (typeof runs !== "number" || !Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS)
  ) {
    throw invalid(`"runs" must be an integer from 1 to ${MAX_RUNS}.`);
  }
  originOf(manifest.origin);
}

/** The manifest as written: TOML, the keys in one order, the `[origin]` table last. */
function serializeBenchmarkManifest(manifest: BenchmarkManifest): string {
  const table: Record<string, unknown> = {
    id: manifest.id,
    title: manifest.title,
    ...(manifest.description !== undefined && manifest.description !== ""
      ? { description: manifest.description }
      : {}),
    ...(manifest.version !== undefined ? { version: manifest.version } : {}),
    status: manifest.status,
    ...(manifest.runs !== undefined ? { runs: manifest.runs } : {}),
  };
  if (manifest.origin !== undefined) {
    const origin: Record<string, string> = { kind: manifest.origin.kind };
    for (const field of ORIGIN_TEXT_FIELDS) {
      const value = manifest.origin[field];
      if (value !== undefined) origin[field] = value;
    }
    table.origin = origin;
  }
  return stringifyToml(table);
}

/**
 * Writes `manifest` as `benchDir/benchmark_config.toml`, replacing it atomically. `benchDir` may
 * be a staging directory that is renamed into place afterwards, so its name is not checked against
 * the id; checkBenchmarkManifest is, and a manifest it refuses is never written.
 */
export async function writeBenchmarkManifest(
  benchDir: string,
  manifest: BenchmarkManifest,
): Promise<void> {
  checkBenchmarkManifest(manifest);
  await atomicWriteFile(
    path.join(benchDir, BENCHMARK_MANIFEST),
    serializeBenchmarkManifest(manifest),
  );
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

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * The manifest of the Benchmark in `benchDir`, or null when the directory is not a Benchmark: its
 * name is not an id (`.seeding/`, `.harbor/`), or it holds no manifest. A manifest that is there
 * but cannot be read throws: a BenchmarkManifestError for what it holds, the filesystem's error
 * otherwise. Reading never writes.
 */
export async function readBenchmarkManifest(benchDir: string): Promise<BenchmarkManifest | null> {
  const id = path.basename(benchDir);
  if (!isValidId(id)) return null;
  let text: string;
  try {
    text = await fs.readFile(path.join(benchDir, BENCHMARK_MANIFEST), "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return parseBenchmarkManifest(text, id);
}
