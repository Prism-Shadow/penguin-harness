/**
 * Loading and initialization of Agent State (semantics modeled on Hugging Face model loading).
 *
 * - Initializes when the target Agent directory is empty (no `system_config.yaml`): creates
 *   `agent_state/`, `tools/`, `memory/`, `skills/`, and the sibling `scratchpad/`, and writes
 *   the default `system_config.yaml` and `AGENTS.md`.
 * - Otherwise loads the existing system config and editable Prompt for the given `agentId`.
 *
 * The full runtime Prompt is rendered from the system-level Prompt template in
 * `system_config.yaml`; placeholders in the template are replaced with `AGENTS.md` and the
 * concrete Session runtime environment fields. Built-in tools and MCP Server config
 * come from `system_config.yaml`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  loadLibrarySkills,
  parseSkillFrontmatter,
  type SkillMetadata,
} from "@prismshadow/penguin-skills";
import type { ToolConfig, ToolDefinitionConfig } from "../interfaces.js";
import {
  AGENT_ID_PLACEHOLDER,
  AGENTS_MD_PLACEHOLDER,
  VAULT_KEYS_PLACEHOLDER,
  SKILL_METADATA_PLACEHOLDER,
  CWD_PLACEHOLDER,
  DATE_PLACEHOLDER,
  defaultAgentsMd,
  defaultSystemConfig,
  OS_VERSION_PLACEHOLDER,
  PLATFORM_PLACEHOLDER,
  PROJECT_DIR_PLACEHOLDER,
  SESSION_ID_PLACEHOLDER,
  type SystemConfig,
} from "./default-config.js";
import { builtinProjectAgentPresets, type AgentPreset } from "./builtin-agents.js";
import { provisionExampleBenchmark } from "./example-benchmark.js";
import {
  agentsMdPath,
  agentStateDir,
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  memoryDir,
  resolveRoot,
  scratchpadDir,
  skillsDir,
  systemConfigPath,
  toolsDir,
} from "./paths.js";

/** project_id / agent_id / skill_name only allow letters, digits, underscore `_`, and hyphen `-` (prevents path traversal). */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
export type IdKind = "project_id" | "agent_id" | "skill_name";

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function assertValidId(kind: IdKind, id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid ${kind} ${JSON.stringify(id)}: only letters, digits, "_" and "-" are allowed.`,
    );
  }
}

/** A loaded Agent State handle. */
export interface AgentState {
  root: string;
  projectId: string;
  agentId: string;
  stateDir: string;
  systemConfig: SystemConfig;
  agentsMd: string;
}

export interface SessionEnvironmentValues {
  sessionId: string;
  cwd: string;
  /** The Agent id this Session belongs to (system Prompt placeholder {{AGENT_ID}}). */
  agentId: string;
  /** Absolute path to this Project's directory (system Prompt placeholder {{PROJECT_DIR}}; Agent State/scratchpad paths are derived from it). */
  projectDir: string;
  platform: string;
  osVersion: string;
  date: string;
}

/**
 * Loads or initializes Agent State.
 *
 * When root/project/agent are omitted, `resolveRoot()` and the default constants are used. If
 * `system_config.yaml` doesn't exist, the directory is treated as empty and initialized;
 * otherwise the existing content is loaded. `preset` only takes effect on the initialization
 * path (name/description/AGENTS.md overrides and extra Skills) and is ignored when loading an
 * existing Agent — existing config is never overwritten.
 */
export async function loadOrInitAgentState(opts?: {
  agentId?: string;
  projectId?: string;
  root?: string;
  preset?: AgentPreset;
}): Promise<AgentState> {
  const root = opts?.root ?? resolveRoot();
  const projectId = opts?.projectId ?? DEFAULT_PROJECT_ID;
  const agentId = opts?.agentId ?? DEFAULT_AGENT_ID;

  // Validate before building paths, to prevent path traversal.
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);

  const stateDir = agentStateDir(root, projectId, agentId);
  const configPath = systemConfigPath(root, projectId, agentId);
  const mdPath = agentsMdPath(root, projectId, agentId);

  let systemConfig: SystemConfig;
  let agentsMd: string;

  if (await fileExists(configPath)) {
    // Load path: read the existing system_config.yaml and AGENTS.md.
    const rawConfig = await fs.readFile(configPath, "utf8");
    const parsed = parseYaml(rawConfig) as unknown;
    // Defensive check: if the file is empty/corrupted, parseYaml may return null/a non-object,
    // or system_prompt may be missing — otherwise "undefined" would get spliced into the system
    // Prompt. Throw a clear error when validation fails.
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof (parsed as SystemConfig).system_prompt !== "string"
    ) {
      throw new Error(
        `Invalid Agent State config: ${configPath} is empty, corrupted, or missing the system_prompt field.`,
      );
    }
    systemConfig = parsed as SystemConfig;
    agentsMd = (await fileExists(mdPath)) ? await fs.readFile(mdPath, "utf8") : defaultAgentsMd();
  } else {
    // Init path: create the directory structure and write default config (preset only takes effect here).
    await Promise.all([
      fs.mkdir(stateDir, { recursive: true }),
      fs.mkdir(toolsDir(root, projectId, agentId), { recursive: true }),
      fs.mkdir(memoryDir(root, projectId, agentId), { recursive: true }),
      fs.mkdir(skillsDir(root, projectId, agentId), { recursive: true }),
      fs.mkdir(scratchpadDir(root, projectId, agentId), { recursive: true }),
    ]);
    const preset = opts?.preset;
    systemConfig = {
      ...defaultSystemConfig(),
      ...(preset?.name !== undefined ? { name: preset.name } : {}),
      ...(preset?.description !== undefined ? { description: preset.description } : {}),
    };
    agentsMd = preset?.agentsMd ?? defaultAgentsMd();
    // Only installs the Skills specified by preset (a plain newly created Agent gets none
    // pre-installed). A default_agent with no
    // preset (e.g. created on first CLI run) still gets every Skill in the library pre-installed
    // — the install policy follows Agent identity, not whether creation came from the server or
    // was done directly via SDK/CLI.
    // Skills have no dedicated tool: metadata is injected via {{SKILL_METADATA}}, and the model
    // reads SKILL.md with shell and follows it.
    const skills =
      opts?.preset === undefined && agentId === DEFAULT_AGENT_ID
        ? loadLibrarySkills()
        : (opts?.preset?.skills ?? []);
    await Promise.all([
      fs.writeFile(mdPath, agentsMd, "utf8"),
      ...skills.map((skill) => installSkill(root, projectId, agentId, skill)),
      // The example Benchmark is only provisioned alongside default_agent (so the evaluation
      // center has data out of the box): idempotently skipped if benchmarks/ already exists,
      // and not created for plain Agents.
      ...(agentId === DEFAULT_AGENT_ID
        ? [provisionExampleBenchmark(root, projectId, agentId)]
        : []),
    ]);
    // system_config.yaml is written last: its existence is the "initialization complete" marker
    // (the load/init decision point). If this fails partway (disk full / crash), the next run
    // still takes the init path and self-heals, so no half-initialized state with missing Skills is left behind.
    await fs.writeFile(configPath, stringifyYaml(systemConfig), "utf8");
  }

  return { root, projectId, agentId, stateDir, systemConfig, agentsMd };
}

/**
 * Initializes a Project's built-in Agent (the only built-in Agent: default_agent).
 *
 * Calls loadOrInitAgentState for each one: an Agent whose directory already exists (including a
 * default_agent created earlier by the CLI) is only loaded, never overwritten (preset only
 * takes effect on initialization). Returns the list of built-in Agent ids.
 */
export async function provisionProjectAgents(opts?: {
  root?: string;
  projectId?: string;
}): Promise<string[]> {
  const agentIds: string[] = [];
  for (const { agentId, preset } of builtinProjectAgentPresets()) {
    await loadOrInitAgentState({
      ...(opts?.root !== undefined ? { root: opts.root } : {}),
      ...(opts?.projectId !== undefined ? { projectId: opts.projectId } : {}),
      agentId,
      preset,
    });
    agentIds.push(agentId);
  }
  return agentIds;
}

/**
 * The vault key-name list: the replacement value for `{{VAULT_KEYS}}`, one `- KEY` per line;
 * returns an empty string when there are no keys.
 * **Contains only key names, never values** — values are only injected into the exec_command
 * subprocess environment, never the model context. The statement of the vault's purpose is part
 * of the default template body (the # Vault section) and is kept even with no vault.
 */
function vaultKeysList(keys: string[]): string {
  return keys.map((key) => `- ${key}`).join("\n");
}

/**
 * Installs a Skill into the target Agent: writes `skills/<name>/SKILL.md` verbatim (the full
 * SKILL.md content including frontmatter, ensuring a trailing newline); if the directory
 * already exists, it's overwritten (reinstalling = updating to the latest content). An optional
 * icon.svg is written alongside SKILL.md; if this install doesn't
 * include an icon, any old icon.svg is removed, preserving "overwrite update" semantics (the
 * directory content matches the Skill being installed).
 * Docs: /docs/skills § "Installation and storage".
 */
export async function installSkill(
  root: string,
  projectId: string,
  agentId: string,
  skill: { name: string; content: string; icon?: string },
): Promise<void> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  assertValidId("skill_name", skill.name);
  const dir = path.join(skillsDir(root, projectId, agentId), skill.name);
  await fs.mkdir(dir, { recursive: true });
  const content = skill.content.endsWith("\n") ? skill.content : `${skill.content}\n`;
  const iconPath = path.join(dir, "icon.svg");
  await Promise.all([
    fs.writeFile(path.join(dir, "SKILL.md"), content, "utf8"),
    skill.icon !== undefined
      ? fs.writeFile(iconPath, skill.icon, "utf8")
      : fs.rm(iconPath, { force: true }),
  ]);
}

/** Uninstalls a Skill: deletes the entire `skills/<name>/` directory; idempotent, no error if it doesn't exist. */
export async function removeSkill(
  root: string,
  projectId: string,
  agentId: string,
  name: string,
): Promise<void> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  assertValidId("skill_name", name);
  await fs.rm(path.join(skillsDir(root, projectId, agentId), name), {
    recursive: true,
    force: true,
  });
}

/** An installed Skill entry: frontmatter metadata (including an optional short description) + the optional icon.svg content in the directory. */
export interface InstalledSkill extends SkillMetadata {
  /** The raw content of `skills/<name>/icon.svg` (a custom icon copied alongside SKILL.md at install time); the field is omitted when missing (the frontend falls back to a default book icon). */
  icon?: string;
}

/**
 * Lists the metadata of Skills installed on the target Agent: scans `skills/<name>/SKILL.md` and
 * parses its frontmatter (optional fields like short_description(_zh) pass through as parsed),
 * also reading the optional icon.svg content in the directory. Tolerant: a directory whose
 * frontmatter fails to parse or is missing `name` falls back to
 * `{ name: <directory name>, description: "", version: 1, updated: "" }`; a directory with no
 * SKILL.md doesn't count as a Skill; returns [] if skills/ doesn't exist. Results are sorted by
 * name (a stable order for both Prompt injection and API responses).
 * Docs: /docs/skills § "Installation and storage".
 */
export async function listInstalledSkills(
  root: string,
  projectId: string,
  agentId: string,
): Promise<InstalledSkill[]> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  const dir = skillsDir(root, projectId, agentId);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: InstalledSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let raw: string;
    try {
      raw = await fs.readFile(path.join(dir, entry.name, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    let icon: string | undefined;
    try {
      icon = await fs.readFile(path.join(dir, entry.name, "icon.svg"), "utf8");
    } catch {
      // icon.svg is optional: missing means no custom icon.
    }
    // The directory name is the Skill's identity (install / uninstall / Prompt read guidance all
    // address by directory name): frontmatter only supplies display fields like description; when
    // its `name` doesn't match the directory name (a hand-written or network-sourced Skill), the
    // directory name always wins — otherwise the model would read a nonexistent path using the
    // injected name, and the API couldn't uninstall it either.
    const parsed = parseSkillFrontmatter(raw);
    skills.push({
      ...(parsed ?? { description: "", version: 1, updated: "" }),
      name: entry.name,
      ...(icon !== undefined ? { icon } : {}),
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Skill metadata section: the replacement value for `{{SKILL_METADATA}}`, one line per Skill in
 * the form `- \`name\` — description` (just the name when description is empty); an empty array
 * returns an empty string. The full body is read by the model on demand via shell.
 */
export function skillMetadataSection(skills: SkillMetadata[]): string {
  return skills
    .map((s) => (s.description ? `- \`${s.name}\` — ${s.description}` : `- \`${s.name}\``))
    .join("\n");
}

/**
 * Renders the complete runtime system Prompt: substitutes `AGENTS.md`, vault key names, Skill
 * metadata, and the concrete Session runtime environment placeholders into the system Prompt
 * template. The assembly layer only does placeholder substitution and adds no extra text —
 * wrapper text such as `<developer_instructions>` and the # Vault / # Skills statements are
 * written directly into the system Prompt template itself (the Prompt is fully
 * transparent and editable via `system_config.yaml`). Other files in Agent State / Workspace are
 * never auto-injected.
 *
 * `{{VAULT_KEYS}}` is replaced with the vault key-name list (an empty string if empty/not
 * provided): this lets the model know which APIs requiring a key it can call; values are never
 * injected. `{{SKILL_METADATA}}` is replaced with the installed Skills' metadata lines (an empty
 * string if empty/not provided). A custom template that removes a placeholder gets no
 * corresponding content injected.
 * Docs: /docs/configuration § "System prompt placeholders".
 */
export function assembleSystemPrompt(
  state: AgentState,
  sessionEnvironment?: SessionEnvironmentValues,
  vaultKeys?: string[],
  skillMetadata?: SkillMetadata[],
): string {
  return state.systemConfig.system_prompt
    .split(AGENTS_MD_PLACEHOLDER)
    .join(state.agentsMd.trim())
    .split(VAULT_KEYS_PLACEHOLDER)
    .join(vaultKeysList(vaultKeys ?? []))
    .split(SKILL_METADATA_PLACEHOLDER)
    .join(skillMetadataSection(skillMetadata ?? []))
    .split(AGENT_ID_PLACEHOLDER)
    .join(sessionEnvironment?.agentId ?? state.agentId)
    .split(PROJECT_DIR_PLACEHOLDER)
    .join(sessionEnvironment?.projectDir ?? "")
    .split(SESSION_ID_PLACEHOLDER)
    .join(sessionEnvironment?.sessionId ?? "")
    .split(CWD_PLACEHOLDER)
    .join(sessionEnvironment?.cwd ?? "")
    .split(PLATFORM_PLACEHOLDER)
    .join(sessionEnvironment?.platform ?? "")
    .split(OS_VERSION_PLACEHOLDER)
    .join(sessionEnvironment?.osVersion ?? "")
    .split(DATE_PLACEHOLDER)
    .join(sessionEnvironment?.date ?? "")
    .trim();
}

/**
 * Builds the `ToolConfig` needed by Environment from Agent State.
 *
 * Both builtin tools and MCP Server config are taken from `system_config.yaml`; falls back to the
 * default config when builtin tools are missing.
 */
/**
 * Filters builtin tool entries by the session model's type: entries with `forModel: "vision"` are
 * only used for models that support images (vision models), `forModel: "text-only"` is only for
 * text-only models (e.g. choosing between read_image / describe_image); unlabeled entries are
 * available to all models.
 * Docs: /docs/tools § "Image tools".
 */
export function selectBuiltinToolsForModel(
  tools: ToolDefinitionConfig[],
  modelVision: boolean,
): ToolDefinitionConfig[] {
  const kind = modelVision ? "vision" : "text-only";
  return tools.filter((t) => t.forModel === undefined || t.forModel === kind);
}

export function buildToolConfig(state: AgentState): ToolConfig {
  const systemTools = state.systemConfig.tools;
  const builtin = systemTools?.builtin ?? defaultSystemConfig().tools?.builtin ?? [];
  return {
    customTools: builtin,
    mcpServers: systemTools?.mcpServers ?? [],
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
