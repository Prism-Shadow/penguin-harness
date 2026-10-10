/**
 * Benchmark score reading: walks the Project's `benchmarks/<id>/`, reads the manifest
 * `benchmark.json` (core's readBenchmarkManifest: title, description, per-case run count `runs`,
 * the build `status` — `draft` while the Benchmark is still being written, `failed` when its
 * calibration never produced a result to freeze, `published` otherwise — the date `version` and
 * the `origin`) and `scoreboard.yaml` (evaluations[], each carrying the Agent it tested, each
 * case its model-written averages and a runs array).
 * Content is normally created and refined by the benchmark-design Skill; the server also
 * writes the same layout for a Benchmark created by hand (`create`) or uploaded as a package
 * (`importArchive`, whose copy starts with an empty scoreboard and whose overwrite replaces the
 * directory whole), packs a Benchmark's package for download (`exportArchive`), and removes a
 * Benchmark directory whole (`remove`); it never edits a scoreboard. A built-in Benchmark is
 * read like any other: its cases run elsewhere (their statements say how), and the service does
 * not know or care.
 * A manifest is what makes a directory a Benchmark: `list` skips one without it. A Benchmark
 * from before benchmark.json has `benchmark_config.toml` instead, which the read converts
 * (compat(0.3.0), in core). A manifest that is there but says something unusable lists the
 * Benchmark as failed, under its directory name, with `manifestError` saying why, so nothing
 * offers to use it; a corrupt scoreboard degrades to no scores. A filesystem error reading a
 * manifest is not a fact about the Benchmark and fails the request.
 *
 * Case and Evaluation averages are authoritative file values. The server validates
 * the current shape but never recomputes aggregates and does not migrate or backfill
 * old Scoreboard formats.
 * Docs: /docs/self-improvement § "Benchmark storage".
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  BenchmarkManifestError,
  benchmarksDir,
  nextDateVersion,
  placeBenchmark,
  readBenchmarkManifest,
  writeBenchmarkManifest,
  type BenchmarkManifest,
} from "@prismshadow/penguin-core";
import type {
  BenchmarkCaseScore,
  BenchmarkCaseSummary,
  BenchmarkCasesResponse,
  BenchmarkEvaluation,
  BenchmarkOrigin,
  BenchmarkRunScore,
  BenchmarkSummary,
  BenchmarksResponse,
  CaseMaterial,
  WorkspaceFilesResponse,
} from "../api/types.js";
import type { WorkspaceFileContent, WorkspaceFileReadOptions } from "./workspace-files-service.js";
import { packBenchmark, readBenchmarkArchive } from "./benchmark-archive.js";
import { HttpError } from "../http/errors.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import type { Benchmarks } from "../mechanisms/agents.js";
import type { WorkspaceFiles } from "../mechanisms/workspace.js";

const STATEMENT_TITLE_READ_BYTES = 64 * 1024;

/** One case of a hand-made Benchmark; ids are validated by the route before they reach the filesystem. */
export interface BenchmarkCaseInput {
  id: string;
  title: string;
  statement: string;
  rubric: string;
}

export interface BenchmarkCreateInput {
  id: string;
  title: string;
  description?: string;
  runs: number;
  cases: BenchmarkCaseInput[];
}

/** A Benchmark's package as a zip, and the name its download is offered under. */
export interface BenchmarkArchive {
  /** `<id>-v<version>.zip`. */
  fileName: string;
  data: Uint8Array;
}

/** A taken id: `details.benchmarkId` names it, for the Web App's overwrite confirm and the CLI. */
function benchmarkExists(id: string): HttpError {
  return new HttpError(409, "benchmark_exists", `Benchmark already exists: ${id}`, undefined, {
    benchmarkId: id,
  });
}

/** Whether anything is under `p`; a symlink counts, wherever it points. */
async function occupied(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** The manifest's origin as the API carries it: camelCase, like every other DTO field. */
function originDto(origin: BenchmarkManifest["origin"]): BenchmarkOrigin {
  return {
    kind: origin.kind,
    ...(origin.url !== undefined ? { url: origin.url } : {}),
    ...(origin.ref !== undefined ? { ref: origin.ref } : {}),
    ...(origin.path !== undefined ? { path: origin.path } : {}),
    ...(origin.imported_at !== undefined ? { importedAt: origin.imported_at } : {}),
  };
}

function numberOr(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function scoreOr(v: unknown): number | undefined {
  const value = numberOr(v);
  return value !== undefined && value >= 0 && value <= 100 ? value : undefined;
}

function nonNegativeOr(v: unknown): number | undefined {
  const value = numberOr(v);
  return value !== undefined && value >= 0 ? value : undefined;
}

function nonNegativeIntegerOr(v: unknown): number | undefined {
  const value = nonNegativeOr(v);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

/** `null` is the one valid unknown-cost representation; undefined means invalid input. */
function nullableCostOr(v: unknown): number | null | undefined {
  if (v === null) return null;
  return nonNegativeOr(v);
}

function stringOr(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/**
 * The Agent under test on one evaluation. Unlike the runtime fields it never invalidates a
 * record: a scoreboard written before evaluations carried one still displays, unlabelled.
 */
function agentIdOr(v: unknown): string | null {
  const value = typeof v === "string" ? v.trim() : "";
  return value !== "" ? value : null;
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function statementTitle(statement: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(statement)?.[1]?.trim();
  return heading?.replace(/^Case\s+\d+\s*:\s*/i, "") || fallback;
}

async function readStatementTitle(readme: string, fallback: string): Promise<string> {
  const handle = await fs.open(readme, "r");
  try {
    const buffer = Buffer.alloc(STATEMENT_TITLE_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return statementTitle(buffer.subarray(0, bytesRead).toString("utf8"), fallback);
  } finally {
    await handle.close();
  }
}

/** Shapes one current-format Run; a malformed entry invalidates its containing Case. */
function toRun(v: unknown): BenchmarkRunScore | null {
  const r = asRecord(v);
  const score = scoreOr(r.score);
  const cost = nullableCostOr(r.cost);
  const durationMs = nonNegativeIntegerOr(r.duration_ms);
  const sessionId = stringOr(r.session_id);
  if (score === undefined || cost === undefined || durationMs === undefined || !sessionId)
    return null;
  return { score, cost, durationMs, sessionId };
}

/**
 * Shapes one current-format Case. Its stored aggregates are trusted as written:
 * this parser intentionally performs no average or consistency calculation.
 */
function toCase(v: unknown): BenchmarkCaseScore | null {
  const cr = asRecord(v);
  const caseId = stringOr(cr.case);
  const score = scoreOr(cr.score);
  const cost = nullableCostOr(cr.cost);
  const durationMs = nonNegativeIntegerOr(cr.duration_ms);
  if (
    !caseId ||
    score === undefined ||
    cost === undefined ||
    durationMs === undefined ||
    "max_score" in cr ||
    !Array.isArray(cr.runs) ||
    cr.runs.length === 0
  ) {
    return null;
  }
  const parsedRuns = cr.runs.map(toRun);
  if (parsedRuns.some((run) => run === null)) return null;
  const runs = parsedRuns as BenchmarkRunScore[];
  return {
    case: caseId,
    score,
    cost,
    durationMs,
    runs,
  };
}

/** Shapes one current-format Evaluation and trusts its stored aggregate metrics. */
function toEvaluation(v: unknown): BenchmarkEvaluation | null {
  const r = asRecord(v);
  const time = r.time instanceof Date ? r.time.toISOString() : r.time;
  const agentId = agentIdOr(r.agent_id);
  const score = scoreOr(r.score);
  const cost = nullableCostOr(r.cost);
  const durationMs = nonNegativeIntegerOr(r.duration_ms);
  const summary = stringOr(r.summary);
  // Title and body are separate: summary_title is a one-line
  // conclusion, summary is the body text.
  const summaryTitle = stringOr(r.summary_title);
  const modelId = stringOr(r.model_id);
  const provider = stringOr(r.provider);
  const thinkingLevel = stringOr(r.thinking_level);
  const version = nonNegativeIntegerOr(r.version);
  if (
    typeof time !== "string" ||
    time === "" ||
    score === undefined ||
    cost === undefined ||
    durationMs === undefined ||
    !modelId ||
    !provider ||
    !thinkingLevel ||
    version === undefined ||
    version < 1 ||
    !Array.isArray(r.cases) ||
    r.cases.length === 0
  ) {
    return null;
  }
  const parsedCases = r.cases.map(toCase);
  if (parsedCases.some((item) => item === null)) return null;
  const cases = parsedCases as BenchmarkCaseScore[];
  return {
    time,
    agentId,
    ...(summaryTitle !== undefined ? { summaryTitle } : {}),
    ...(summary !== undefined ? { summary } : {}),
    modelId,
    provider,
    thinkingLevel,
    score,
    version,
    cost,
    durationMs,
    cases,
  };
}

@Component()
export class BenchmarkService implements Benchmarks {
  @Use() private readonly paths!: Paths;
  private get root(): string {
    return this.paths.root;
  }
  @Use() private readonly workspaceFiles!: WorkspaceFiles;

  async list(projectId: string): Promise<BenchmarksResponse> {
    const dir = benchmarksDir(this.root, projectId);
    let items: Array<{ name: string; isDir: boolean }>;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      items = entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    } catch {
      return { benchmarks: [] }; // Doesn't exist when unconfigured.
    }
    const benchmarks: BenchmarkSummary[] = [];
    for (const item of items.filter((i) => i.isDir).sort((a, b) => a.name.localeCompare(b.name))) {
      const benchDir = path.join(dir, item.name);
      // Only a manifest makes a directory a Benchmark — it is the file the evaluation Skills
      // require, and without it there is no title and no run count. A Benchmark deleted while an
      // evaluation is still running comes back as the paths that run keeps writing, manifest not
      // among them; that debris is not a Benchmark and is not listed, and neither is staging or
      // the Harbor checkouts, whose names are not ids. Absence of results is not absence of a
      // Benchmark: one that has never run has its manifest and lists as usual.
      const manifest = await this.manifestOf(benchDir);
      if (manifest === null) continue;
      benchmarks.push(await this.summarize(benchDir, item.name, manifest));
    }
    return { benchmarks };
  }

  /**
   * Every id `create` refuses as taken, as names only: each entry under `benchmarks/`. Unlike
   * `list`, this includes a directory with no manifest (the debris of one deleted
   * mid-evaluation), and it reads no manifest and no scoreboard.
   */
  async takenIds(projectId: string): Promise<string[]> {
    try {
      return await fs.readdir(benchmarksDir(this.root, projectId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  /**
   * Creates `benchmarks/<id>/` in the layout the evaluation Skills read: `benchmark.json` (title,
   * description, runs, status `published`, the day's first version, origin `manual`),
   * `scoreboard.yaml` with an empty evaluations list, and per case `statement/README.md`
   * (`# <title>`, then the statement) and `rubric/README.md` (the rubric verbatim). An existing
   * directory is a 409, never merged into: a Benchmark's scores stay comparable only while its
   * cases are rewritten by nothing but the Skills. A half-written directory is removed again when
   * a later write fails.
   */
  async create(projectId: string, input: BenchmarkCreateInput): Promise<BenchmarkSummary> {
    const dir = benchmarksDir(this.root, projectId);
    const benchDir = path.join(dir, input.id);
    await fs.mkdir(dir, { recursive: true });
    try {
      // A non-recursive mkdir is the existence check: it fails atomically on a directory
      // that is already there, so two creates of one id cannot both proceed.
      await fs.mkdir(benchDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw benchmarkExists(input.id);
      throw error;
    }
    const manifest: BenchmarkManifest = {
      id: input.id,
      title: input.title,
      ...(input.description !== undefined && input.description !== ""
        ? { description: input.description }
        : {}),
      version: nextDateVersion(),
      // A Benchmark made by hand is complete the moment it is submitted: its cases are written
      // and frozen, so nothing is left for a Skill to finish.
      status: "published",
      runs: input.runs,
      origin: { kind: "manual" },
    };
    try {
      await writeBenchmarkManifest(benchDir, manifest);
      await fs.writeFile(
        path.join(benchDir, "scoreboard.yaml"),
        stringifyYaml({ evaluations: [] }),
        "utf8",
      );
      for (const item of input.cases) {
        const caseDir = path.join(benchDir, item.id);
        await fs.mkdir(path.join(caseDir, "statement"), { recursive: true });
        await fs.mkdir(path.join(caseDir, "rubric"), { recursive: true });
        await fs.writeFile(
          path.join(caseDir, "statement", "README.md"),
          `# ${item.title.trim()}\n\n${item.statement.trim()}\n`,
          "utf8",
        );
        await fs.writeFile(
          path.join(caseDir, "rubric", "README.md"),
          `${item.rubric.trim()}\n`,
          "utf8",
        );
      }
    } catch (error) {
      await fs.rm(benchDir, { recursive: true, force: true });
      throw error;
    }
    return this.summarize(benchDir, input.id, manifest);
  }

  /**
   * Removes `benchmarks/<id>/` whole — cases, config and scoreboard. Only a real directory
   * counts as existing: a symlink there is not followed, so nothing outside the Project's own
   * benchmarks directory can be deleted through this route.
   */
  async remove(projectId: string, benchmarkId: string): Promise<void> {
    const benchDir = path.join(benchmarksDir(this.root, projectId), benchmarkId);
    let isDirectory = false;
    try {
      isDirectory = (await fs.lstat(benchDir)).isDirectory();
    } catch {
      // Missing: reported below as not found.
    }
    if (!isDirectory) {
      throw new HttpError(404, "not_found", `Benchmark does not exist: ${benchmarkId}`);
    }
    await fs.rm(benchDir, { recursive: true, force: true });
  }

  /**
   * Writes the package an uploaded zip holds as `benchmarks/<id>/` (benchmark-archive.ts says what
   * is refused and why). What lands is the package as a new copy: its cases byte for byte, its
   * manifest with the origin rewritten to `zip` and the time of this import (the version stays the
   * package's: it names the content, not the copy), and a `scoreboard.yaml` with no evaluations —
   * a package carries none. A taken id is a 409 unless `overwrite`, which replaces the whole
   * directory, its scoreboard and `.jobs/` included. The copy is staged and renamed into place,
   * so a failed write leaves the id as it was.
   */
  async importArchive(
    projectId: string,
    archive: Uint8Array,
    options: { overwrite: boolean },
  ): Promise<BenchmarkSummary> {
    const { manifest: packaged, caseFiles } = readBenchmarkArchive(archive);
    const dir = benchmarksDir(this.root, projectId);
    const benchDir = path.join(dir, packaged.id);
    await fs.mkdir(dir, { recursive: true });
    if (!options.overwrite && (await occupied(benchDir))) throw benchmarkExists(packaged.id);
    const manifest: BenchmarkManifest = {
      ...packaged,
      origin: { kind: "zip", imported_at: new Date().toISOString() },
    };
    try {
      await placeBenchmark(
        dir,
        manifest.id,
        async (stage) => {
          for (const [rel, data] of caseFiles) {
            const file = path.join(stage, ...rel.split("/"));
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, data);
          }
          await writeBenchmarkManifest(stage, manifest);
          await fs.writeFile(
            path.join(stage, "scoreboard.yaml"),
            stringifyYaml({ evaluations: [] }),
            "utf8",
          );
        },
        { replace: options.overwrite },
      );
    } catch (error) {
      // Taken before this copy was renamed in: by another import of the same id after the check
      // above, or, under `overwrite`, by another overwrite whose copy went in first. Either way the
      // id now holds someone else's copy, which the person may choose to overwrite in turn.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTEMPTY" || code === "EEXIST") throw benchmarkExists(manifest.id);
      throw error;
    }
    return this.summarize(benchDir, manifest.id, manifest);
  }

  /**
   * The Benchmark's package as a zip for download (benchmark-archive.ts says what it holds). Only
   * a published Benchmark has one to give: a draft is still being written, a failed one never
   * finished calibrating, and one whose manifest cannot be read has no manifest to give (409, with
   * the reason). As for `remove`, only a real directory counts: a symlink is not followed.
   */
  async exportArchive(projectId: string, benchmarkId: string): Promise<BenchmarkArchive> {
    const benchDir = path.join(benchmarksDir(this.root, projectId), benchmarkId);
    let isDirectory = false;
    try {
      isDirectory = (await fs.lstat(benchDir)).isDirectory();
    } catch {
      // Missing: reported below as not found.
    }
    const manifest = isDirectory ? await this.manifestOf(benchDir) : null;
    if (manifest === null) {
      throw new HttpError(404, "not_found", `Benchmark does not exist: ${benchmarkId}`);
    }
    if (manifest instanceof BenchmarkManifestError) {
      throw new HttpError(
        409,
        manifest.code,
        `The Benchmark's manifest cannot be read, so it has no package to export: ${manifest.message}`,
      );
    }
    if (manifest.status !== "published") {
      throw new HttpError(
        409,
        "benchmark_not_published",
        `Only a published Benchmark can be exported; ${benchmarkId} is ${manifest.status}.`,
      );
    }
    return {
      fileName: `${benchmarkId}-v${manifest.version}.zip`,
      data: await packBenchmark(benchDir, manifest),
    };
  }

  async listCases(projectId: string, benchmarkId: string): Promise<BenchmarkCasesResponse> {
    const baseDir = benchmarksDir(this.root, projectId);
    const benchDir = path.join(baseDir, benchmarkId);
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    let realBaseDir: string;
    let realBenchDir: string;
    try {
      [entries, realBaseDir, realBenchDir] = await Promise.all([
        fs.readdir(benchDir, { withFileTypes: true }),
        fs.realpath(baseDir),
        fs.realpath(benchDir),
      ]);
    } catch {
      return { cases: [] };
    }
    if (!isWithin(realBaseDir, realBenchDir)) return { cases: [] };

    const cases: BenchmarkCaseSummary[] = [];
    for (const entry of entries
      .filter((item) => item.isDirectory() && item.name.startsWith("CASE-"))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const fallback: BenchmarkCaseSummary = { id: entry.name, title: entry.name };
      try {
        const statementDir = await this.caseMaterialRoot(
          projectId,
          benchmarkId,
          entry.name,
          "statement",
        );
        const realReadme = await fs.realpath(path.join(statementDir, "README.md"));
        if (!isWithin(statementDir, realReadme)) throw new Error("README escapes Statement");
        cases.push({
          id: entry.name,
          title: await readStatementTitle(realReadme, entry.name),
        });
      } catch {
        cases.push(fallback);
      }
    }
    return { cases };
  }

  async listCaseFiles(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
  ): Promise<WorkspaceFilesResponse> {
    const materialRoot = await this.caseMaterialRoot(projectId, benchmarkId, caseId, material);
    return this.workspaceFiles.list(materialRoot, rel);
  }

  async readCaseFile(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
    options?: WorkspaceFileReadOptions,
  ): Promise<WorkspaceFileContent> {
    const materialRoot = await this.caseMaterialRoot(projectId, benchmarkId, caseId, material);
    return this.workspaceFiles.read(materialRoot, rel, options);
  }

  private async caseMaterialRoot(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    material: CaseMaterial,
  ): Promise<string> {
    const benchDir = path.join(benchmarksDir(this.root, projectId), benchmarkId);
    const caseDir = path.join(benchDir, caseId);
    const materialRoot = path.join(caseDir, material);
    try {
      const [realBenchDir, realCaseDir, realMaterialRoot] = await Promise.all([
        fs.realpath(benchDir),
        fs.realpath(caseDir),
        fs.realpath(materialRoot),
      ]);
      if (
        !isWithin(realBenchDir, realCaseDir) ||
        path.dirname(realMaterialRoot) !== realCaseDir ||
        path.basename(realMaterialRoot) !== material
      ) {
        throw new Error("Case material is not canonical");
      }
      return realMaterialRoot;
    } catch {
      throw new HttpError(404, "not_found", `Case ${material} does not exist.`);
    }
  }

  /**
   * The manifest of `benchDir` (a legacy TOML is converted on the way, in core): null when the
   * directory is not a Benchmark, the BenchmarkManifestError when it is one whose manifest says
   * something unusable — not JSON, a field out of shape, an id that is not its directory's, a
   * TOML that does not parse. Such a Benchmark is listed as broken rather than hidden. Any other
   * error (the file cannot be read at all) is thrown.
   */
  private async manifestOf(
    benchDir: string,
  ): Promise<BenchmarkManifest | BenchmarkManifestError | null> {
    try {
      return await readBenchmarkManifest(benchDir);
    } catch (error) {
      if (error instanceof BenchmarkManifestError) return error;
      throw error;
    }
  }

  private async summarize(
    benchDir: string,
    id: string,
    manifest: BenchmarkManifest | BenchmarkManifestError,
  ): Promise<BenchmarkSummary> {
    // The manifest: title, description, per-case run count, build status, version and origin.
    // The model isn't part of it — each evaluation carries the Model actually used for that
    // run. One that cannot be read lists under the directory name as failed — unusable until
    // the file is fixed — with the reason, and neither a version nor an origin.
    const described: Pick<
      BenchmarkSummary,
      "title" | "description" | "runs" | "status" | "version" | "origin" | "manifestError"
    > =
      manifest instanceof BenchmarkManifestError
        ? {
            title: id,
            status: "failed",
            manifestError: { code: manifest.code, message: manifest.message },
          }
        : {
            title: manifest.title,
            ...(manifest.description !== undefined ? { description: manifest.description } : {}),
            runs: manifest.runs,
            status: manifest.status,
            version: manifest.version,
            origin: originDto(manifest.origin),
          };

    // scoreboard.yaml: evaluations[] is appended over time; bad entries are dropped one by one.
    let evaluations: BenchmarkEvaluation[] = [];
    try {
      const scoreboard = asRecord(
        parseYaml(await fs.readFile(path.join(benchDir, "scoreboard.yaml"), "utf8")),
      );
      if (Array.isArray(scoreboard.evaluations)) {
        evaluations = scoreboard.evaluations
          .map(toEvaluation)
          .filter((e): e is BenchmarkEvaluation => e !== null);
      }
    } catch {
      // No scores yet.
    }

    // Case count: number of semantic Case subfolders.
    let caseCount = 0;
    try {
      const entries = await fs.readdir(benchDir, { withFileTypes: true });
      caseCount = entries.filter((e) => e.isDirectory() && e.name.startsWith("CASE-")).length;
    } catch {
      // Stays at 0.
    }

    return {
      id,
      ...described,
      caseCount,
      evaluations,
      // Which Agents this Benchmark has evaluated is a fact of its scoreboard, not of its
      // manifest: first-seen order, so the list reads in the order the Agents were tested.
      agentIds: [
        ...new Set(
          evaluations
            .map((evaluation) => evaluation.agentId)
            .filter((agentId): agentId is string => agentId !== null),
        ),
      ],
    };
  }
}
