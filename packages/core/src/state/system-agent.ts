/**
 * The system Agent (`system_agent`, shown as "System"): the owner of the system apps
 * (PRFC-0033). Every Project is provisioned with one beside `default_agent`, from the preset in
 * builtin-agents.ts, which writes `system: true` into its `system_config.yaml`. It runs no
 * Session, installs no plugin, and is never deleted, renamed, exported or overwritten by an
 * import; the server enforces each of those, and every check asks this module rather than
 * comparing ids.
 *
 * The system Agent is the Agent whose id is `system_agent` AND whose config carries the key.
 * The id alone is not enough: Agent ids are user-chosen, so a Project may hold an Agent the
 * user named `system_agent` before the system Agent existed (compat C1, see
 * {@link isSystemAgentConfig}).
 */
import fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { SYSTEM_AGENT_ID } from "./builtin-agents.js";
import { DEFAULT_AGENT_ID, systemConfigPath } from "./paths.js";

/**
 * Whether `config` (a parsed `system_config.yaml`) makes the Agent `agentId` the system Agent.
 *
 * Compat C1, pending the product owner's choice (PRFC-0033, Compatibility): the key is
 * required, so an Agent the user named `system_agent` before the upgrade, which lacks it, stays
 * an ordinary Agent. It chats, deletes and exports as before, provisioning never overwrites it,
 * the Project has no system Agent while it holds the id, and the Agents page asks its owner to
 * move it to another id (option b). Adopting it instead (option a) is this check without the
 * key. The case is kept until 1.0, when this module's owner removes the notice that goes with it.
 */
export function isSystemAgentConfig(agentId: string, config: unknown): boolean {
  if (agentId !== SYSTEM_AGENT_ID) return false;
  return (
    config !== null &&
    typeof config === "object" &&
    (config as Record<string, unknown>).system === true
  );
}

/**
 * Whether the Agent is the Project's system Agent, read from its `system_config.yaml`. False for
 * any other id (nothing is read), and for a missing or unreadable config: what cannot be read
 * is not locked.
 */
export async function isSystemAgent(
  root: string,
  projectId: string,
  agentId: string,
): Promise<boolean> {
  if (agentId !== SYSTEM_AGENT_ID) return false;
  try {
    const raw = await fs.readFile(systemConfigPath(root, projectId, agentId), "utf8");
    return isSystemAgentConfig(agentId, parseYaml(raw) as unknown);
  } catch {
    return false;
  }
}

/**
 * Whether the Agent is one of the Project's built-in Agents, which are never deleted:
 * `default_agent` and `system_agent` while it is the system Agent.
 */
export async function isBuiltinAgent(
  root: string,
  projectId: string,
  agentId: string,
): Promise<boolean> {
  if (agentId === SYSTEM_AGENT_ID) return isSystemAgent(root, projectId, agentId);
  return agentId === DEFAULT_AGENT_ID;
}
