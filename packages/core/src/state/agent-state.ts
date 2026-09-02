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
  loadPreinstalledPlugins,
  parseSkillFrontmatter,
  type HookCommand,
  type HookManifest,
  type LibraryPlugin,
  type SkillMetadata,
} from "../plugins/index.js";
import type { ToolConfig, ToolDefinitionConfig } from "../interfaces/index.js";
import { atomicWriteFile } from "../internal/atomic-write.js";
import {
  AGENT_ID_PLACEHOLDER,
  AGENTS_MD_PLACEHOLDER,
  VAULT_KEYS_PLACEHOLDER,
  SKILL_METADATA_PLACEHOLDER,
  CWD_PLACEHOLDER,
  PROVIDER_PLACEHOLDER,
  MODEL_ID_PLACEHOLDER,
  DATE_PLACEHOLDER,
  MEMORY_PLACEHOLDER,
  VAULT_PLACEHOLDER,
  SKILLS_PLACEHOLDER,
  SCHEDULES_PLACEHOLDER,
  SCHEDULE_LIST_PLACEHOLDER,
  SCHEDULE_LIST_EMPTY_NOTE,
  WORKSPACE_MEMORY_DIR_PLACEHOLDER,
  WORKSPACE_MEMORY_INDEX_PLACEHOLDER,
  USER_MEMORY_INDEX_PLACEHOLDER,
  MEMORY_INDEX_EMPTY_NOTE,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_INDEX_MAX_CHARS,
  DEFAULT_MEMORY_PROMPT,
  DEFAULT_MEMORY_WORKSPACE_PROMPT,
  DEFAULT_VAULT_PROMPT,
  DEFAULT_SKILLS_PROMPT,
  DEFAULT_SCHEDULES_PROMPT,
  type MemoryConfig,
  type VaultConfig,
  type SkillsConfig,
  type SchedulesConfig,
  agentStateVersion,
  defaultAgentsMd,
  defaultSystemConfig,
  OS_VERSION_PLACEHOLDER,
  PLATFORM_PLACEHOLDER,
  PROJECT_DIR_PLACEHOLDER,
  SESSION_ID_PLACEHOLDER,
  SHELL_PLACEHOLDER,
  type SystemConfig,
} from "./default-config.js";
import { builtinProjectAgentPresets, type AgentPreset } from "./builtin-agents.js";
import { ensureUserMemoryDir, type SessionMemory } from "./memory.js";
import { provisionExampleBenchmark } from "./example-benchmark.js";
import {
  agentsMdPath,
  agentStateDir,
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  hooksDir,
  memoryDir,
  resolveRoot,
  scheduleDir,
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
  /** `AGENTS.md` as read when the State was loaded. A Session never runs on a State object it did not load itself: every model context is assembled from a fresh `loadAgentState` (see Agent.createSession). */
  agentsMd: string;
}

export interface SessionEnvironmentValues {
  sessionId: string;
  cwd: string;
  /** The Agent id this Session belongs to (system Prompt placeholder {{AGENT_ID}}). */
  agentId: string;
  /** Absolute path to this Project's directory — PenguinHarness's app data root, injected via {{PROJECT_DIR}} and shown to the model as the Environment's "App Data Dir" line (Agent State/scratchpad paths live under its `agents/`). */
  projectDir: string;
  /** The session model's provider group (system Prompt placeholder {{PROVIDER}}; paired with modelId to form the model reference). */
  provider: string;
  /** The session model's upstream model id (system Prompt placeholder {{MODEL_ID}}). */
  modelId: string;
  platform: string;
  osVersion: string;
  /** The shell command sessions run in (system Prompt placeholder {{SHELL}}; e.g. "bash", "pwsh") — tells the model which command syntax exec_command speaks. */
  shell: string;
  date: string;
}

/** Reads the Agent's `AGENTS.md` as it is on disk right now; a missing file reads as the default content (see `loadAgentState`). */
export async function readAgentsMd(
  root: string,
  projectId: string,
  agentId: string,
): Promise<string> {
  const mdPath = agentsMdPath(root, projectId, agentId);
  return (await fileExists(mdPath)) ? await fs.readFile(mdPath, "utf8") : defaultAgentsMd();
}

/**
 * THE Agent State loader — the one function behind initialization and rotation alike.
 *
 * Loads the State as it is on disk right now (`system_config.yaml` and `AGENTS.md`). With
 * `init` given and no `system_config.yaml` present, the directory is treated as a new Agent
 * and initialized first (structure, default config, preinstalled Skills; `init.preset`
 * applies there only) — the create-or-load entry `createAgent` and project provisioning use.
 * Without `init`, a missing Agent throws: the other caller is a model context opening —
 * Session creation, the context a completed compaction opens, a resume that finds its
 * context closed — which must never re-create a deleted Agent as a side effect. Either way
 * an edit to the Agent State lands in the next context and never in the one that is
 * running; the snapshot a long-lived Agent object holds is not what a Session runs on.
 * Docs: /docs/agent-loop § "Compaction".
 */
export async function loadAgentState(opts?: {
  agentId?: string;
  projectId?: string;
  root?: string;
  /** Initialize a not-yet-initialized Agent instead of throwing (`preset` applies on that path only; an existing Agent is never overwritten). */
  init?: { preset?: AgentPreset };
}): Promise<AgentState> {
  const root = opts?.root ?? resolveRoot();
  const projectId = opts?.projectId ?? DEFAULT_PROJECT_ID;
  const agentId = opts?.agentId ?? DEFAULT_AGENT_ID;

  // Validate before building paths, to prevent path traversal.
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);

  const stateDir = agentStateDir(root, projectId, agentId);
  const configPath = systemConfigPath(root, projectId, agentId);

  if (await fileExists(configPath)) {
    // Load path: the State as it is on disk.
    const parsed = parseYaml(await fs.readFile(configPath, "utf8")) as unknown;
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
    return {
      root,
      projectId,
      agentId,
      stateDir,
      systemConfig: parsed as SystemConfig,
      agentsMd: await readAgentsMd(root, projectId, agentId),
    };
  }

  if (!opts?.init) {
    throw new Error(`Agent State is not initialized: ${configPath} does not exist.`);
  }

  // Init path: create the directory structure and write default config (preset only takes effect here).
  await Promise.all([
    fs.mkdir(stateDir, { recursive: true }),
    fs.mkdir(toolsDir(root, projectId, agentId), { recursive: true }),
    // Creates memory/user/ (and memory/ above it) with an empty MEMORY.md, so the User scope
    // exists from the Agent's first day; Workspace scopes appear at Session creation.
    ensureUserMemoryDir(root, projectId, agentId),
    fs.mkdir(skillsDir(root, projectId, agentId), { recursive: true }),
    fs.mkdir(hooksDir(root, projectId, agentId), { recursive: true }),
    fs.mkdir(scratchpadDir(root, projectId, agentId), { recursive: true }),
  ]);
  const preset = opts.init.preset;
  const systemConfig: SystemConfig = {
    ...defaultSystemConfig(),
    ...(preset?.name !== undefined ? { name: preset.name } : {}),
    ...(preset?.description !== undefined ? { description: preset.description } : {}),
  };
  const agentsMd = preset?.agentsMd ?? defaultAgentsMd();
  // Only installs the plugins specified by preset (a plain newly created Agent gets none
  // pre-installed). A default_agent with no preset (e.g. created on first CLI run) still gets
  // the library's preinstalled set (plugins marked `preinstall: false` stay manual-install) —
  // the install policy follows Agent identity, not whether creation came from the server or
  // was done directly via SDK/CLI.
  // Skills have no dedicated tool: metadata is injected via {{SKILL_METADATA}}, and the model
  // reads SKILL.md with shell and follows it. Hook packages run at the loop's hook points.
  const plugins =
    preset === undefined && agentId === DEFAULT_AGENT_ID
      ? loadPreinstalledPlugins()
      : (preset?.plugins ?? []);
  await Promise.all([
    atomicWriteFile(agentsMdPath(root, projectId, agentId), agentsMd, { followSymlinks: true }),
    ...plugins.map((plugin) => installPlugin(root, projectId, agentId, plugin)),
    // The example Benchmark is only provisioned alongside default_agent (so the evaluation
    // center has data out of the box): idempotently skipped if benchmarks/ already exists,
    // and not created for plain Agents.
    ...(agentId === DEFAULT_AGENT_ID ? [provisionExampleBenchmark(root, projectId, agentId)] : []),
  ]);
  // system_config.yaml is written last: its existence is the "initialization complete" marker
  // (the load/init decision point). If this fails partway (disk full / crash), the next run
  // still takes the init path and self-heals, so no half-initialized state with missing Skills is left behind.
  await atomicWriteFile(configPath, stringifyYaml(systemConfig), { followSymlinks: true });

  return { root, projectId, agentId, stateDir, systemConfig, agentsMd };
}

/**
 * Initializes a Project's built-in Agent (the only built-in Agent: default_agent).
 *
 * Calls the init-enabled `loadAgentState` for each one: an Agent whose directory already
 * exists (including a default_agent created earlier by the CLI) is only loaded, never
 * overwritten (preset only takes effect on initialization). Returns the list of built-in
 * Agent ids.
 */
export async function provisionProjectAgents(opts?: {
  root?: string;
  projectId?: string;
}): Promise<string[]> {
  const agentIds: string[] = [];
  for (const { agentId, preset } of builtinProjectAgentPresets()) {
    await loadAgentState({
      ...(opts?.root !== undefined ? { root: opts.root } : {}),
      ...(opts?.projectId !== undefined ? { projectId: opts.projectId } : {}),
      agentId,
      init: { preset },
    });
    agentIds.push(agentId);
  }
  return agentIds;
}

/**
 * Rewrites an Agent's `system_config.yaml` to the current code defaults
 * (`defaultSystemConfig()`) — the config-side analogue of updating an installed Skill to
 * the current library version.
 *
 * Exact semantics: only the identity fields of the existing file are preserved — `name`,
 * `description` and the Agent State `version` (an invalid or missing version normalizes
 * to 1); **everything else is replaced by the defaults**: `system_prompt`, `max_turns`,
 * `model.*`, `compaction.*` (including its prompt) and `tools` (the builtin list and
 * `mcpServers`). Keys outside the default schema are dropped, and YAML comments are not
 * preserved (the file is rewritten from the default object). Other Agent State files
 * (AGENTS.md, skills/, vault, memory/ …) are untouched. Returns the config written.
 *
 * Requires an existing Agent: unlike an init-enabled `loadAgentState` this never initializes a new
 * one — it throws when `system_config.yaml` is missing.
 */
export async function resetSystemConfigToDefaults(
  root: string,
  projectId: string,
  agentId: string,
): Promise<SystemConfig> {
  // Validate before building paths, to prevent path traversal.
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  const configPath = systemConfigPath(root, projectId, agentId);
  if (!(await fileExists(configPath))) {
    throw new Error(`Agent State config not found: ${configPath} (the Agent does not exist).`);
  }
  const parsed = parseYaml(await fs.readFile(configPath, "utf8")) as unknown;
  const prev = (
    parsed !== null && typeof parsed === "object" ? parsed : {}
  ) as Partial<SystemConfig>;
  const next: SystemConfig = {
    ...(typeof prev.name === "string" ? { name: prev.name } : {}),
    ...(typeof prev.description === "string" ? { description: prev.description } : {}),
    ...defaultSystemConfig(),
    version: agentStateVersion(prev),
  };
  await atomicWriteFile(configPath, stringifyYaml(next), { followSymlinks: true });
  return next;
}

/**
 * The vault key-name list: the replacement value for `{{VAULT_KEYS}}`, one `- KEY` per line;
 * returns an empty string when there are no keys.
 * **Contains only key names, never values** — values are only injected into the exec_command
 * subprocess environment, never the model context. The statement of the vault's purpose lives
 * in `vault.prompt` (legacy templates carry it in the template body) and is kept even with no
 * vault.
 */
function vaultKeysList(keys: string[]): string {
  return keys.map((key) => `- ${key}`).join("\n");
}

/**
 * An index for injection: the trimmed `MEMORY.md` content, or the empty note so the model reads
 * "nothing saved" instead of a blank line. Injection is capped at `MEMORY_INDEX_MAX_LINES`
 * lines (one memory per line by convention), then at `MEMORY_INDEX_MAX_CHARS` as a backstop
 * for indexes whose few lines are enormous — past a cap the rest is replaced by a note telling
 * the model to open the full file, and the file itself is never touched.
 */
function indexForInjection(index: string): string {
  const trimmed = index.trim();
  if (trimmed.length === 0) return MEMORY_INDEX_EMPTY_NOTE;
  const totalLines = trimmed.split("\n").length;
  let kept = trimmed.split("\n").slice(0, MEMORY_INDEX_MAX_LINES).join("\n");
  if (kept.length > MEMORY_INDEX_MAX_CHARS) {
    // Cut at a line boundary; only a single line exceeding the cap on its own is cut mid-line.
    const cut = kept.lastIndexOf("\n", MEMORY_INDEX_MAX_CHARS);
    kept = kept.slice(0, cut > 0 ? cut : MEMORY_INDEX_MAX_CHARS);
  }
  if (kept.length === trimmed.length) return trimmed;
  const keptLines = kept.split("\n").length;
  const reason =
    keptLines < totalLines
      ? `showing ${keptLines} of ${totalLines} lines`
      : `showing the first ${MEMORY_INDEX_MAX_CHARS} characters`;
  return `${kept}\n(index truncated: ${reason} — open MEMORY.md for the rest)`;
}

/**
 * The `{{MEMORY}}` replacement value: the Agent's own `memory.prompt` (the User scope and its
 * index, which every Session has), plus `memory.workspace_prompt` when the Session also runs
 * in a persistent Workspace. An empty string when this Session has no Memory (disabled) or
 * when every half that would render is emptied. Both prompts are per-Agent config, editable
 * on the Web App's Memory tab.
 *
 * The two blocks are separate config keys because substitution has no conditionals: a
 * temporary Workspace must never be handed the Workspace scope's section (its directory line
 * and the scope-choice rule), so that half is simply not appended there.
 *
 * Every word of the block comes from `system_config.yaml`; the only text this function can add
 * is `MEMORY_INDEX_EMPTY_NOTE` (via `indexForInjection`, which also caps the index). The only
 * injection points are the two indexes and the Workspace directory
 * (`{{WORKSPACE_MEMORY_DIR}}`, whose key segment is a hash the model could not compose
 * itself) — the User directory stays a literal pattern in the prompt. Topic bodies are never
 * injected — the indexes say what exists, and the model opens what it needs.
 */
function memorySection(
  config: MemoryConfig | undefined,
  memory: SessionMemory | null | undefined,
): string {
  if (!memory) return "";
  // Missing keys fall back to the built-in defaults — matching compaction and the config DTO —
  // so an Agent whose yaml predates Memory injects the very prompts the Memory tab shows it.
  // An explicitly emptied half drops that half alone (`??`, not `||`): the two are edited
  // independently on the Memory tab, so clearing one must never silence the other.
  const promptText = config?.prompt ?? DEFAULT_MEMORY_PROMPT;
  const workspacePromptText = config?.workspace_prompt ?? DEFAULT_MEMORY_WORKSPACE_PROMPT;
  const substituteUser = (text: string): string =>
    text.split(USER_MEMORY_INDEX_PLACEHOLDER).join(indexForInjection(memory.userIndex));

  const userBlock = substituteUser(promptText).trim();
  const workspace = memory.workspace;
  const workspaceBlock =
    workspace && workspacePromptText ? substituteUser(workspacePromptText).trim() : "";
  const joined =
    userBlock && workspaceBlock ? `${userBlock}\n\n${workspaceBlock}` : userBlock || workspaceBlock;
  // The Workspace placeholders substitute over the whole joined block, so one written into
  // the main prompt resolves too (with a real value in a persistent Workspace, blank
  // otherwise) instead of leaking literally.
  return joined
    .split(WORKSPACE_MEMORY_INDEX_PLACEHOLDER)
    .join(workspace ? indexForInjection(workspace.index) : "")
    .split(WORKSPACE_MEMORY_DIR_PLACEHOLDER)
    .join(workspace?.dir ?? "")
    .trim();
}

/**
 * The `{{VAULT}}` replacement value: the Agent's `vault.prompt` (missing key falls back to the
 * built-in default, matching memorySection and the config DTO) with its `{{VAULT_KEYS}}`
 * injection point replaced by the key-name list. An empty string when the section is switched
 * off (`vault.enabled === false`) or no key data was supplied at all; an empty key **list**
 * still renders the statement, so the model is told what the vault is even when it is empty.
 */
function vaultSection(config: VaultConfig | undefined, keys: string[] | undefined): string {
  if (config?.enabled === false || keys === undefined) return "";
  const promptText = config?.prompt ?? DEFAULT_VAULT_PROMPT;
  return promptText.split(VAULT_KEYS_PLACEHOLDER).join(vaultKeysList(keys)).trim();
}

/**
 * The `{{SKILLS}}` replacement value: the Agent's `skills.prompt` (default fallback like
 * memorySection) with its `{{SKILL_METADATA}}` injection point replaced by the installed
 * Skills' metadata lines. An empty string when the section is switched off
 * (`skills.enabled === false`) or no skill data was supplied at all; an empty skill **list**
 * still renders the statement. Metadata only — bodies are read on demand via shell.
 */
function skillsSection(
  config: SkillsConfig | undefined,
  skills: SkillMetadata[] | undefined,
): string {
  if (config?.enabled === false || skills === undefined) return "";
  const promptText = config?.prompt ?? DEFAULT_SKILLS_PROMPT;
  return promptText.split(SKILL_METADATA_PLACEHOLDER).join(skillMetadataSection(skills)).trim();
}

/**
 * The `{{SCHEDULE_LIST}}` roster: one `- name` line per schedule file, or the empty note so
 * the model reads "no tasks" instead of a blank line under `Current tasks:` (the same empty
 * handling as indexForInjection). Names only — the model opens the files it needs.
 */
function scheduleListForInjection(names: string[]): string {
  if (names.length === 0) return SCHEDULE_LIST_EMPTY_NOTE;
  return names.map((name) => `- ${name}`).join("\n");
}

/**
 * The `{{SCHEDULES}}` replacement value: the Agent's `schedules.prompt` (default fallback like
 * memorySection) with its `{{SCHEDULE_LIST}}` injection point replaced by the task-name
 * roster. An empty string when the section is switched off (`schedules.enabled === false`) or
 * no roster was supplied at all; an empty roster still renders the guidance with the empty
 * note, so the model learns the task system before the first task exists.
 */
function schedulesSection(
  config: SchedulesConfig | undefined,
  scheduleNames: string[] | undefined,
): string {
  if (config?.enabled === false || scheduleNames === undefined) return "";
  const promptText = config?.prompt ?? DEFAULT_SCHEDULES_PROMPT;
  return promptText
    .split(SCHEDULE_LIST_PLACEHOLDER)
    .join(scheduleListForInjection(scheduleNames))
    .trim();
}

/**
 * Guards a Skill auxiliary-file path (relative to the skill directory) before it's written:
 * rejects empty, absolute, backslash-bearing, and any `..`-segment path so a file entry can never
 * escape `skills/<name>/`. Mirrors the archive route's zip-slip check for the library-install path.
 */
function assertSafeSkillFile(rel: string): void {
  if (
    rel.length === 0 ||
    path.isAbsolute(rel) ||
    rel.includes("\\") ||
    rel.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(
      `Invalid skill file path ${JSON.stringify(rel)}: it must stay within the skill directory.`,
    );
  }
}

/**
 * Installs a Skill into the target Agent: writes `skills/<name>/SKILL.md` verbatim (the full
 * SKILL.md content including frontmatter, ensuring a trailing newline). An optional icon.svg and
 * any auxiliary `files` the SKILL.md references (e.g. `reference/API.md`, subdirectories
 * preserved) are written alongside it. The directory is replaced wholesale, so reinstalling
 * updates to the latest content and drops files the new version no longer ships — the directory
 * content always matches the Skill being installed. Each file path is checked to stay within the
 * skill directory before anything is written.
 * Docs: /docs/skills § "Installation and storage".
 */
export async function installSkill(
  root: string,
  projectId: string,
  agentId: string,
  skill: { name: string; content: string; icon?: string; files?: Record<string, string> },
): Promise<void> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  assertValidId("skill_name", skill.name);
  const auxiliary = Object.entries(skill.files ?? {});
  for (const [rel] of auxiliary) assertSafeSkillFile(rel);
  const dir = path.join(skillsDir(root, projectId, agentId), skill.name);
  const content = skill.content.endsWith("\n") ? skill.content : `${skill.content}\n`;
  const files: Array<[string, string]> = [
    ["SKILL.md", content],
    ...(skill.icon !== undefined ? ([["icon.svg", skill.icon]] as Array<[string, string]>) : []),
    ...auxiliary,
  ];
  // Clean replace: no stale file survives a reinstall (same semantics as the archive route).
  await replaceSkillDirectory(dir, files);
}

/**
 * Replaces one Skill directory with exactly `files` (relative path → content, subdirectories
 * created as needed). Everything is written into a staging directory and swapped in as the last
 * step, so an interrupted install cannot leave a half-written Skill standing under the real name
 * — the loader's only completeness criterion is that `<name>/SKILL.md` exists, which a directory
 * written file-by-file satisfies long before it is complete. The staging name is dot-prefixed
 * (never a valid Skill name, so it is skipped by the listings) and is cleared first, so a
 * leftover from an earlier crash is never merged into this install.
 *
 * Shared with the server's archive-import route, which installs the same directory from a zip.
 */
export async function replaceSkillDirectory(
  dir: string,
  files: Iterable<[string, string | Uint8Array]>,
): Promise<void> {
  const staging = `${path.join(path.dirname(dir), `.${path.basename(dir)}`)}.incoming`;
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  try {
    await Promise.all(
      [...files].map(async ([rel, data]) => {
        const file = path.join(staging, rel);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, data);
      }),
    );
    // rename(2) refuses to replace a non-empty directory, so the old one goes first. The window
    // between the two is the one case this cannot make atomic; it is bounded by a single rm and
    // leaves the Skill absent rather than corrupt.
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(staging, dir);
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
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
    // A Skill name never starts with a dot (assertValidId), so a dot-prefixed directory is
    // this Agent's staging directory, mid-install or left behind by an interrupted one.
    if (entry.name.startsWith(".")) continue;
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
      ...(parsed ?? { description: "", version: "" }),
      name: entry.name,
      ...(icon !== undefined ? { icon } : {}),
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Installs one library plugin: every skill it ships through `installSkill`, and its hook
 * package (when it has one) through `installHook` — the same writers the library routes use,
 * so a plugin picked at Agent creation and one installed from the library land identically.
 */
export async function installPlugin(
  root: string,
  projectId: string,
  agentId: string,
  plugin: LibraryPlugin,
): Promise<void> {
  for (const skill of plugin.skills) await installSkill(root, projectId, agentId, skill);
  if (plugin.hooks) {
    await installHook(root, projectId, agentId, plugin.hooks.manifest, plugin.hooks.files);
  }
}

/**
 * Installs a hook package as `hooks/<name>/`: the manifest as `hooks.json` plus the package's
 * files (relative path → content, subdirectories preserved), replacing the whole directory
 * like a skill install does. Each file path is checked to stay within the directory.
 * Docs: /docs/skills § "Hooks".
 */
export async function installHook(
  root: string,
  projectId: string,
  agentId: string,
  manifest: HookManifest,
  files: Record<string, string>,
): Promise<void> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  assertValidId("skill_name", manifest.name);
  for (const rel of Object.keys(files)) assertSafeSkillFile(rel);
  const dir = path.join(hooksDir(root, projectId, agentId), manifest.name);
  await replaceSkillDirectory(dir, [
    ["hooks.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ...Object.entries(files),
  ]);
}

/** Uninstalls a hook package: deletes the entire `hooks/<name>/` directory; idempotent. */
export async function removeHook(
  root: string,
  projectId: string,
  agentId: string,
  name: string,
): Promise<void> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  assertValidId("skill_name", name);
  await fs.rm(path.join(hooksDir(root, projectId, agentId), name), {
    recursive: true,
    force: true,
  });
}

/** An installed hook package: its manifest plus the directory its commands resolve against. */
export interface InstalledHook extends HookManifest {
  dir: string;
}

/**
 * Lists the hook packages installed on the target Agent: scans `hooks/<name>/hooks.json`.
 * Tolerant like the skills scan: a directory without a parseable manifest is not a hook
 * package; the directory name is the identity (a manifest naming something else is
 * corrected). Sorted by name; [] when hooks/ doesn't exist.
 */
export async function listInstalledHooks(
  root: string,
  projectId: string,
  agentId: string,
): Promise<InstalledHook[]> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  const base = hooksDir(root, projectId, agentId);
  let entries;
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const hooks: InstalledHook[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(base, entry.name);
    let manifest: Partial<HookManifest>;
    try {
      manifest = JSON.parse(
        await fs.readFile(path.join(dir, "hooks.json"), "utf8"),
      ) as Partial<HookManifest>;
    } catch {
      continue;
    }
    if (manifest === null || typeof manifest !== "object") continue;
    const commands = (list?: HookCommand[]): HookCommand[] =>
      Array.isArray(list)
        ? list
            .filter((c) => c && typeof c.command === "string")
            .map((c) => ({
              command: c.command,
              ...(typeof c.timeout === "number" ? { timeout: c.timeout } : {}),
            }))
        : [];
    const preToolUse = commands(manifest.pre_tool_use);
    const userPrompt = commands(manifest.user_prompt);
    hooks.push({
      name: entry.name,
      description: typeof manifest.description === "string" ? manifest.description : "",
      ...(typeof manifest.descriptionZh === "string"
        ? { descriptionZh: manifest.descriptionZh }
        : {}),
      version: typeof manifest.version === "string" ? manifest.version : "",
      stop: commands(manifest.stop),
      ...(preToolUse.length > 0 ? { pre_tool_use: preToolUse } : {}),
      ...(userPrompt.length > 0 ? { user_prompt: userPrompt } : {}),
      dir,
    });
  }
  return hooks.sort((a, b) => a.name.localeCompare(b.name));
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
 * Task names of the Agent's schedule files: the `agent_state/schedule/*.toml` basenames minus
 * the extension, sorted by name (the stable order Prompt injection wants); [] when the
 * directory does not exist (schedules unconfigured). Names only, contents never read — the
 * `{{SCHEDULE_LIST}}` roster needs just the identities, and file validity is the scheduler's
 * concern (server-side).
 */
export async function listScheduleNames(
  root: string,
  projectId: string,
  agentId: string,
): Promise<string[]> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  try {
    return (await fs.readdir(scheduleDir(root, projectId, agentId), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
      .map((entry) => entry.name.slice(0, -".toml".length))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Compatibility fallback for pre-`{{SHELL}}` system prompt templates.
 *
 * `system_config.yaml` is baked at Agent creation and never auto-upgraded, so an Agent created
 * before the `{{SHELL}}` placeholder existed never tells its model which shell `exec_command`
 * speaks. Such a template was written when bash was the only shell commands ever ran in, so the
 * model keeps emitting bash syntax into whatever the session actually resolved — PowerShell on
 * Windows, and zsh / dash / sh on a POSIX box that has no bash. When the resolved shell is not
 * bash and the template carries no `{{SHELL}}` placeholder, inject a `- Shell: <shell>` line
 * into the assembled prompt at render time: right after the Environment section heading when
 * one exists, else appended as a minimal final line. In-memory only — the stored template is
 * never rewritten, and a prompt that already carries a `- Shell:` line is left untouched
 * (idempotent).
 *
 * The gate is the resolved shell, not the platform: wherever bash resolved — the overwhelmingly
 * common case on every platform — the assembled prompt stays byte-identical, because bash is
 * precisely what these templates already imply.
 *
 * Retirement condition: remove this fallback once pre-`{{SHELL}}` Agent configs (created before
 * the placeholder shipped in PR #79) are no longer expected in the wild.
 */
function withShellLineFallback(
  assembled: string,
  template: string,
  sessionEnvironment?: SessionEnvironmentValues,
): string {
  if (!sessionEnvironment?.shell) return assembled;
  // Bash is what a pre-`{{SHELL}}` template already implies; only a different shell needs saying.
  if (sessionEnvironment.shell === "bash") return assembled;
  if (template.includes(SHELL_PLACEHOLDER)) return assembled; // The template already renders the line itself.
  // Any existing `- Shell:` line means the model is already told a shell — including a custom
  // template hardcoding a different value on purpose; never add a second, contradicting line.
  if (/^- Shell: /m.test(assembled)) return assembled;
  const line = `- Shell: ${sessionEnvironment.shell}`;
  // The default templates head the section with `# Environment`; accept any heading level.
  const heading = /^#+ Environment[ \t]*$/m.exec(assembled);
  if (heading) {
    const insertAt = heading.index + heading[0].length;
    return `${assembled.slice(0, insertAt)}\n${line}${assembled.slice(insertAt)}`;
  }
  return `${assembled}\n${line}`;
}

/** The four section placeholders, expanded together in one final pass (see assembleSystemPrompt). */
const SECTION_PLACEHOLDER_PATTERN = /\{\{(?:MEMORY|VAULT|SKILLS|SCHEDULES)\}\}/g;

/**
 * Renders the complete runtime system Prompt: substitutes `AGENTS.md`, the per-feature section
 * blocks, and the concrete Session runtime environment placeholders into the system Prompt
 * template. The assembly layer only does placeholder substitution and adds no extra text —
 * wrapper text such as `[developer_instructions]` is written directly into the system Prompt
 * template, and the # Vault / # Skills / # Memory / # Scheduled Tasks statements live in the
 * editable `vault.prompt` / `skills.prompt` / `memory.prompt` / `schedules.prompt` config (the
 * Prompt is fully transparent and editable via `system_config.yaml`). Other files in Agent
 * State / Workspace are never auto-injected. Sole exception: a template without `{{SHELL}}`
 * gets a `- Shell:` line injected at render time when the resolved shell is not bash (see
 * `withShellLineFallback`).
 *
 * `{{VAULT}}` expands to the rendered `vault.prompt` (its `{{VAULT_KEYS}}` carrying the
 * key-name list — names only, values never enter the context), `{{SKILLS}}` to `skills.prompt`
 * (its `{{SKILL_METADATA}}` carrying metadata lines; bodies are read on demand), `{{MEMORY}}`
 * to the rendered `memory.prompt` block (plus `memory.workspace_prompt` in a persistent
 * Workspace; only its own `{{USER_MEMORY_INDEX}}` / `{{WORKSPACE_MEMORY_INDEX}}` carry Memory
 * content, indexes capped, and `{{WORKSPACE_MEMORY_DIR}}` renders the Workspace Memory
 * directory), and `{{SCHEDULES}}` to `schedules.prompt` (its `{{SCHEDULE_LIST}}` carrying the
 * task-name roster). Each expands to an empty string when its feature toggle is off. A custom
 * template that removes a placeholder gets no corresponding content injected — the Web App's
 * feature tabs offer inserting the placeholders explicitly.
 *
 * The four section placeholders expand LAST and in a **single pass** (one replace over the
 * otherwise-assembled template): every replacement product — index lines the model wrote,
 * task names, editable section prompts — lands after all other placeholders were consumed and
 * is itself never rescanned, so no section's content can smuggle a `{{VAULT_KEYS}}`-style
 * token into a second expansion, and no section can trigger another section's expansion
 * either.
 *
 * `{{PROJECT_DIR}}` resolves to the Project directory — the app data root the default prompt
 * labels "App Data Dir".
 * Docs: /docs/configuration § "System prompt placeholders".
 */
export function assembleSystemPrompt(
  state: AgentState,
  sessionEnvironment?: SessionEnvironmentValues,
  vaultKeys?: string[],
  skillMetadata?: SkillMetadata[],
  memory?: SessionMemory | null,
  scheduleNames?: string[],
): string {
  const template = state.systemConfig.system_prompt;
  // Legacy template-level inline substitution (compatibility): system_config.yaml is baked at
  // Agent creation and never auto-upgraded, so templates from before the {{VAULT}}/{{SKILLS}}
  // section placeholders carry {{VAULT_KEYS}}/{{SKILL_METADATA}} directly in the template body
  // (inside their hardcoded # Vault / # Skills sections). Those keep substituting here — but
  // honor the new toggles: a disabled feature renders them as empty strings, so the switches
  // work on old templates too. In a current template these tokens only appear inside
  // vault.prompt / skills.prompt and are handled by the section renderers instead.
  // Retirement condition: remove this template-level substitution (leaving the tokens to the
  // section renderers alone) once pre-{{VAULT}}/{{SKILLS}} templates are no longer expected in
  // the wild — same horizon as LEGACY_VAULT_SECTION / LEGACY_SKILLS_SECTION.
  const inlineVaultKeys =
    state.systemConfig.vault?.enabled === false ? "" : vaultKeysList(vaultKeys ?? []);
  const inlineSkillMetadata =
    state.systemConfig.skills?.enabled === false ? "" : skillMetadataSection(skillMetadata ?? []);
  // The single-pass replacement values for the four section placeholders (see the doc comment
  // above for why they expand last and are never rescanned).
  const sections: Record<string, string> = {
    [MEMORY_PLACEHOLDER]: memorySection(state.systemConfig.memory, memory),
    [VAULT_PLACEHOLDER]: vaultSection(state.systemConfig.vault, vaultKeys),
    [SKILLS_PLACEHOLDER]: skillsSection(state.systemConfig.skills, skillMetadata),
    [SCHEDULES_PLACEHOLDER]: schedulesSection(state.systemConfig.schedules, scheduleNames),
  };
  const assembled = template
    .split(AGENTS_MD_PLACEHOLDER)
    .join(state.agentsMd.trim())
    .split(VAULT_KEYS_PLACEHOLDER)
    .join(inlineVaultKeys)
    .split(SKILL_METADATA_PLACEHOLDER)
    .join(inlineSkillMetadata)
    .split(AGENT_ID_PLACEHOLDER)
    .join(sessionEnvironment?.agentId ?? state.agentId)
    .split(PROJECT_DIR_PLACEHOLDER)
    .join(sessionEnvironment?.projectDir ?? "")
    .split(SESSION_ID_PLACEHOLDER)
    .join(sessionEnvironment?.sessionId ?? "")
    .split(CWD_PLACEHOLDER)
    .join(sessionEnvironment?.cwd ?? "")
    .split(PROVIDER_PLACEHOLDER)
    .join(sessionEnvironment?.provider ?? "")
    .split(MODEL_ID_PLACEHOLDER)
    .join(sessionEnvironment?.modelId ?? "")
    .split(PLATFORM_PLACEHOLDER)
    .join(sessionEnvironment?.platform ?? "")
    .split(OS_VERSION_PLACEHOLDER)
    .join(sessionEnvironment?.osVersion ?? "")
    .split(SHELL_PLACEHOLDER)
    .join(sessionEnvironment?.shell ?? "")
    .split(DATE_PLACEHOLDER)
    .join(sessionEnvironment?.date ?? "")
    // The section placeholders expand last, all four in this one replace: a replacer
    // function's return value is spliced in verbatim (no `$`-pattern handling) and the scan
    // continues after it, so nothing a section carries is ever expanded again.
    .replace(SECTION_PLACEHOLDER_PATTERN, (token) => sections[token] ?? token)
    .trim();
  return withShellLineFallback(assembled, template, sessionEnvironment);
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

/**
 * Applies a tool entry's per-tool `call_description` toggle: the `description` call argument
 * is declared as a normal property in the entry's `parameters` (editable config is the
 * single source of truth) and is **required** there, so a tool that offers it always gets
 * one — the frontends can then pick a call's display form up front instead of guessing while
 * the arguments stream. When the entry sets `call_description: false`, the property is
 * filtered out of the schema handed to the LLM, `required` along with it — on an in-memory
 * clone only, the stored YAML is never rewritten. Missing/true, entries without a parameter
 * schema, and entries whose properties declare no `description` all pass through unchanged
 * (old configs predating the field are a no-op).
 */
function applyCallDescriptionToggle(def: ToolDefinitionConfig): ToolDefinitionConfig {
  if (def.call_description !== false) return def;
  const params = def.parameters;
  if (params === undefined) return def;
  const properties = params["properties"];
  if (properties === null || typeof properties !== "object") return def;
  if (!("description" in (properties as Record<string, unknown>))) return def;
  const { description: _dropped, ...rest } = properties as Record<string, unknown>;
  const required = params["required"];
  const trimmed = Array.isArray(required)
    ? { required: required.filter((name) => name !== "description") }
    : {};
  return { ...def, parameters: { ...params, properties: rest, ...trimmed } };
}

export function buildToolConfig(state: AgentState): ToolConfig {
  const systemTools = state.systemConfig.tools;
  const builtin = systemTools?.builtin ?? defaultSystemConfig().tools?.builtin ?? [];
  return {
    customTools: builtin.map(applyCallDescriptionToggle),
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
