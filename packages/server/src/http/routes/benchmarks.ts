/**
 * Benchmark scoring routes:
 *   GET /api/projects/:p/agents/:a/benchmarks (any member, read-only)
 *   GET /api/projects/:p/agents/:a/benchmarks/promotion-runs
 *   GET /api/projects/:p/agents/:a/benchmarks/:benchmarkId/cases
 *   GET /api/projects/:p/agents/:a/benchmarks/:benchmarkId/cases/:caseId/files
 *   GET /api/projects/:p/agents/:a/benchmarks/:benchmarkId/cases/:caseId/files/content
 *   GET /api/projects/:p/agents/:a/benchmarks/:benchmarkId/cases/:caseId/rubric/files
 *   GET /api/projects/:p/agents/:a/benchmarks/:benchmarkId/cases/:caseId/rubric/files/content
 * Returns the Agent's Benchmark list (title/description from benchmark_config.toml)
 * along with the evaluations[] from scoreboard.yaml.
 */
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import type { CaseMaterial, PromotionRunInfo, PromotionRunsResponse } from "../../api/types.js";
import { requireValidId } from "../validate.js";

const TEXT_PREVIEW_BYTES = 256 * 1024;

function listCaseFiles(deps: AppDeps, material: CaseMaterial) {
  return async (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    const caseId = requireValidId(c, "caseId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return c.json(
      await deps.benchmarks.listCaseFiles(
        projectId,
        agentId,
        benchmarkId,
        caseId,
        c.req.query("path") ?? "",
        material,
      ),
    );
  };
}

function readCaseFile(deps: AppDeps, material: CaseMaterial) {
  return async (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    const caseId = requireValidId(c, "caseId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const download = c.req.query("download") === "1";
    const boundedPreview = !download && c.req.query("preview") === "1";
    const { data, fileName, contentType, scriptable, truncated } =
      await deps.benchmarks.readCaseFile(
        projectId,
        agentId,
        benchmarkId,
        caseId,
        c.req.query("path") ?? "",
        material,
        boundedPreview ? { maxBytes: TEXT_PREVIEW_BYTES } : undefined,
      );
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": !download && scriptable ? "text/plain; charset=utf-8" : contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
        ...(truncated ? { "X-Content-Truncated": "1" } : {}),
      },
    });
  };
}

export function benchmarksRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return c.json(await deps.benchmarks.list(projectId, agentId));
  });

  app.get("/promotion-runs", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const runs: PromotionRunInfo[] = deps.promotionsRepo
      .listByAgent(projectId, agentId)
      .map((row) => ({
        optimizationSessionId: row.optimizationSessionId,
        testAgentId: row.testAgentId,
        developmentBenchmarkId: row.developmentBenchmarkId,
        promotionBenchmarkId: row.promotionBenchmarkId,
        productionReferenceVersion: row.productionReferenceVersion,
        candidateVersion: row.candidateVersion,
        status: row.status,
        ...(row.promotionSessionId ? { promotionSessionId: row.promotionSessionId } : {}),
        ...(row.errorCode ? { errorCode: row.errorCode } : {}),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    return c.json({ runs } satisfies PromotionRunsResponse);
  });

  app.get("/:benchmarkId/cases", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return c.json(await deps.benchmarks.listCases(projectId, agentId, benchmarkId));
  });

  app.get("/:benchmarkId/cases/:caseId/files", listCaseFiles(deps, "statement"));
  app.get("/:benchmarkId/cases/:caseId/files/content", readCaseFile(deps, "statement"));
  app.get("/:benchmarkId/cases/:caseId/rubric/files", listCaseFiles(deps, "rubric"));
  app.get("/:benchmarkId/cases/:caseId/rubric/files/content", readCaseFile(deps, "rubric"));

  return app;
}
