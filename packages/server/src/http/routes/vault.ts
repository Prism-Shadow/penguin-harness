/**
 * Vault environment variable routes:
 * GET|PUT /api/projects/:p/agents/:a/vault (Agent-level, agent_state/.vault.toml).
 * Any member can read (values masked); only the owner can modify; 404 if the Agent doesn't exist.
 */
import { Hono } from "hono";
import type { VaultEntryUpdate, VaultUpdateRequest } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

/** Validate the PUT request body and shape it into a VaultUpdateRequest (semantic checks like key-name rules live in the service layer). */
function parseVaultUpdate(body: Record<string, unknown>): VaultUpdateRequest {
  if (!Array.isArray(body.entries)) throw badRequest("entries must be an array.");
  const entries: VaultEntryUpdate[] = body.entries.map((item, i) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`entries[${i}] must be an object.`);
    }
    const e = item as Record<string, unknown>;
    const entry: VaultEntryUpdate = {
      key: requireString(e, "key", { minLen: 1, maxLen: 200, label: `entries[${i}].key` }),
    };
    if (e.value !== undefined) {
      if (typeof e.value !== "string" || e.value.length === 0) {
        throw badRequest(`entries[${i}].value must be a non-empty string.`);
      }
      entry.value = e.value;
    }
    return entry;
  });
  return { entries };
}

export function vaultRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Defensive id validation happens before any path construction (FD-4: prevents agentId path traversal for cross-Project privilege escalation).
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.agentConfigService.getVault(projectId, agentId));
  });

  app.put("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const req = parseVaultUpdate(await readJson(c));
    const res = await deps.agentConfigService.updateVault(projectId, agentId, req);
    // Effective-value semantics: no hot update — an already-built runtime is neither
    // evicted nor reloaded; the new value only applies to Sessions created or resumed
    // afterward.
    return c.json(res);
  });

  return app;
}
