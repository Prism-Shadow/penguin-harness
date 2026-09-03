/**
 * Benchmark scoring routes:
 *   GET /api/projects/:p/agents/:a/benchmarks (any member, read-only)
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
import type { AgentConfigService } from "../../services/agent-config-service.js";
import type { BenchmarkService } from "../../services/benchmark-service.js";
import type { ProjectAccess } from "../../services/project-access.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface BenchmarksRouteDeps {
  agentConfigService: AgentConfigService;
  benchmarks: BenchmarkService;
  access: ProjectAccess;
}
import type { CaseMaterial } from "../../api/types.js";
import { requireValidId } from "../validate.js";

const TEXT_PREVIEW_BYTES = 256 * 1024;

function listCaseFiles(deps: BenchmarksRouteDeps, material: CaseMaterial) {
  return async (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    const caseId = requireValidId(c, "caseId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
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

function readCaseFile(deps: BenchmarksRouteDeps, material: CaseMaterial) {
  return async (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    const caseId = requireValidId(c, "caseId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
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
    // Case material is browsed the same way a Workspace is, and gets the same inline
    // hardening (see the session file-content route for the reasoning behind each branch).
    const inertSvg = !download && scriptable === "svg";
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type":
          !download && scriptable === "html" ? "text/plain; charset=utf-8" : contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
        ...(inertSvg ? { "Content-Security-Policy": "sandbox" } : {}),
        ...(truncated ? { "X-Content-Truncated": "1" } : {}),
      },
    });
  };
}

export function benchmarksRoutes(deps: BenchmarksRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return c.json(await deps.benchmarks.list(projectId, agentId));
  });

  app.get("/:benchmarkId/cases", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return c.json(await deps.benchmarks.listCases(projectId, agentId, benchmarkId));
  });

  app.get("/:benchmarkId/cases/:caseId/files", listCaseFiles(deps, "statement"));
  app.get("/:benchmarkId/cases/:caseId/files/content", readCaseFile(deps, "statement"));
  app.get("/:benchmarkId/cases/:caseId/rubric/files", listCaseFiles(deps, "rubric"));
  app.get("/:benchmarkId/cases/:caseId/rubric/files/content", readCaseFile(deps, "rubric"));

  return app;
}
