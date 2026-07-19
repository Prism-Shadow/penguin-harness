/**
 * Benchmark scoring routes:
 *   GET /api/projects/:p/agents/:a/benchmarks (any member, read-only)
 * Returns the Agent's Benchmark list (title/description from benchmark_config.toml)
 * along with the evaluations[] from scoreboard.yaml.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { requireValidId } from "../validate.js";

export function benchmarksRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return c.json(await deps.benchmarks.list(projectId, agentId));
  });

  return app;
}
