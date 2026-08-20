/**
 * Memory routes (`agent_state/memory/`), Project-member operations except where noted:
 *   GET    /api/projects/:p/agents/:a/memory                        # switch + scope groups (user scope first)
 *   POST   /api/projects/:p/agents/:a/memory/template-placeholder    # insert the {{MEMORY}} placeholder into the template
 *   GET    /api/projects/:p/agents/:a/memory/scopes/:key/files      # one scope's topic files
 *   GET    …/memory/scopes/:key/files/:name                         # one topic file's content
 *   DELETE …/memory/scopes/:key/files/:name                         # delete + prune its index lines
 *   GET    …/memory/scopes/:key/export                              # the whole scope as one JSON document
 *   POST   …/memory/scopes/:key/import                              # write such a document back (owner only)
 *
 * Per-file content edits go through a chat Session where the model maintains the files and their
 * `MEMORY.md` index together. The `memory.enabled` switch is Agent configuration and lives on
 * PUT …/agents/:a/config.
 *
 * Import is the one route here that is not a Project-member operation. It follows the Agent State
 * snapshot's split, for the same reason: reading a scope is reading Agent State, which every
 * member may do, while writing a whole scope at once can cost the Agent memories no member
 * agreed to lose (agent-transfer.ts).
 *
 * No route accepts an absolute path: a file is addressed by `agentId` + `scopeKey` + a name
 * inside that scope, and MemoryService re-checks that the resolved path stayed inside the
 * Agent's Memory directory.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import type { MemoryImportMode } from "../../api/types.js";
import { optionalBoolean, optionalEnum, pathParam, readJson, requireValidId } from "../validate.js";

const IMPORT_MODES: readonly MemoryImportMode[] = ["skip", "overwrite", "replace"];

export function memoryRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Shared preamble: id validation before any path construction, then the Project membership check. */
  const scope = (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    return { projectId, agentId };
  };

  app.get("/", async (c) => {
    const { projectId, agentId } = scope(c);
    return c.json(await deps.memoryService.overview(projectId, agentId));
  });

  // The explicit adoption path for a template that predates Memory (idempotent config write).
  app.post("/template-placeholder", async (c) => {
    const { projectId, agentId } = scope(c);
    return c.json(await deps.memoryService.insertTemplatePlaceholder(projectId, agentId));
  });

  app.get("/scopes/:scopeKey/files", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "scopeKey");
    return c.json(await deps.memoryService.listFiles(projectId, agentId, key));
  });

  app.get("/scopes/:scopeKey/files/:fileName", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "scopeKey");
    const name = pathParam(c, "fileName");
    return c.json(await deps.memoryService.readFile(projectId, agentId, key, name));
  });

  app.get("/scopes/:scopeKey/export", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "scopeKey");
    const doc = await deps.memoryService.exportScope(projectId, agentId, key);
    // Named for the Agent and the scope it came from, so several downloads stay apart in a
    // downloads folder. The Agent id is validated and the scope key has just passed the
    // service's key rule, so neither can carry a quote or a newline into the header.
    return new Response(JSON.stringify(doc, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${agentId}-${key}-memory.json"`,
      },
    });
  });

  // Owner only: one request can replace or delete every memory in the scope.
  app.post("/scopes/:scopeKey/import", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const key = pathParam(c, "scopeKey");
    const body = await readJson(c);
    return c.json(
      await deps.memoryService.importScope(projectId, agentId, key, {
        mode: optionalEnum(body, "mode", IMPORT_MODES) ?? "skip",
        confirm: optionalBoolean(body, "confirm") ?? false,
        payload: body.payload,
      }),
    );
  });

  app.delete("/scopes/:scopeKey/files/:fileName", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "scopeKey");
    const name = pathParam(c, "fileName");
    await deps.memoryService.deleteFile(projectId, agentId, key, name);
    return c.body(null, 204);
  });

  return app;
}
