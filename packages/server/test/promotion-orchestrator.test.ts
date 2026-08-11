import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  agentStateDir,
  benchmarksDir,
  loadOrInitAgentState,
  promotionRequestPath,
  snapshotsDir,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import { openDatabase } from "../src/db/database.js";
import { AgentsRepo } from "../src/db/repos/agents.js";
import { ProjectsRepo } from "../src/db/repos/projects.js";
import { PromotionsRepo } from "../src/db/repos/promotions.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import { UsersRepo } from "../src/db/repos/users.js";
import type { ErrorRecordArgs } from "../src/runtime/error-recorder.js";
import {
  PromotionOrchestrator,
  parsePromotionRequest,
} from "../src/runtime/promotion-orchestrator.js";
import { BenchmarkService } from "../src/services/benchmark-service.js";
import { SnapshotService } from "../src/services/snapshot-service.js";
import { WorkspaceFilesService } from "../src/services/workspace-files-service.js";
import { makeTempRoot, waitFor } from "./helpers.js";

const PROJECT = "promotion-project";
const AGENT = "target-agent";
const OPTIMIZER = "optimizer-session";
const DEVELOPMENT = "decision-development";
const PROMOTION = "decision-promotion";
const CASE = "CASE-001";

interface Harness {
  root: string;
  close(): Promise<void>;
  orchestrator: PromotionOrchestrator;
  repo: PromotionsRepo;
  snapshots: SnapshotService;
  errors: ErrorRecordArgs[];
  prompts: Array<{ sessionId: string; text: string }>;
  promotionSessionId(): string;
}

function evaluationYaml(args: {
  version: number;
  score: number;
  kind: "formal_baseline" | "development_candidate" | "promotion_candidate";
  optimizationSessionId?: string;
  productionReferenceVersion?: number;
  runs?: number;
}): Record<string, unknown> {
  const runs = Array.from({ length: args.runs ?? 1 }, (_, index) => ({
    score: args.score,
    cost: null,
    duration_ms: 10,
    session_id: `test-${args.kind}-${index + 1}`,
  }));
  return {
    time: "2026-08-12T00:00:00Z",
    version: args.version,
    provider: "custom",
    model_id: "frozen-model",
    thinking_level: "medium",
    evaluation_kind: args.kind,
    ...(args.optimizationSessionId ? { optimization_session_id: args.optimizationSessionId } : {}),
    ...(args.productionReferenceVersion
      ? { production_reference_version: args.productionReferenceVersion }
      : {}),
    score: args.score,
    cost: null,
    duration_ms: 10,
    cases: [
      {
        case: CASE,
        score: args.score,
        cost: null,
        duration_ms: 10,
        runs,
      },
    ],
  };
}

async function writeBenchmark(
  root: string,
  id: string,
  role: "development" | "promotion",
  paired: string,
  evaluations: Record<string, unknown>[],
): Promise<void> {
  const dir = path.join(benchmarksDir(root, PROJECT, AGENT), id);
  await fs.mkdir(path.join(dir, CASE, "statement"), { recursive: true });
  await fs.mkdir(path.join(dir, CASE, "rubric"), { recursive: true });
  await fs.writeFile(path.join(dir, CASE, "statement", "README.md"), "# Case 1\n");
  await fs.writeFile(path.join(dir, CASE, "rubric", "README.md"), "# Rubric\n");
  await fs.writeFile(
    path.join(dir, "benchmark_config.toml"),
    `title = "${id}"\nrole = "${role}"\npaired_benchmark_id = "${paired}"\n`,
  );
  await fs.writeFile(path.join(dir, "scoreboard.yaml"), stringifyYaml({ evaluations }));
}

async function appendPromotionEvaluation(root: string, score: number): Promise<void> {
  const file = path.join(benchmarksDir(root, PROJECT, AGENT), PROMOTION, "scoreboard.yaml");
  const scoreboard = parseYaml(await fs.readFile(file, "utf8")) as {
    evaluations: Record<string, unknown>[];
  };
  scoreboard.evaluations.push(
    evaluationYaml({
      version: 2,
      score,
      kind: "promotion_candidate",
      optimizationSessionId: OPTIMIZER,
      productionReferenceVersion: 1,
    }),
  );
  await fs.writeFile(file, stringifyYaml(scoreboard));
}

async function createHarness(
  candidatePromotionScore: number,
  beforePromotionSettles?: (root: string) => Promise<void>,
): Promise<Harness> {
  const root = await makeTempRoot();
  const db = openDatabase(":memory:");
  const users = new UsersRepo(db);
  users.insert({
    userId: "owner",
    passwordHash: "x",
    isAdmin: false,
    passwordIsInitial: false,
    createdAt: "2026-08-12T00:00:00Z",
  });
  const projects = new ProjectsRepo(db);
  projects.insert({
    projectId: PROJECT,
    ownerUserId: "owner",
    createdAt: "2026-08-12T00:00:00Z",
  });
  new AgentsRepo(db).insertOrIgnore({
    projectId: PROJECT,
    agentId: AGENT,
    createdAt: "2026-08-12T00:00:00Z",
  });
  await loadOrInitAgentState({ root, projectId: PROJECT, agentId: AGENT });
  const snapshots = new SnapshotService(root);
  await snapshots.ensureSnapshot(PROJECT, AGENT);
  const configFile = systemConfigPath(root, PROJECT, AGENT);
  const config = parseYaml(await fs.readFile(configFile, "utf8")) as Record<string, unknown>;
  config.version = 2;
  await fs.writeFile(configFile, stringifyYaml(config));

  await writeBenchmark(root, DEVELOPMENT, "development", PROMOTION, [
    evaluationYaml({ version: 1, score: 50, kind: "formal_baseline" }),
    evaluationYaml({
      version: 2,
      score: 90,
      kind: "development_candidate",
      optimizationSessionId: OPTIMIZER,
      productionReferenceVersion: 1,
      runs: 2,
    }),
  ]);
  await writeBenchmark(root, PROMOTION, "promotion", DEVELOPMENT, [
    evaluationYaml({ version: 1, score: 80, kind: "formal_baseline" }),
  ]);
  await fs.mkdir(path.dirname(promotionRequestPath(root, PROJECT, OPTIMIZER)), {
    recursive: true,
  });
  await fs.writeFile(
    promotionRequestPath(root, PROJECT, OPTIMIZER),
    stringifyYaml({
      protocol_version: 1,
      optimization_session_id: OPTIMIZER,
      test_agent_id: AGENT,
      development_benchmark_id: DEVELOPMENT,
      production_reference_version: 1,
      candidate_version: 2,
    }),
  );

  const sessions = new SessionsRepo(db);
  sessions.insert({
    sessionId: OPTIMIZER,
    projectId: PROJECT,
    agentId: "default_agent",
    provider: "custom",
    modelId: "orchestrator-model",
    workspace: "/tmp/optimizer",
    approvalMode: "allow-all",
    title: null,
    createdAt: "2026-08-12T00:00:00Z",
  });
  const repo = new PromotionsRepo(db);
  const benchmarks = new BenchmarkService(root, new WorkspaceFilesService());
  const errors: ErrorRecordArgs[] = [];
  const prompts: Array<{ sessionId: string; text: string }> = [];
  let seq = 0;
  let orchestrator!: PromotionOrchestrator;
  orchestrator = new PromotionOrchestrator({
    root,
    projects,
    repo,
    sessions,
    benchmarks,
    snapshots,
    sessionCreator: {
      createSession: async () => {
        const sessionId = `promotion-session-${++seq}`;
        sessions.insert({
          sessionId,
          projectId: PROJECT,
          agentId: "default_agent",
          provider: "custom",
          modelId: "orchestrator-model",
          workspace: "/tmp/promotion",
          approvalMode: "allow-all",
          title: null,
          createdAt: "2026-08-12T00:00:01Z",
        });
        return { sessionId };
      },
    },
    runner: {
      startTask: async (sessionId, input) => {
        const text = input[0]?.payload.text ?? "";
        prompts.push({ sessionId, text });
        await appendPromotionEvaluation(root, candidatePromotionScore);
        await beforePromotionSettles?.(root);
        // SessionManager fires this callback without awaiting it. Trigger it before
        // dispatch returns to prove the per-Batch serialization cannot lose the result.
        void orchestrator.onTaskSettled({
          projectId: PROJECT,
          agentId: "default_agent",
          sessionId,
        });
        return { sessionId };
      },
      invalidateAgentRuntimes: () => undefined,
    },
    errors: { record: (args) => void errors.push(args) },
    now: () => new Date("2026-08-12T00:00:02Z"),
  });
  return {
    root,
    orchestrator,
    repo,
    snapshots,
    errors,
    prompts,
    promotionSessionId: () => `promotion-session-${seq}`,
    close: async () => {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

const openHarnesses: Harness[] = [];
afterEach(async () => {
  await Promise.all(openHarnesses.splice(0).map((item) => item.close()));
});

describe("PromotionOrchestrator", () => {
  it("keeps the nomination protocol minimal and requires a newer Candidate", () => {
    const valid = [
      "protocol_version: 1",
      `optimization_session_id: ${OPTIMIZER}`,
      `test_agent_id: ${AGENT}`,
      `development_benchmark_id: ${DEVELOPMENT}`,
      "production_reference_version: 1",
      "candidate_version: 2",
    ].join("\n");
    expect(parsePromotionRequest(valid)).toMatchObject({
      optimizationSessionId: OPTIMIZER,
      candidateVersion: 2,
    });
    expect(() =>
      parsePromotionRequest(`${valid}\npromotion_benchmark_id: private-heldout\n`),
    ).toThrow(/Unknown Promotion request fields/);
    expect(() =>
      parsePromotionRequest(valid.replace("candidate_version: 2", "candidate_version: 1")),
    ).toThrow(/must be newer/);
  });

  it("automatically dispatches one isolated top-level gate and promotes deterministically", async () => {
    const h = await createHarness(85);
    openHarnesses.push(h);

    await h.orchestrator.onTaskSettled({
      projectId: PROJECT,
      agentId: "default_agent",
      sessionId: OPTIMIZER,
    });
    await waitFor(() => h.repo.find(OPTIMIZER) !== null || h.errors.length > 0);
    expect(h.errors).toEqual([]);
    await waitFor(() => h.repo.find(OPTIMIZER)?.status === "promoted");

    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]!.text).toContain(`promotion_benchmark_id: \`${PROMOTION}\``);
    expect(h.prompts[0]!.text).not.toContain(DEVELOPMENT);
    expect(h.repo.find(OPTIMIZER)).toMatchObject({
      status: "promoted",
      promotionSessionId: h.promotionSessionId(),
      provider: "custom",
      modelId: "frozen-model",
      thinkingLevel: "medium",
    });
    expect(await h.snapshots.currentVersion(PROJECT, AGENT)).toBe(2);
    const promotion = (
      await new BenchmarkService(h.root, new WorkspaceFilesService()).list(PROJECT, AGENT)
    ).benchmarks.find((item) => item.id === PROMOTION)!;
    expect(promotion.evaluations.at(-1)?.promotionDecision).toBe("promoted");

    await h.orchestrator.onTaskSettled({
      projectId: PROJECT,
      agentId: "default_agent",
      sessionId: h.promotionSessionId(),
    });
    expect(h.prompts).toHaveLength(1);
    expect(h.errors).toEqual([]);
  });

  it("rejects a same-name Candidate snapshot whose archived version cannot be verified", async () => {
    const h = await createHarness(85);
    openHarnesses.push(h);
    const dir = snapshotsDir(h.root, PROJECT, AGENT);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "v2.tar.gz"), "not a snapshot");

    await h.orchestrator.onTaskSettled({
      projectId: PROJECT,
      agentId: "default_agent",
      sessionId: OPTIMIZER,
    });
    await waitFor(() => h.errors.length > 0);

    expect(h.repo.find(OPTIMIZER)).toBeNull();
    expect(h.prompts).toEqual([]);
    expect(h.errors[0]?.code).toBe("promotion_request_invalid");
  });

  it("restores the production snapshot when the valid held-out score regresses", async () => {
    const h = await createHarness(70);
    openHarnesses.push(h);

    await h.orchestrator.onTaskSettled({
      projectId: PROJECT,
      agentId: "default_agent",
      sessionId: OPTIMIZER,
    });
    await waitFor(() => h.repo.find(OPTIMIZER) !== null || h.errors.length > 0);
    expect(h.errors).toEqual([]);
    await waitFor(() => h.repo.find(OPTIMIZER)?.status === "restored");

    expect(await h.snapshots.currentVersion(PROJECT, AGENT)).toBe(1);
    expect(
      await fs.readFile(path.join(agentStateDir(h.root, PROJECT, AGENT), "AGENTS.md"), "utf8"),
    ).toBeTypeOf("string");
    const promotion = (
      await new BenchmarkService(h.root, new WorkspaceFilesService()).list(PROJECT, AGENT)
    ).benchmarks.find((item) => item.id === PROMOTION)!;
    expect(promotion.evaluations.at(-1)?.promotionDecision).toBe("restored");
    expect(h.errors).toEqual([]);
  });

  it("finishes an interrupted restore idempotently when State is already production", async () => {
    let harness!: Harness;
    harness = await createHarness(70, async () => {
      await harness.snapshots.restoreVersion(PROJECT, AGENT, 1);
    });
    openHarnesses.push(harness);

    await harness.orchestrator.onTaskSettled({
      projectId: PROJECT,
      agentId: "default_agent",
      sessionId: OPTIMIZER,
    });
    await waitFor(() => harness.repo.find(OPTIMIZER)?.status === "restored");

    expect(await harness.snapshots.currentVersion(PROJECT, AGENT)).toBe(1);
    expect(harness.repo.find(OPTIMIZER)?.errorCode).toBeUndefined();
    expect(harness.errors).toEqual([]);
  });

  it("never overwrites an Agent State changed concurrently during the gate", async () => {
    const h = await createHarness(70, async (root) => {
      const file = systemConfigPath(root, PROJECT, AGENT);
      const config = parseYaml(await fs.readFile(file, "utf8")) as Record<string, unknown>;
      config.version = 4;
      await fs.writeFile(file, stringifyYaml(config));
    });
    openHarnesses.push(h);

    await h.orchestrator.onTaskSettled({
      projectId: PROJECT,
      agentId: "default_agent",
      sessionId: OPTIMIZER,
    });
    await waitFor(() => h.repo.find(OPTIMIZER)?.status === "failed");

    expect(h.repo.find(OPTIMIZER)?.errorCode).toBe("promotion_candidate_changed");
    expect(await h.snapshots.currentVersion(PROJECT, AGENT)).toBe(4);
  });
});
