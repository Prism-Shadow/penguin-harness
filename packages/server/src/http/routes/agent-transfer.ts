/**
 * Agent State export/import routes:
 *   GET  /api/projects/:p/agents/:a/export (any member; auto-packages if no snapshot exists, downloads tar.gz)
 *   POST /api/projects/:p/agents/:a/import (owner only; version conflicts require a confirm flag)
 */
import fs from "node:fs/promises";
import { Hono } from "hono";
import type { AgentImportResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";

/** Import archive size cap: aligned with the global request body limit (stays within 20MB after base64). */
const MAX_ARCHIVE_BYTES = 14 * 1024 * 1024;

export function agentTransferRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/export", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const { file, fileName } = await deps.snapshots.exportArchive(projectId, agentId);
    const bytes = await fs.readFile(file);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  });

  app.post("/import", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const body = await readJson(c);
    const dataBase64 = requireString(body, "dataBase64", { minLen: 1, maxLen: 20 * 1024 * 1024 });
    const confirm = body.confirm === true;
    let archive: Buffer;
    try {
      archive = Buffer.from(dataBase64, "base64");
    } catch {
      throw badRequest("dataBase64 is not valid base64.");
    }
    if (archive.byteLength === 0) throw badRequest("Import package is empty.");
    if (archive.byteLength > MAX_ARCHIVE_BYTES)
      throw badRequest("Import package exceeds the 14MB limit.");
    const { version } = await deps.snapshots.importArchive(projectId, agentId, archive, confirm);
    const res: AgentImportResponse = { version };
    return c.json(res);
  });

  return app;
}
