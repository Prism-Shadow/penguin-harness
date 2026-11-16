/**
 * Memory routes (`agent_state/memory/`), Project-member operations except where noted:
 *   GET    /api/projects/:p/agents/:a/memory                        # switch + scope groups (user scope first)
 *   POST   /api/projects/:p/agents/:a/memory/template-placeholder    # insert the {{MEMORY}} placeholder into the template
 *   GET    /api/projects/:p/agents/:a/memory/scopes/:key/files      # one scope's topic files, the files each keeps, and those no topic keeps
 *   GET    …/memory/scopes/:key/files/:path                         # one file: a topic with the files it keeps, or a kept file's text (up to 512 KB, UTF-8)
 *   DELETE …/memory/scopes/:key/files/:path                         # a topic with its folder (+ prune its index lines), or one kept file
 *   GET    …/memory/scopes/:key/export                              # the scope folder as a zip
 *   POST   …/memory/scopes/:key/import                              # write such a zip back, or a version 1 JSON document (owner only)
 *
 * Per-file content edits go through a chat Session where the model maintains the files and their
 * `MEMORY.md` index together. The `memory.enabled` switch is Agent configuration and lives on
 * PUT …/agents/:a/config.
 *
 * Import is the one route here that is not a Project-member operation. It follows the Agent
 * import's split, for the same reason: reading a scope is reading Agent State, which every
 * member may do, while writing a whole scope at once can cost the Agent memories no member
 * agreed to lose (agent-archive.ts, where overwriting an Agent is the owner's).
 *
 * No route accepts an absolute path: a file is addressed by `agentId` + `scopeKey` + its path
 * inside that scope, one URL segment per path segment — a topic's name, or `<folder>/<path>` for a
 * file a topic keeps — and MemoryService re-checks that the resolved path stayed inside the
 * Agent's Memory directory.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../../auth/middleware.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface MemoryRouteDeps {
  memoryService: Memory;
  access: Access;
}
import type { MemoryImportMode } from "../../api/types.js";
import {
  badRequest,
  optionalBoolean,
  optionalEnum,
  pathParam,
  readJson,
  requireValidId,
} from "../validate.js";
import type { Memory } from "../../mechanisms/agents.js";
import type { Access } from "../../mechanisms/projects.js";

const IMPORT_MODES: readonly MemoryImportMode[] = ["skip", "overwrite", "replace"];

/** The export attachment's `YYYYMMDD-HHmm` stamp (local clock). */
function exportStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function memoryRoutes(deps: MemoryRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Shared preamble: id validation before any path construction, then the Project membership check. */
  const scope = (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
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

  // The path's segments, decoded and joined by `/`: a topic's name, or a file in a folder.
  app.get("/scopes/:scopeKey/files/:filePath{.+}", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "scopeKey");
    const filePath = pathParam(c, "filePath");
    return c.json(await deps.memoryService.readFile(projectId, agentId, key, filePath));
  });

  app.get("/scopes/:scopeKey/export", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "scopeKey");
    const zip = await deps.memoryService.exportScope(projectId, agentId, key);
    // Named for the Agent, the scope and the moment (`YYYYMMDD-HHmm`, this process's local
    // clock), so repeated exports of one scope stay apart in a downloads folder. The Agent id is
    // validated and the scope key has just passed the service's key rule; the name is encoded
    // either way, as every archive download here is.
    const name = `${agentId}-${key}-memory-${exportStamp(new Date())}.zip`;
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  // Owner only: one request can replace or delete every memory in the scope.
  app.post("/scopes/:scopeKey/import", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const key = pathParam(c, "scopeKey");
    const body = await readJson(c);
    // A zip of the scope folder, base64 (as the Skill and workbench archives travel), or a
    // version 1 JSON document from before the zip.
    const dataBase64 = body.dataBase64;
    if (dataBase64 !== undefined && typeof dataBase64 !== "string") {
      throw badRequest("dataBase64 must be a string.");
    }
    if ((dataBase64 === undefined) === (body.payload === undefined)) {
      throw badRequest("Send either dataBase64 (a zip) or payload (a version 1 document).");
    }
    return c.json(
      await deps.memoryService.importScope(projectId, agentId, key, {
        mode: optionalEnum(body, "mode", IMPORT_MODES) ?? "skip",
        confirm: optionalBoolean(body, "confirm") ?? false,
        ...(dataBase64 !== undefined ? { dataBase64 } : { payload: body.payload }),
      }),
    );
  });

  app.delete("/scopes/:scopeKey/files/:filePath{.+}", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "scopeKey");
    const filePath = pathParam(c, "filePath");
    await deps.memoryService.deleteFile(projectId, agentId, key, filePath);
    return c.body(null, 204);
  });

  return app;
}
