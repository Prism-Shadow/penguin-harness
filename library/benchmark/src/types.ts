/** Raw result of a single run (a scoreboard per-case runs[] entry). */
export interface BenchmarkRunScore {
  score: number;
  /** Run cost, or null when unavailable. */
  cost: number | null;
  durationMs: number;
  /** Id of the Session under test in this run (links to Trace). */
  sessionId: string;
}

export interface BenchmarkCaseScore {
  case: string;
  /** Model-written average of this Case's Run scores, on the fixed 0..100 scale. */
  score: number;
  /** Model-written average of known Run costs; null when every Run cost is unknown. */
  cost: number | null;
  /** Model-written average of Run durations, rounded to an integer. */
  durationMs: number;
  /** Raw results per Run. */
  runs: BenchmarkRunScore[];
}

export interface BenchmarkEvaluation {
  /** Evaluation timestamp (ISO 8601). */
  time: string;
  /**
   * Agent under test in this round (the `agent_id` field), part of the record's label; `null`
   * when the record carries none, as a Benchmark evaluates whichever Agents it is pointed at.
   */
  agentId: string | null;
  /** Evaluation summary title (a one-line conclusion; shown separately from the body summary; required when generating, tolerated as unset when displaying). */
  summaryTitle?: string;
  /** Evaluation summary body: how the score was derived, what optimizations were made to the Agent this round (required when generating, tolerated as unset when displaying). */
  summary?: string;
  /** Model actually used for this evaluation round (upstream id, paired with provider; the chart series is split by model). */
  modelId: string;
  /** Provider group for `modelId`. */
  provider: string;
  /** Thinking level read from the unchanged Target Agent configuration. */
  thinkingLevel: string;
  /** Agent State version under test: a build number, or a version label such as a semver string. */
  version: number | string;
  /** Model-written average of Case scores, on the fixed 0..100 scale. */
  score: number;
  /** Model-written average of known Case costs; null when every Case cost is unknown. */
  cost: number | null;
  /** Model-written average of Case durations, rounded to an integer. */
  durationMs: number;
  cases: BenchmarkCaseScore[];
}

/**
 * Whether the Skill that builds a Benchmark is done with it, and how it ended; see
 * `BenchmarkSummary.status`.
 */
export type BenchmarkStatus = "draft" | "published" | "failed";

/**
 * Where a Benchmark's copy came from: `builtin` (seeded when the Project was created), `manual`
 * (the create form), `agent` (the benchmark-design Skill wrote it), `git` (an Agent imported a
 * repository folder), `zip` (an uploaded package).
 */
export type BenchmarkOriginKind = "builtin" | "manual" | "agent" | "git" | "zip";

/**
 * Why a Benchmark's manifest cannot be read: the code of core's `BenchmarkManifestError`
 * (`benchmark_id_mismatch` for an `id` that is not the directory's, `benchmark_manifest_invalid`
 * for a file that is not TOML or a `version` or `[origin]` out of shape) and its message, which
 * names the key or the file.
 */
export interface BenchmarkManifestProblem {
  code: string;
  message: string;
}

/** The `[origin]` table of a Benchmark's benchmark_config.toml. */
export interface BenchmarkOrigin {
  kind: BenchmarkOriginKind;
  /** git: the folder link as the user gave it (a GitHub tree URL). Always an http(s) URL. */
  url?: string;
  /** git: the 40-hex commit the import resolved the link to. */
  ref?: string;
  /** git: the folder inside the repository. */
  path?: string;
  /** git / zip: when this copy was written (ISO 8601; `imported_at` in the file). */
  importedAt?: string;
}

export interface BenchmarkSummary {
  /** Directory name is the identifier (semantic naming, e.g. swe-bench-v1). */
  id: string;
  /** Title from benchmark_config.toml; the directory name when it gives none or the manifest cannot be read. */
  title: string;
  description?: string;
  /** The description in Chinese (`description_zh` in benchmark_config.toml), when the manifest gives one. */
  descriptionZh?: string;
  /** Number of runs per case (the `runs` key in benchmark_config.toml, an integer ≥ 1); absent when it gives none or the manifest cannot be read, which reads as 1. */
  runs?: number;
  /**
   * `draft` while the Skill that builds the Benchmark is still writing its cases and
   * calibrating their difficulty — the Web App masks such a Benchmark; `published` once the
   * Benchmark is frozen and its Formal Baseline recorded; `failed` when calibration ended
   * without a Pilot result that could be frozen, which leaves the Benchmark unusable — the Web
   * App masks it too and says it has to be deleted and created again. benchmark_config.toml is
   * read literally: only `draft` is a draft and only `failed` is a failure, so a missing key, or
   * any other value, reads as published. A Benchmark whose manifest cannot be read lists as
   * failed, with `manifestError`.
   */
  status: BenchmarkStatus;
  /**
   * The manifest's date version, `YYYY.MM.DD.N`: the revision of the Benchmark's content. Absent
   * when the manifest has none (one written before versions is unversioned), when it cannot be
   * read, and from a machine whose server predates versions.
   */
  version?: string;
  /**
   * Where this copy came from, the manifest's `[origin]`. Absent when the manifest has none (where
   * a copy written before origins came from is unknown), when it cannot be read, and from a
   * machine whose server predates origins.
   */
  origin?: BenchmarkOrigin;
  /**
   * Set when the manifest cannot be read. Such a Benchmark lists under its directory name, as
   * `failed`, with no version or origin, and nothing may use or export it until the file is
   * fixed; the Web App masks it with this reason.
   */
  manifestError?: BenchmarkManifestProblem;
  /** Case count (number of case subfolders). */
  caseCount: number;
  /** Time-ordered evaluation records (the evaluations[] in scoreboard.yaml). */
  evaluations: BenchmarkEvaluation[];
  /**
   * Agents this Benchmark has evaluated: the distinct non-null `agentId`s of `evaluations`, in
   * first-seen order. Empty while nothing has been evaluated — a Benchmark names no Agent of its
   * own.
   */
  agentIds: string[];
}

export interface BenchmarksResponse {
  benchmarks: BenchmarkSummary[];
}

export type CaseMaterial = "statement" | "rubric";

/** Public Benchmark Case metadata. Rubric and Gold content are never included. */
export interface BenchmarkCaseSummary {
  id: string;
  /** First Markdown heading with an optional leading "Case N:" removed; falls back to id. */
  title: string;
}

export interface BenchmarkCasesResponse {
  cases: BenchmarkCaseSummary[];
}

/**
 * POST /api/projects/:p/benchmarks (owner only): create a Benchmark by hand. The
 * server writes the on-disk layout the evaluation Skills read — `benchmark_config.toml`
 * (published, the day's first version, origin `manual`), a `scoreboard.yaml` holding
 * `evaluations: []`, and one `<case id>/` per case with `statement/README.md` and
 * `rubric/README.md`. 409 `benchmark_exists` when the directory is already there; nothing is
 * merged into an existing Benchmark.
 */
export interface BenchmarkCreateRequest {
  /** Directory name, which is the identifier: letters, digits, `_` and `-` only. */
  id: string;
  title: string;
  description?: string;
  /** Runs per case for the optimization loop (integer ≥ 1; default 1). */
  runs?: number;
  /** At least one case; ids must be unique within the request. */
  cases: BenchmarkCreateCase[];
}

export interface BenchmarkCreateCase {
  /** Case directory name: `CASE-` followed by letters, digits, `_` and `-` (for example `CASE-001-excel-task`). */
  id: string;
  /** Written as the statement README's first heading, which the case list reads back as the case title. */
  title: string;
  /** Statement body (Markdown), written after that heading; the Target Agent sees only this side. */
  statement: string;
  /** Scoring rubric (Markdown, items totalling 100 points), written verbatim as `rubric/README.md`. */
  rubric: string;
}

export interface BenchmarkCreateResponse {
  benchmark: BenchmarkSummary;
}

/**
 * POST /api/projects/:p/benchmarks/archive (any Project member): import a Benchmark package from
 * a zip. The zip holds `benchmark_config.toml` and the `CASE-*` directories, at its root (where the
 * manifest must name its `id`) or inside exactly one top-level directory named by the Benchmark's
 * id — the shape `GET …/benchmarks/:benchmarkId/archive` exports. A zip carrying
 * `scoreboard.yaml`, `.jobs/` or anything else at its top level, a link, a manifest past the
 * create form's limits, a package that is not `published` or a case without both READMEs is
 * refused (400); so is a zip past the caps (413 `benchmark_too_large`: 14MB
 * zipped, 1000 files, 5MB a file, 20MB inflated). The copy is written with origin `zip` and an
 * empty scoreboard — or origin `git`, when the request says the package is a repository folder
 * fetched at a commit. An id already taken is 409 `benchmark_exists` (`details.benchmarkId` names
 * it) unless `overwrite`.
 */
export interface BenchmarkArchiveImportRequest {
  /** The zip, base64-encoded. */
  dataBase64: string;
  /**
   * Replace the Benchmark of the same id whole — its evaluation records and `.jobs/` included.
   * Refused with 409 `benchmark_busy` while an evaluation of it is still running a trial there.
   */
  overwrite?: boolean;
  /**
   * The repository folder the package was fetched from, pinned to one commit. The copy's origin
   * is then `git` with these fields and the import time, instead of `zip`.
   */
  origin?: BenchmarkArchiveGitOrigin;
}

/** Where a package fetched from a git repository came from. */
export interface BenchmarkArchiveGitOrigin {
  kind: "git";
  /** The folder link as the user gave it: an http(s) URL, at most 2048 characters. */
  url: string;
  /** The 40-character commit the link was resolved to. */
  ref: string;
  /** The folder inside the repository, at most 1024 characters. */
  path: string;
}

export interface BenchmarkArchiveImportResponse {
  /** The imported Benchmark, as the list now reads it. */
  benchmark: BenchmarkSummary;
}
// ---------------------------------------------------------------------------
// The create/import vocabulary the service and the mechanism contract share
// ---------------------------------------------------------------------------

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

/** How an uploaded package is written: over a taken id or not, and where it came from. */
export interface BenchmarkImportOptions {
  overwrite: boolean;
  /** The repository folder the package was fetched from; absent for an upload, whose origin is `zip`. */
  origin?: BenchmarkArchiveGitOrigin;
}

/** A Benchmark's package as a zip, and the name its download is offered under. */
export interface BenchmarkArchive {
  /** `<id>-v<version>.zip`. */
  fileName: string;
  data: Uint8Array;
}
