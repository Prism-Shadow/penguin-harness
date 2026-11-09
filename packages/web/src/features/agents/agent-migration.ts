/**
 * The import dialog's migration path: the coding-agent frameworks an Agent can be moved in from,
 * the prompt the new conversation starts with, and the Skill that prompt needs. The mapping
 * itself is the `agent-porting` Skill's, so a framework that changes its layout needs a Skill
 * edit, not a release of this page.
 */
import { getAgentPlugins, getPluginLibrary, installAgentPlugins } from "../../api/endpoints";
import { S } from "../../lib/strings";

/** The frameworks the dialog offers, in its order, each with the user directory it keeps its setup in. */
export const MIGRATION_SOURCES = [
  { id: "claude-code", name: "Claude Code", home: "~/.claude" },
  { id: "codex", name: "Codex", home: "~/.codex" },
  { id: "deepseek-harness", name: "DeepSeek Harness", home: "~/.dsh" },
  { id: "qoder", name: "Qoder", home: "~/.qoder" },
  { id: "qwen-code", name: "Qwen Code", home: "~/.qwen" },
  { id: "workbuddy", name: "WorkBuddy", home: "~/.workbuddy-ai" },
] as const;
/** A listed framework's id, or `other`: a source with no directory to fall back on. */
export type MigrationSource = (typeof MIGRATION_SOURCES)[number]["id"] | "other";

export const sourceOf = (id: MigrationSource) => MIGRATION_SOURCES.find((s) => s.id === id);

/** The prompt for `id` with `typed` in the path field; null for `other` with nothing typed. */
export function migrationPrompt(id: MigrationSource, typed: string, projectId: string) {
  const source = sourceOf(id);
  const read = typed.trim() || source?.home;
  return read ? S.agent.migratePrompt(source?.name ?? null, read, projectId) : null;
}

/** The library plugin that ships the Skill the prompt names. */
export const PORTING_PLUGIN = "skill-porting";

/**
 * What giving this server's `agentId` the `agent-porting` Skill takes: nothing, an install, or an
 * update — an Agent set up before the Skill shipped has the plugin's other Skills, and installing
 * the plugin again overwrites those copies, local edits included.
 */
export async function portingNeed(
  projectId: string,
  agentId: string,
): Promise<"ready" | "install" | "update"> {
  const [{ skills }, library] = await Promise.all([
    getAgentPlugins(projectId, agentId, null),
    getPluginLibrary(null),
  ]);
  const has = new Set(skills.map((skill) => skill.name));
  if (has.has("agent-porting")) return "ready";
  const plugin = library.groups.flatMap((g) => g.plugins).find((p) => p.name === PORTING_PLUGIN);
  return plugin?.skills.some((skill) => has.has(skill.name)) ? "update" : "install";
}

export const installPorting = (projectId: string, agentId: string) =>
  installAgentPlugins(projectId, agentId, [PORTING_PLUGIN], null);
