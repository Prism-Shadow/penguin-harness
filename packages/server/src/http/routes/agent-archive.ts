/**
 * Agent export and import, the zip being the Agent's directory:
 *   GET  /api/projects/:p/agents/:a/archive?<parts>&traces=…  (any member; services/agent-export.ts)
 *   POST /api/projects/:p/agents/import?agentId=&overwrite=1  (the raw zip, or a `.tar.gz` snapshot
 *        package exported before; services/agent-zip.ts)
 * An import under a free id creates the Agent, which any member may; a taken id is 409
 * `agent_exists` unless `overwrite=1`, which is the owner's and takes a backup first. Either way
 * the State is swapped in by the snapshot import, then the package's Sessions land, those this
 * install already has skipped.
 */
import { Hono } from "hono";
import { agentDir, isValidId } from "@prismshadow/penguin-core";
import type { AgentArchiveImportResponse, AgentArchiveQuery } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { formatLocalDate } from "../../internal/dates.js";
import type { AgentConfig, AgentLifecycle, Snapshots } from "../../mechanisms/agents.js";
import type { Access } from "../../mechanisms/projects.js";
import type { Traces } from "../../mechanisms/traces.js";
import type { Workbenches } from "../../mechanisms/workbenches.js";
import { exportAgent } from "../../services/agent-export.js";
import type { AgentExportDeps } from "../../services/agent-export.js";
import { isZip, readPackageTraces, zipTopDirectory } from "../../services/agent-zip.js";
import { migrateWorkbenches } from "../../workbenches/migrate.js";
import { ensureWorkbenchLinkTarget } from "../../workbenches/migrate-state.js";
import { HttpError } from "../errors.js";
import { badRequest, requireValidId } from "../validate.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface AgentArchiveRouteDeps extends AgentExportDeps {
  access: Access;
  agentConfig: AgentConfig;
  agents: Pick<AgentLifecycle, "createAgent" | "takenAgentIds">;
  snapshots: Snapshots;
  traces: Pick<Traces, "importSessions">;
  workbenches: Pick<Workbenches, "whileReleased">;
  now: () => Date;
}

export function agentArchiveRoutes(deps: AgentArchiveRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/:agentId/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfig.requireExists(projectId, agentId);
    // Workbenches still in an older layout move into agent_state/ first, so the package has them.
    await migrateWorkbenches(agentDir(deps.root, projectId, agentId));
    const zip = await exportAgent(deps, projectId, agentId, c.req.query() as AgentArchiveQuery);
    const day = formatLocalDate(deps.now()).replaceAll("-", "");
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${agentId}-${day}.zip"`,
      },
    });
  });

  app.post("/import", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const userId = c.var.user.userId;
    deps.access.requireProjectAccess(userId, projectId);
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) throw badRequest("The import package is empty.");
    const agentId = c.req.query("agentId") || (isZip(bytes) ? zipTopDirectory(bytes) : undefined);
    if (agentId === undefined) {
      throw badRequest("agentId is required: the package does not name its Agent.");
    }
    if (!isValidId(agentId)) {
      throw new HttpError(400, "invalid_agent_id", `Not an Agent id: ${JSON.stringify(agentId)}.`);
    }
    const sessions: AgentArchiveImportResponse["sessions"] = { imported: 0, skipped: [] };
    const pkg = {
      bytes,
      landTraces: async (dir: string) => {
        const landed = await deps.traces.importSessions(
          projectId,
          agentId,
          await readPackageTraces(dir),
        );
        Object.assign(sessions, landed);
      },
    };
    let res: Omit<AgentArchiveImportResponse, "agent" | "sessions">;
    if (!(await deps.agents.takenAgentIds(projectId)).includes(agentId)) {
      const created = await deps.agents.createAgent(projectId, agentId, { archive: pkg });
      res = { mode: "created", version: created.version };
    } else {
      if (c.req.query("overwrite") !== "1") {
        const taken = `Agent id is already taken: ${agentId}.`;
        throw new HttpError(409, "agent_exists", taken, undefined, { agentId });
      }
      deps.access.requireProjectOwner(userId, projectId);
      await deps.agentConfig.requireExists(projectId, agentId);
      const dir = agentDir(deps.root, projectId, agentId);
      // The workbenches live inside agent_state/. Ones still in an older layout move in first, so
      // the backup taken before the swap holds them and the package's cannot take their ids; then
      // what the server holds open there lets go until the swap is over (Windows cannot rename a
      // watched directory).
      await migrateWorkbenches(dir);
      const imported = await deps.workbenches.whileReleased(projectId, agentId, async () => {
        const done = await deps.snapshots.importArchive(projectId, agentId, pkg, {
          preSnapshot: true,
        });
        // A State without workbenches would leave the old place's link leading nowhere.
        await ensureWorkbenchLinkTarget(dir);
        return done;
      });
      res = { mode: "overwritten", ...imported };
    }
    const meta = await deps.agentConfig.readCardMeta(projectId, agentId);
    const agent = {
      agentId,
      name: meta.name ?? agentId,
      ...(meta.description !== undefined ? { description: meta.description } : {}),
    };
    return c.json({ agent, ...res, sessions } satisfies AgentArchiveImportResponse, 201);
  });

  return app;
}
