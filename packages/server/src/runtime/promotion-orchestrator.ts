/**
 * Automatic held-out Promotion orchestration.
 *
 * The Optimizer owns an immutable project-level request file. Runtime state lives in
 * SQLite, like schedules: the server validates the handoff, creates an isolated top-level
 * Session, and deterministically commits promote/restore after the model-authored matrix.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  DEFAULT_AGENT_ID,
  benchmarksDir,
  isValidId,
  promotionRequestPath,
  promotionRequestsDir,
  userText,
} from "@prismshadow/penguin-core";
import type { ThinkingLevelName } from "@prismshadow/penguin-core";
import type { BenchmarkEvaluation, PromotionDecision } from "../api/types.js";
import type { ProjectsRepo } from "../db/repos/projects.js";
import type { PromotionsRepo, PromotionRunRow } from "../db/repos/promotions.js";
import type { SessionsRepo } from "../db/repos/sessions.js";
import type { BenchmarkService } from "../services/benchmark-service.js";
import type { SnapshotService } from "../services/snapshot-service.js";
import type { ErrorSink } from "./error-recorder.js";

const THINKING_LEVELS = new Set<ThinkingLevelName>(["none", "low", "medium", "high", "xhigh"]);

export interface PromotionNomination {
  protocolVersion: 1;
  optimizationSessionId: string;
  testAgentId: string;
  developmentBenchmarkId: string;
  productionReferenceVersion: number;
  candidateVersion: number;
}

export interface PromotionRequest extends PromotionNomination {
  promotionBenchmarkId: string;
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevelName;
  promotionScoreboardPath: string;
}

export interface PromotionSessionCreator {
  createSession(args: {
    projectId: string;
    agentId: string;
    source: "promotion";
  }): Promise<{ sessionId: string }>;
}

export interface PromotionTaskRunner {
  startTask(
    sessionId: string,
    input: ReturnType<typeof userText>[],
  ): Promise<{ sessionId: string }>;
  invalidateAgentRuntimes(projectId: string, agentId: string): void;
}

export interface PromotionOrchestratorDeps {
  root: string;
  projects: ProjectsRepo;
  repo: PromotionsRepo;
  sessions: SessionsRepo;
  benchmarks: BenchmarkService;
  snapshots: SnapshotService;
  sessionCreator: PromotionSessionCreator;
  runner: PromotionTaskRunner;
  errors: ErrorSink;
  now?: () => Date;
}

function record(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`${field} is required.`);
  return value;
}

function requiredId(value: unknown, field: string): string {
  const id = requiredString(value, field);
  if (!isValidId(id)) throw new Error(`${field} is not a safe id.`);
  return id;
}

function requiredVersion(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value as number;
}

export function parsePromotionRequest(raw: string): PromotionNomination {
  const value = record(parseYaml(raw));
  const allowed = new Set([
    "protocol_version",
    "optimization_session_id",
    "test_agent_id",
    "development_benchmark_id",
    "production_reference_version",
    "candidate_version",
  ]);
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length > 0) throw new Error(`Unknown Promotion request fields: ${extra.join(", ")}.`);
  if (value.protocol_version !== 1) throw new Error("protocol_version must be 1.");
  const nomination: PromotionNomination = {
    protocolVersion: 1,
    optimizationSessionId: requiredId(value.optimization_session_id, "optimization_session_id"),
    testAgentId: requiredId(value.test_agent_id, "test_agent_id"),
    developmentBenchmarkId: requiredId(value.development_benchmark_id, "development_benchmark_id"),
    productionReferenceVersion: requiredVersion(
      value.production_reference_version,
      "production_reference_version",
    ),
    candidateVersion: requiredVersion(value.candidate_version, "candidate_version"),
  };
  if (nomination.candidateVersion <= nomination.productionReferenceVersion) {
    throw new Error("candidate_version must be newer than production_reference_version.");
  }
  return nomination;
}

export function promotionValidatorPrompt(request: PromotionRequest): string {
  return `You are the isolated Promotion Validator for one completed Optimization Batch.

Use the \`agent-evaluation\` Skill to evaluate the specified Test Agent on the held-out Promotion Benchmark. Do not read, search for, infer, or mention any Development Benchmark, Optimizer diagnosis, or private Optimizer Trace. Do not modify the Test Agent, its snapshots, Project configuration, or the Promotion request. The server has already validated and snapshotted the Candidate and will deterministically promote or restore it after your Session ends.

- test_agent_id: \`${request.testAgentId}\`
- optimization_session_id: \`${request.optimizationSessionId}\`
- candidate_version: \`${request.candidateVersion}\`
- production_reference_version: \`${request.productionReferenceVersion}\`
- promotion_benchmark_id: \`${request.promotionBenchmarkId}\`
- promotion_scoreboard_path: \`${request.promotionScoreboardPath}\`
- provider: \`${request.provider}\`
- model_id: \`${request.modelId}\`
- thinking_level: \`${request.thinkingLevel}\`

Run exactly one cell for every Case in the Promotion Benchmark, delegating every cell to a separate \`agent-evaluation\` subagent with \`run: 1\` and \`expected_version: ${request.candidateVersion}\`. Require a complete, valid, one-Run-per-Case matrix under the exact runtime above. On \`isolation_violated\`, stop immediately without inspecting or recording the contaminated result. Do not retry a cell that may already have started.

After a complete valid matrix, append and verify exactly one Evaluation in the Promotion Benchmark's \`scoreboard.yaml\` using \`evaluation_kind: promotion_candidate\`, the optimization and version fields above, and the normal score/cost/duration/cases shape. Do not write \`promotion_decision\`; that field belongs to the server's deterministic commit after it validates your matrix. End after reporting the Evaluation and its Test Session ids.`;
}

function sameRuntime(
  value: Pick<BenchmarkEvaluation, "provider" | "modelId" | "thinkingLevel">,
  request: PromotionRequest,
): boolean {
  return (
    value.provider === request.provider &&
    value.modelId === request.modelId &&
    value.thinkingLevel === request.thinkingLevel
  );
}

function exactOneRunMatrix(evaluation: BenchmarkEvaluation, caseIds: readonly string[]): boolean {
  if (evaluation.cases.length !== caseIds.length) return false;
  const expected = new Set(caseIds);
  const seen = new Set<string>();
  for (const item of evaluation.cases) {
    if (!expected.has(item.case) || seen.has(item.case) || item.runs.length !== 1) return false;
    seen.add(item.case);
  }
  return seen.size === expected.size;
}

function completeCandidateMatrix(
  evaluation: BenchmarkEvaluation,
  caseIds: readonly string[],
): boolean {
  if (evaluation.cases.length !== caseIds.length) return false;
  const expected = new Set(caseIds);
  const seen = new Set<string>();
  let runs: number | undefined;
  for (const item of evaluation.cases) {
    if (!expected.has(item.case) || seen.has(item.case) || item.runs.length === 0) return false;
    runs ??= item.runs.length;
    if (item.runs.length !== runs) return false;
    seen.add(item.case);
  }
  return seen.size === expected.size;
}

export class PromotionOrchestrator {
  private readonly now: () => Date;
  /** Per-batch serialization: a Promotion completion may race the dispatch call that started it. */
  private readonly serial = new Map<string, Promise<void>>();

  constructor(private readonly deps: PromotionOrchestratorDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Startup recovery: discover committed requests, then converge interrupted runs safely. */
  async start(): Promise<void> {
    // Existing rows predate this process. A queued request is safe to launch once; a
    // previously-running held-out matrix has unknown partial execution, so never rerun it.
    for (const row of this.deps.repo.listUnfinished()) {
      if (row.status === "queued") await this.dispatch(row);
      else await this.finalize(row, "promotion_interrupted");
    }
    for (const project of this.deps.projects.listAll()) {
      let names: string[] = [];
      try {
        names = (await fs.readdir(promotionRequestsDir(this.deps.root, project.projectId))).filter(
          (name) => name.endsWith(".yaml"),
        );
      } catch {
        // A Project without requests has nothing to reconcile.
      }
      for (const name of names) {
        await this.processRequest(project.projectId, name.slice(0, -5));
      }
    }
  }

  /** SessionManager completion hook for both Optimizer and Promotion Sessions. */
  async onTaskSettled(ctx: {
    projectId: string;
    agentId: string;
    sessionId: string;
  }): Promise<void> {
    const promotion = this.deps.repo.findByPromotionSession(ctx.sessionId);
    if (promotion) {
      await this.finalize(promotion);
      return;
    }
    await this.processRequest(ctx.projectId, ctx.sessionId);
  }

  private async processRequest(projectId: string, optimizationSessionId: string): Promise<void> {
    await this.enqueue(optimizationSessionId, async () => {
      await this.processRequestNow(projectId, optimizationSessionId);
    });
  }

  private async processRequestNow(projectId: string, optimizationSessionId: string): Promise<void> {
    try {
      const file = promotionRequestPath(this.deps.root, projectId, optimizationSessionId);
      let raw: string;
      try {
        raw = await fs.readFile(file, "utf8");
      } catch {
        return;
      }
      const nomination = parsePromotionRequest(raw);
      if (nomination.optimizationSessionId !== optimizationSessionId) {
        throw new Error("Request filename and optimization_session_id differ.");
      }
      const requestHash = createHash("sha256").update(raw).digest("hex");
      const registered = this.deps.repo.find(optimizationSessionId);
      if (registered) {
        if (registered.projectId !== projectId || registered.requestHash !== requestHash) {
          throw new Error("An immutable Promotion request changed after registration.");
        }
        return;
      }
      const optimizer = this.deps.sessions.findById(optimizationSessionId);
      if (!optimizer || optimizer.projectId !== projectId) {
        throw new Error("Optimizer Session does not belong to this Project.");
      }

      const all = (await this.deps.benchmarks.list(projectId, nomination.testAgentId)).benchmarks;
      const development = all.find((item) => item.id === nomination.developmentBenchmarkId);
      const promotion = development?.pairedBenchmarkId
        ? all.find((item) => item.id === development.pairedBenchmarkId)
        : undefined;
      if (
        !development ||
        development.role !== "development" ||
        !promotion ||
        promotion.role !== "promotion" ||
        promotion.pairedBenchmarkId !== nomination.developmentBenchmarkId
      ) {
        throw new Error("Development and Promotion Benchmarks are not an explicit pair.");
      }
      const nominated = development.evaluations
        .filter(
          (item) =>
            item.evaluationKind === "development_candidate" &&
            item.optimizationSessionId === optimizationSessionId,
        )
        .at(-1);
      const developmentReference = development.evaluations
        .filter(
          (item) =>
            item.version === nomination.productionReferenceVersion &&
            (item.evaluationKind === "formal_baseline" ||
              item.evaluationKind === "development_candidate"),
        )
        .at(-1);
      const developmentCaseIds = (
        await this.deps.benchmarks.listCases(
          projectId,
          nomination.testAgentId,
          nomination.developmentBenchmarkId,
        )
      ).cases.map((item) => item.id);
      if (
        !nominated ||
        !developmentReference ||
        nominated.version !== nomination.candidateVersion ||
        nominated.productionReferenceVersion !== nomination.productionReferenceVersion ||
        nominated.score <= developmentReference.score
      ) {
        throw new Error("Request does not nominate the batch's final accepted Candidate.");
      }
      const reference = promotion.evaluations
        .filter(
          (item) =>
            item.version === nomination.productionReferenceVersion &&
            (item.evaluationKind === "formal_baseline" ||
              (item.evaluationKind === "promotion_candidate" &&
                item.promotionDecision === "promoted")),
        )
        .at(-1);
      if (!reference || !THINKING_LEVELS.has(reference.thinkingLevel as ThinkingLevelName)) {
        throw new Error("Promotion Reference has no complete frozen runtime.");
      }
      const request: PromotionRequest = {
        ...nomination,
        promotionBenchmarkId: promotion.id,
        provider: reference.provider,
        modelId: reference.modelId,
        thinkingLevel: reference.thinkingLevel as ThinkingLevelName,
        promotionScoreboardPath: path.join(
          benchmarksDir(this.deps.root, projectId, nomination.testAgentId),
          promotion.id,
          "scoreboard.yaml",
        ),
      };
      if (
        developmentCaseIds.length === 0 ||
        !completeCandidateMatrix(nominated, developmentCaseIds) ||
        !completeCandidateMatrix(developmentReference, developmentCaseIds) ||
        !sameRuntime(nominated, request) ||
        !sameRuntime(developmentReference, request)
      ) {
        throw new Error("The nominated Development Evaluation is incomplete or changed runtime.");
      }
      if (
        (await this.deps.snapshots.currentVersion(projectId, request.testAgentId)) !==
        request.candidateVersion
      ) {
        throw new Error("The active Agent State no longer matches the nominated Candidate.");
      }
      await this.deps.snapshots.requireVersionSnapshot(
        projectId,
        request.testAgentId,
        request.productionReferenceVersion,
      );
      const candidateSnapshot = await this.deps.snapshots.ensureSnapshot(
        projectId,
        request.testAgentId,
      );
      if (candidateSnapshot.version !== request.candidateVersion) {
        throw new Error("Candidate snapshot version changed during request validation.");
      }
      await this.deps.snapshots.requireVersionSnapshot(
        projectId,
        request.testAgentId,
        request.candidateVersion,
      );

      const now = this.now().toISOString();
      const row: PromotionRunRow = {
        optimizationSessionId,
        projectId,
        testAgentId: request.testAgentId,
        developmentBenchmarkId: request.developmentBenchmarkId,
        promotionBenchmarkId: request.promotionBenchmarkId,
        productionReferenceVersion: request.productionReferenceVersion,
        candidateVersion: request.candidateVersion,
        provider: request.provider,
        modelId: request.modelId,
        thinkingLevel: request.thinkingLevel,
        requestHash,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      };
      const inserted = this.deps.repo.insert(row);
      const stored = this.deps.repo.find(optimizationSessionId);
      if (!stored || stored.requestHash !== row.requestHash) {
        throw new Error("An immutable Promotion request changed after registration.");
      }
      if (!inserted) return;

      const existingEvaluation = promotion.evaluations.some(
        (item) =>
          item.evaluationKind === "promotion_candidate" &&
          item.optimizationSessionId === optimizationSessionId &&
          item.version === request.candidateVersion,
      );
      if (existingEvaluation) {
        await this.finalizeNow(stored);
      } else {
        await this.dispatch(stored);
      }
    } catch (error) {
      this.deps.errors.record({
        source: "promotion",
        err: error,
        code: "promotion_request_invalid",
        ctx: { projectId, sessionId: optimizationSessionId },
      });
    }
  }

  private async enqueue(optimizationSessionId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.serial.get(optimizationSessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.serial.set(optimizationSessionId, current);
    try {
      await current;
    } finally {
      if (this.serial.get(optimizationSessionId) === current) {
        this.serial.delete(optimizationSessionId);
      }
    }
  }

  private requestOf(row: PromotionRunRow): PromotionRequest {
    return {
      protocolVersion: 1,
      optimizationSessionId: row.optimizationSessionId,
      testAgentId: row.testAgentId,
      developmentBenchmarkId: row.developmentBenchmarkId,
      promotionBenchmarkId: row.promotionBenchmarkId,
      productionReferenceVersion: row.productionReferenceVersion,
      candidateVersion: row.candidateVersion,
      provider: row.provider,
      modelId: row.modelId,
      thinkingLevel: row.thinkingLevel as ThinkingLevelName,
      promotionScoreboardPath: path.join(
        benchmarksDir(this.deps.root, row.projectId, row.testAgentId),
        row.promotionBenchmarkId,
        "scoreboard.yaml",
      ),
    };
  }

  private async dispatch(row: PromotionRunRow): Promise<void> {
    if (this.deps.repo.find(row.optimizationSessionId)?.status !== "queued") return;
    try {
      const session = await this.deps.sessionCreator.createSession({
        projectId: row.projectId,
        agentId: DEFAULT_AGENT_ID,
        source: "promotion",
      });
      this.deps.repo.markRunning(
        row.optimizationSessionId,
        session.sessionId,
        this.now().toISOString(),
      );
      await this.deps.runner.startTask(session.sessionId, [
        userText(promotionValidatorPrompt(this.requestOf(row))),
      ]);
    } catch (error) {
      await this.failAndRestore(row, "promotion_start_failed", error);
    }
  }

  private async finalize(
    row: PromotionRunRow,
    missingCode = "promotion_result_missing",
  ): Promise<void> {
    await this.enqueue(row.optimizationSessionId, async () => {
      await this.finalizeNow(row, missingCode);
    });
  }

  private async finalizeNow(
    row: PromotionRunRow,
    missingCode = "promotion_result_missing",
  ): Promise<void> {
    const currentRow = this.deps.repo.find(row.optimizationSessionId);
    if (!currentRow || !["queued", "running"].includes(currentRow.status)) return;
    row = currentRow;
    try {
      const request = this.requestOf(row);
      const all = (await this.deps.benchmarks.list(row.projectId, row.testAgentId)).benchmarks;
      const promotion = all.find((item) => item.id === row.promotionBenchmarkId);
      const development = all.find((item) => item.id === row.developmentBenchmarkId);
      const candidate = promotion?.evaluations
        .filter(
          (item) =>
            item.evaluationKind === "promotion_candidate" &&
            item.optimizationSessionId === row.optimizationSessionId &&
            item.version === row.candidateVersion &&
            item.productionReferenceVersion === row.productionReferenceVersion,
        )
        .at(-1);
      const reference = promotion?.evaluations
        .filter(
          (item) =>
            item.version === row.productionReferenceVersion &&
            (item.evaluationKind === "formal_baseline" ||
              (item.evaluationKind === "promotion_candidate" &&
                item.promotionDecision === "promoted")),
        )
        .at(-1);
      const caseIds = promotion
        ? (
            await this.deps.benchmarks.listCases(row.projectId, row.testAgentId, promotion.id)
          ).cases.map((item) => item.id)
        : [];
      const developmentCaseIds = development
        ? (
            await this.deps.benchmarks.listCases(row.projectId, row.testAgentId, development.id)
          ).cases.map((item) => item.id)
        : [];
      const nominated = development?.evaluations
        .filter(
          (item) =>
            item.evaluationKind === "development_candidate" &&
            item.optimizationSessionId === row.optimizationSessionId,
        )
        .at(-1);
      const developmentReference = development?.evaluations
        .filter(
          (item) =>
            item.version === row.productionReferenceVersion &&
            (item.evaluationKind === "formal_baseline" ||
              item.evaluationKind === "development_candidate"),
        )
        .at(-1);
      if (
        !promotion ||
        promotion.role !== "promotion" ||
        promotion.pairedBenchmarkId !== row.developmentBenchmarkId ||
        !development ||
        development.role !== "development" ||
        development.pairedBenchmarkId !== row.promotionBenchmarkId ||
        !candidate ||
        !reference ||
        !nominated ||
        !developmentReference ||
        nominated.version !== row.candidateVersion ||
        nominated.productionReferenceVersion !== row.productionReferenceVersion ||
        nominated.score <= developmentReference.score ||
        developmentCaseIds.length === 0 ||
        !completeCandidateMatrix(nominated, developmentCaseIds) ||
        !completeCandidateMatrix(developmentReference, developmentCaseIds) ||
        !sameRuntime(nominated, request) ||
        !sameRuntime(developmentReference, request) ||
        !sameRuntime(candidate, request) ||
        !sameRuntime(reference, request) ||
        caseIds.length === 0 ||
        !exactOneRunMatrix(candidate, caseIds)
      ) {
        await this.failAndRestore(row, missingCode);
        return;
      }

      const decision: PromotionDecision =
        candidate.score >= reference.score ? "promoted" : "restored";
      if (candidate.promotionDecision && candidate.promotionDecision !== decision) {
        await this.failAndRestore(row, "promotion_decision_mismatch");
        return;
      }
      const activeVersion = await this.deps.snapshots.currentVersion(
        row.projectId,
        row.testAgentId,
      );
      if (
        (decision === "promoted" && activeVersion !== row.candidateVersion) ||
        (decision === "restored" &&
          activeVersion !== row.candidateVersion &&
          activeVersion !== row.productionReferenceVersion)
      ) {
        this.deps.repo.markTerminal(
          row.optimizationSessionId,
          "failed",
          this.now().toISOString(),
          "promotion_candidate_changed",
        );
        return;
      }
      if (decision === "restored") {
        // The State may already be at the production Reference if the process died
        // after restoring but before persisting the Scoreboard decision and terminal
        // row. Treat that exact version as an idempotent commit, never as a conflict.
        if (activeVersion === row.candidateVersion) {
          await this.deps.snapshots.restoreVersion(
            row.projectId,
            row.testAgentId,
            row.productionReferenceVersion,
          );
          this.deps.runner.invalidateAgentRuntimes(row.projectId, row.testAgentId);
        }
      }
      if (!candidate.promotionDecision) {
        await this.deps.benchmarks.setPromotionDecision(
          row.projectId,
          row.testAgentId,
          row.promotionBenchmarkId,
          {
            optimizationSessionId: row.optimizationSessionId,
            candidateVersion: row.candidateVersion,
            productionReferenceVersion: row.productionReferenceVersion,
          },
          decision,
        );
      }
      this.deps.repo.markTerminal(row.optimizationSessionId, decision, this.now().toISOString());
    } catch (error) {
      await this.failAndRestore(row, "promotion_finalize_failed", error);
    }
  }

  private async failAndRestore(row: PromotionRunRow, code: string, cause?: unknown): Promise<void> {
    let finalCode = code;
    try {
      const current = await this.deps.snapshots.currentVersion(row.projectId, row.testAgentId);
      if (current === row.candidateVersion) {
        await this.deps.snapshots.restoreVersion(
          row.projectId,
          row.testAgentId,
          row.productionReferenceVersion,
        );
        this.deps.runner.invalidateAgentRuntimes(row.projectId, row.testAgentId);
      } else if (current !== row.productionReferenceVersion) {
        // Another actor changed the State after this gate started. Never overwrite that
        // unknown version with an automatic rollback; surface the conflict for a human.
        finalCode = "promotion_candidate_changed";
      }
    } catch (restoreError) {
      finalCode = "promotion_restore_failed";
      this.deps.errors.record({
        source: "promotion",
        err: restoreError,
        code: finalCode,
        ctx: {
          projectId: row.projectId,
          agentId: row.testAgentId,
          sessionId: row.promotionSessionId,
        },
      });
    }
    this.deps.repo.markTerminal(
      row.optimizationSessionId,
      "failed",
      this.now().toISOString(),
      finalCode,
    );
    if (cause !== undefined) {
      this.deps.errors.record({
        source: "promotion",
        err: cause,
        code,
        ctx: {
          projectId: row.projectId,
          agentId: row.testAgentId,
          sessionId: row.promotionSessionId,
        },
      });
    }
  }
}
