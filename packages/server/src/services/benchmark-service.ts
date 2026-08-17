/**
 * Benchmark score reading (read-only display): walks `benchmarks/<id>/`, reads
 * `benchmark_config.toml` (title, description, per-case run count `runs`) and
 * `scoreboard.yaml` (evaluations[], each case carries its model-written averages
 * and a runs array).
 * Content is created and refined by benchmark_builder; the server only reads it.
 * Missing or corrupt files always degrade gracefully (title falls back to the
 * directory name, scores come back empty) rather than throwing.
 *
 * Case and Evaluation averages are authoritative file values. The server validates
 * the current shape but never recomputes aggregates and does not migrate or backfill
 * old Scoreboard formats.
 * Docs: /docs/self-improvement § "Benchmark storage".
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { benchmarksDir } from "@prismshadow/penguin-core";
import type {
  BenchmarkCaseScore,
  BenchmarkCaseSummary,
  BenchmarkCasesResponse,
  BenchmarkEvaluation,
  BenchmarkProvenance,
  BenchmarkProvenanceSkill,
  BenchmarkRunScore,
  BenchmarkSummary,
  BenchmarksResponse,
  CaseMaterial,
  WorkspaceFilesResponse,
} from "../api/types.js";
import type {
  WorkspaceFileContent,
  WorkspaceFileReadOptions,
  WorkspaceFilesService,
} from "./workspace-files-service.js";
import { HttpError } from "../http/errors.js";

const STATEMENT_TITLE_READ_BYTES = 64 * 1024;

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
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

/** Shapes a single skill fingerprint entry; a bad entry (missing name/sha) returns null and is dropped. */
function toProvenanceSkill(v: unknown): BenchmarkProvenanceSkill | null {
  const r = asRecord(v);
  const name = stringOr(r.name);
  const sha = stringOr(r.sha256);
  if (name === undefined || sha === undefined) return null;
  const version = numberOr(r.version) ?? 1;
  return { name, version, sha256: sha };
}

/**
 * Shapes the provenance block (scoreboard stores it snake_case; the DTO is camelCase). The
 * top-level `agent_sha256` is the minimum requirement — without it the block carries no
 * reproducibility value, so the whole block is dropped (undefined) rather than partially kept.
 * Every other field tolerates being absent.
 */
function toProvenance(v: unknown): BenchmarkProvenance | undefined {
  const r = asRecord(v);
  const agentSha256 = stringOr(r.agent_sha256);
  if (agentSha256 === undefined) return undefined;
  const skills: BenchmarkProvenanceSkill[] = Array.isArray(r.skills)
    ? r.skills.map(toProvenanceSkill).filter((s): s is BenchmarkProvenanceSkill => s !== null)
    : [];
  const modelRec = asRecord(r.model);
  const modelProvider = stringOr(modelRec.provider);
  const modelId = stringOr(modelRec.model_id);
  const model =
    modelProvider !== undefined && modelId !== undefined
      ? { provider: modelProvider, modelId }
      : undefined;
  const thinkingLevel = stringOr(r.thinking_level);
  return {
    provenanceVersion: numberOr(r.provenance_version) ?? 1,
    version: numberOr(r.version) ?? 1,
    systemPromptSha256: stringOr(r.system_prompt_sha256) ?? "",
    agentsMdSha256: stringOr(r.agents_md_sha256) ?? "",
    toolsSha256: stringOr(r.tools_sha256) ?? "",
    skills,
    skillsSha256: stringOr(r.skills_sha256) ?? "",
    ...(model !== undefined ? { model } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    agentSha256,
  };
}

/** Shapes one current-format Evaluation and trusts its stored aggregate metrics. */
function toEvaluation(v: unknown): BenchmarkEvaluation | null {
  const r = asRecord(v);
  const time = r.time instanceof Date ? r.time.toISOString() : r.time;
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
  const provenance = toProvenance(r.provenance);
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
    ...(summaryTitle !== undefined ? { summaryTitle } : {}),
    ...(summary !== undefined ? { summary } : {}),
    modelId,
    provider,
    thinkingLevel,
    score,
    version,
    cost,
    durationMs,
    ...(provenance !== undefined ? { provenance } : {}),
    cases,
  };
}

export class BenchmarkService {
  constructor(
    private readonly root: string,
    private readonly workspaceFiles: WorkspaceFilesService,
  ) {}

  async list(projectId: string, agentId: string): Promise<BenchmarksResponse> {
    const dir = benchmarksDir(this.root, projectId, agentId);
    let items: Array<{ name: string; isDir: boolean }>;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      items = entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    } catch {
      return { benchmarks: [] }; // Doesn't exist when unconfigured.
    }
    const benchmarks: BenchmarkSummary[] = [];
    for (const item of items.filter((i) => i.isDir).sort((a, b) => a.name.localeCompare(b.name))) {
      benchmarks.push(await this.readBenchmark(path.join(dir, item.name), item.name));
    }
    return { benchmarks };
  }

  async listCases(
    projectId: string,
    agentId: string,
    benchmarkId: string,
  ): Promise<BenchmarkCasesResponse> {
    const baseDir = benchmarksDir(this.root, projectId, agentId);
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
          agentId,
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
    agentId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
  ): Promise<WorkspaceFilesResponse> {
    const materialRoot = await this.caseMaterialRoot(
      projectId,
      agentId,
      benchmarkId,
      caseId,
      material,
    );
    return this.workspaceFiles.list(materialRoot, rel);
  }

  async readCaseFile(
    projectId: string,
    agentId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
    options?: WorkspaceFileReadOptions,
  ): Promise<WorkspaceFileContent> {
    const materialRoot = await this.caseMaterialRoot(
      projectId,
      agentId,
      benchmarkId,
      caseId,
      material,
    );
    return this.workspaceFiles.read(materialRoot, rel, options);
  }

  private async caseMaterialRoot(
    projectId: string,
    agentId: string,
    benchmarkId: string,
    caseId: string,
    material: CaseMaterial,
  ): Promise<string> {
    const benchDir = path.join(benchmarksDir(this.root, projectId, agentId), benchmarkId);
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

  private async readBenchmark(benchDir: string, id: string): Promise<BenchmarkSummary> {
    // benchmark_config.toml: title, description, and per-case run count (falls back
    // to defaults if corrupt). The model isn't part of the config — each evaluation
    // carries the Model actually used for that run.
    let title = id;
    let description: string | undefined;
    let runs: number | undefined;
    try {
      const config = asRecord(
        parseToml(await fs.readFile(path.join(benchDir, "benchmark_config.toml"), "utf8")),
      );
      if (typeof config.title === "string" && config.title !== "") title = config.title;
      if (typeof config.description === "string" && config.description !== "") {
        description = config.description;
      }
      const configRuns = numberOr(config.runs);
      if (configRuns !== undefined && Number.isInteger(configRuns) && configRuns >= 1) {
        runs = configRuns;
      }
    } catch {
      // Missing or corrupt: title falls back to the directory name.
    }

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
      title,
      ...(description !== undefined ? { description } : {}),
      ...(runs !== undefined ? { runs } : {}),
      caseCount,
      evaluations,
    };
  }
}
