/**
 * Vault environment variable routes:
 * GET|PUT /api/projects/:p/agents/:a/vault (Agent-level, agent_state/.vault.toml).
 * POST …/vault/template-placeholder inserts/migrates the {{VAULT}} placeholder in the
 * prompt template.
 * Any member can read (values masked); only the owner can modify; 404 if the Agent doesn't exist.
 */
import { Hono } from "hono";
import type { VaultEntryUpdate, VaultUpdateRequest } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";
import type { SessionManager } from "../../runtime/session-manager.js";
import type { AgentConfigService } from "../../services/agent-config-service.js";
import type { ProjectAccess } from "../../services/project-access.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface VaultRouteDeps {
  agentConfigService: AgentConfigService;
  manager: SessionManager;
  access: ProjectAccess;
}

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

export function vaultRoutes(deps: VaultRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Defensive id validation happens before any path construction: prevents agentId path traversal for cross-Project privilege escalation.
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.agentConfigService.getVault(projectId, agentId));
  });

  app.put("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const req = parseVaultUpdate(await readJson(c));
    const res = await deps.agentConfigService.updateVault(projectId, agentId, req);
    // No runtime invalidation: like every Agent State change, the new values reach a
    // running Session at its next compaction (core reads the vault into each model
    // context), and a new Session immediately — the same timing the CLI has.
    return c.json(res);
  });

  // Insert (or migrate a legacy hardcoded # Vault section to) the {{VAULT}} placeholder —
  // the explicit adoption path mirroring memory's endpoint; idempotent config write,
  // owner-level like this router's other mutation.
  app.post("/template-placeholder", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const view = await deps.agentConfigService.insertTemplatePlaceholder(
      projectId,
      agentId,
      "vault",
    );
    return c.json(view.config.vault);
  });

  return app;
}
