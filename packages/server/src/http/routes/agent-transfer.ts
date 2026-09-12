/**
 * Agent State export/import routes:
 *   GET  /api/projects/:p/agents/:a/export (any member; auto-packages if no snapshot exists, downloads tar.gz)
 *   POST /api/projects/:p/agents/:a/import (owner only; version conflicts require a confirm flag)
 */
import fs from "node:fs/promises";
import { Hono } from "hono";
import type { AgentImportResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface AgentTransferRouteDeps {
  agentConfigService: AgentConfig;
  access: Access;
  snapshots: Snapshots;
}
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";
import type { AgentConfig, Snapshots } from "../../mechanisms/agents.js";
import type { Access } from "../../mechanisms/projects.js";

/** Import archive size cap: aligned with the global request body limit (stays within 20MB after base64). */
const MAX_ARCHIVE_BYTES = 14 * 1024 * 1024;

/**
 * Decodes a request body's `dataBase64` snapshot package into a Buffer, enforcing the
 * archive cap. Shared by the import route and agent creation's snapshot seed.
 */
export function readArchiveBase64(body: Record<string, unknown>): Buffer {
  const dataBase64 = requireString(body, "dataBase64", { minLen: 1, maxLen: 20 * 1024 * 1024 });
  let archive: Buffer;
  try {
    archive = Buffer.from(dataBase64, "base64");
  } catch {
    throw badRequest("dataBase64 is not valid base64.");
  }
  if (archive.byteLength === 0) throw badRequest("Import package is empty.");
  if (archive.byteLength > MAX_ARCHIVE_BYTES)
    throw badRequest("Import package exceeds the 14MB limit.");
  return archive;
}

export function agentTransferRoutes(deps: AgentTransferRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/export", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
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
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const body = await readJson(c);
    const archive = readArchiveBase64(body);
    const confirm = body.confirm === true;
    const { version } = await deps.snapshots.importArchive(projectId, agentId, archive, {
      confirm,
    });
    const res: AgentImportResponse = { version };
    return c.json(res);
  });

  return app;
}
