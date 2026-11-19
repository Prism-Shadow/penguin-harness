/**
 * The agent domain's API vocabulary: the memory scopes/files/transfer shapes, the Agent
 * config's DTOs, and the vault shapes. Moved from the server's api/types.ts so the contract
 * lives beside its implementation (services+http+cli restack S3). One package, no server
 * dependencies — packages/server imports these; nothing here imports the server.
 */
import type {
  AgentAuthor,
  MCPServerConfig,
  ThinkingLevelName,
  ToolDefinitionConfig,
} from "@prismshadow/penguin-core";

/** Read-only vault entry display: key name + masked value; plaintext is never sent. */
export interface VaultEntryInfo {
  key: string;
  valueMasked: string;
}

export interface VaultResponse {
  entries: VaultEntryInfo[];
}

/** A single entry under PUT full-table replace semantics: omitting value = keep the existing value (required for new keys). */
export interface VaultEntryUpdate {
  /** Shell environment variable name rule: starts with a letter or underscore, followed by letters/digits/underscores only. */
  key: string;
  /** Non-empty string; omitted keeps the existing value. */
  value?: string;
}

/** PUT full-table replace semantics (same as models): keys not present in the body are deleted. */
export interface VaultUpdateRequest {
  entries: VaultEntryUpdate[];
}

// ---------------------------------------------------------------------------
// Agent and its config (system_config.yaml + AGENTS.md)
// ---------------------------------------------------------------------------

export interface AgentModelConfigDto {
  maxTokens?: number;
  thinkingLevel?: ThinkingLevelName;
  timeoutMs?: number;
}

export interface AgentCompactionConfigDto {
  maxContextLength?: number;
  maxSessionTurns?: number;
  mode?: "summarize" | "discard";
  prompt?: string;
}

/** Memory config. All fields report effective values (a config with no `memory` section reads as enabled with the built-in prompts, matching core); the prompts are edited on the Memory tab. */
export interface AgentMemoryConfigDto {
  enabled: boolean;
  /** The always-injected half of the `{{MEMORY}}` block (carries `{{USER_MEMORY_INDEX}}`; the User directory is literal text). */
  prompt: string;
  /** Appended only in a persistent Workspace (carries `{{WORKSPACE_MEMORY_INDEX}}` and the rendered `{{WORKSPACE_MEMORY_DIR}}` directory). */
  workspacePrompt: string;
}

/**
 * Vault prompt-injection config, edited on the Vault tab. `enabled` / `prompt` report
 * effective values (a config with no `vault` section reads as enabled with the built-in
 * prompt, matching core); the last two are read-only facts computed from the stored template.
 */
export interface AgentVaultConfigDto {
  /** Whether the Vault section enters the model context (values are injected into subprocesses regardless). */
  enabled: boolean;
  /** The `{{VAULT}}` block (carries `{{VAULT_KEYS}}`). */
  prompt: string;
  /** Whether the stored template carries `{{VAULT}}`; POST …/vault/template-placeholder inserts (or migrates to) it explicitly. */
  templateHasPlaceholder: boolean;
  /** Whether the stored template still carries the legacy hardcoded # Vault section verbatim (a pre-`{{VAULT}}` Agent) — the migration case of the insert endpoint. */
  legacySectionPresent: boolean;
}

/** Skills prompt-injection config, edited on the Skills tab; same field semantics as AgentVaultConfigDto, for `{{SKILLS}}` / `{{SKILL_METADATA}}` and the legacy # Skills section. */
export interface AgentSkillsConfigDto {
  /** Whether the Skills section enters the model context (installed skills remain explicitly invocable regardless). */
  enabled: boolean;
  /** The `{{SKILLS}}` block (carries `{{SKILL_METADATA}}`). */
  prompt: string;
  /** Whether the stored template carries `{{SKILLS}}`; POST …/skills/template-placeholder inserts (or migrates to) it explicitly. */
  templateHasPlaceholder: boolean;
  /** Whether the stored template still carries the legacy hardcoded # Skills section verbatim — the migration case of the insert endpoint. */
  legacySectionPresent: boolean;
}

/** Schedules prompt-injection config, edited on the Schedules tab. No legacy field: Schedules never had a hardcoded template section. */
export interface AgentSchedulesConfigDto {
  /** Whether the Scheduled Tasks section enters the model context (the server fires configured tasks regardless). */
  enabled: boolean;
  /** The `{{SCHEDULES}}` block (carries `{{SCHEDULE_LIST}}`). */
  prompt: string;
  /** Whether the stored template carries `{{SCHEDULES}}`; POST …/schedules/template-placeholder inserts it explicitly. */
  templateHasPlaceholder: boolean;
}

/**
 * Hook config, edited on the Hooks tab. One Agent-level switch and no prompt: hook packages
 * are scripts run at the loop's hook points, not text injected into the context. `enabled`
 * reports the effective value (a config with no `hooks` section reads as enabled, matching
 * core).
 */
export interface AgentHooksConfigDto {
  /** Whether a Session created from now on runs the installed hook packages (they stay installed either way). */
  enabled: boolean;
}

/** Structured view of system_config.yaml (for the edit form). */
export interface AgentConfigDto {
  name?: string;
  description?: string;
  /** The effective author: the stored value, `user` when the field is missing or unknown. This server always sends it; absent (a machine on an older server) reads as `user`. */
  author?: AgentAuthor;
  /** Agent State version number (treated as 1 if missing; shown in the settings page overview). */
  version: number;
  /** The stored kernel stamp (`kernel_version`): which defaults generation the config is based on; null when the config predates the kernel-version mechanism. */
  kernelVersion: string | null;
  /** The current defaults generation (core's KERNEL_VERSION) — what a kernel update would stamp. */
  kernelLatest: string;
  /** Whether the stamp is behind kernelLatest (a missing stamp counts as outdated). */
  kernelOutdated: boolean;
  systemPrompt: string;
  maxTurns?: number;
  model?: AgentModelConfigDto;
  compaction?: AgentCompactionConfigDto;
  memory: AgentMemoryConfigDto;
  vault: AgentVaultConfigDto;
  skills: AgentSkillsConfigDto;
  schedules: AgentSchedulesConfigDto;
  hooks: AgentHooksConfigDto;
  toolsBuiltin: ToolDefinitionConfig[];
  mcpServers: MCPServerConfig[];
}

export interface AgentConfigResponse {
  agentsMd: string;
  /** Raw system_config.yaml text (read-only display / diagnostics). */
  systemConfigYaml: string;
  config: AgentConfigDto;
  /** Agent State absolute path. */
  stateDir: string;
  activeSessionCount: number;
}

/**
 * POST …/config/kernel-update result: the smart merge's outcome (core's applyKernelUpdate).
 * The entries are Agent settings **tabs** (`prompt`, `runtime`, `tools`, `skills`, `memory`,
 * `vault`, `schedules`) in the settings page's tab order; the client maps them to tab labels.
 */
export interface AgentKernelUpdateResponse {
  /** Tabs advanced to the current defaults (previously absent, or an untouched old default). */
  advanced: string[];
  /** Tabs kept whole because they match no recorded default (customized, kept conservatively). */
  kept: string[];
  /** The kernel stamp written (the current defaults generation). */
  kernelVersion: string;
}

/** PUT any subset: only provided keys are updated (remaining YAML content and comments preserved); agentsMd overwrites the whole file. */
export interface AgentConfigUpdateRequest {
  agentsMd?: string;
  config?: {
    name?: string;
    description?: string;
    author?: AgentAuthor;
    systemPrompt?: string;
    maxTurns?: number;
    model?: AgentModelConfigDto;
    compaction?: AgentCompactionConfigDto;
    memory?: Partial<AgentMemoryConfigDto>;
    /** Only the writable half of the DTO — the template facts (templateHasPlaceholder / legacySectionPresent) are computed, never written. */
    vault?: { enabled?: boolean; prompt?: string };
    skills?: { enabled?: boolean; prompt?: string };
    schedules?: { enabled?: boolean; prompt?: string };
    /** The Agent-level hook switch; it has no prompt half. */
    hooks?: { enabled?: boolean };
    toolsBuiltin?: ToolDefinitionConfig[];
    mcpServers?: MCPServerConfig[];
  };
}

export interface AgentConfigView {
  agentsMd: string;
  systemConfigYaml: string;
  config: AgentConfigDto;
  stateDir: string;
}
/** One Memory scope directory: `agent_state/memory/user/` or `agent_state/memory/<workspaceKey>/`. */
export interface MemoryScopeInfo {
  /** Directory name under `memory/`: `user`, or a Workspace's `<safe-basename>-<hash>` key. */
  scopeKey: string;
  /** `user` — the scope every Session reads, temporary Workspaces included; `workspace` — one Workspace's scope. */
  kind: "user" | "workspace";
  /** Workspace path the key was derived from, read from the directory's `.workspace` marker; unset on the user scope (it stands for no path) and for a directory edited by hand. */
  workspacePath?: string;
  /** Number of Markdown topic files in the directory (the `MEMORY.md` index not counted; the files a topic keeps are part of that topic). */
  fileCount: number;
  /** Whether the directory holds a `MEMORY.md` index, so an import confirmation can say whether one would be replaced. */
  hasIndex: boolean;
  /** Most recent mtime among the directory's topic files and the files they keep (ISO 8601); unset when it holds no topic file. */
  updatedAt?: string;
}

/**
 * One file kept in a folder of a scope: a topic's folder — named after its file without the
 * `.md`, beside it (`csv-tools/` for `csv-tools.md`) — or a folder that belongs to no topic.
 * Any regular file, in any language, at any depth under the folder.
 */
export interface MemoryFolderFile {
  /** Its place in the scope directory, folder first: `csv-tools/dedupe.py`, `csv-tools/lib/io.py`. The file routes address it by this path. */
  path: string;
  /** File size in bytes. */
  size: number;
  /** File mtime (ISO 8601). */
  modifiedAt: string;
}

/** One memory topic file, as listed (frontmatter only — the body is fetched per file). */
export interface MemoryFileInfo {
  /** File name inside the scope directory, e.g. `prefers-pnpm.md`. */
  name: string;
  /** Frontmatter `name`; falls back to the file name. */
  title: string;
  /** Frontmatter `description`; empty when the file declares none. */
  description: string;
  /** Frontmatter `updated_at`, verbatim. */
  updatedAt?: string;
  /** File size in bytes. */
  size: number;
  /** File mtime (ISO 8601). */
  modifiedAt: string;
  /** The files the topic keeps in its folder, at every depth, in path order; empty when it keeps none. */
  files: MemoryFolderFile[];
}

/** GET …/memory — the tab's landing payload: the switch and every scope group, user scope first. */
export interface MemoryOverviewResponse {
  /** Whether Memory reaches the model context (the Agent-level switch). */
  enabled: boolean;
  /** Whether the prompt template carries the `{{MEMORY}}` placeholder. An Agent created before Memory has none and injects nothing; POST …/memory/template-placeholder inserts it explicitly. */
  templateHasMemory: boolean;
  /** Absolute path of `agent_state/memory/`. */
  memoryDir: string;
  scopes: MemoryScopeInfo[];
}

/** GET …/memory/scopes/:key/files */
export interface MemoryFilesResponse {
  scopeKey: string;
  files: MemoryFileInfo[];
  /** Files in folders with no topic of their name beside them (`notes/` without `notes.md`). They belong to no memory, and are listed so that none is hidden. */
  orphanFiles: MemoryFolderFile[];
}

/**
 * GET …/memory/scopes/:key/files/:path — one memory file by its path in the scope: a topic
 * (`prefers-pnpm.md`) with the files it keeps, or a kept file (`csv-tools/dedupe.py`). For a kept
 * file `file` describes that file: its path as `name` and `title`, no description, no `files`;
 * its text is handed out up to 512 KB of UTF-8 (413 `memory_file_too_large`, 415
 * `memory_file_not_text` otherwise).
 */
export interface MemoryFileResponse {
  scopeKey: string;
  file: MemoryFileInfo;
  content: string;
}

/** One topic file inside a version 1 transfer document: the name it had in its scope, and its whole text. */
export interface MemoryTransferFile {
  /** File name inside the scope directory, e.g. `prefers-pnpm.md` — a name, never a path. */
  name: string;
  /** The file's full Markdown text, frontmatter included. */
  content: string;
}

/**
 * The JSON document GET …/export answered with up to 0.2.x: the topic files and the scope's
 * `MEMORY.md`. The export is a zip now; an import still reads this document (`payload`).
 */
export interface MemoryScopeExport {
  /** Format marker, so a foreign JSON file is refused with a clear reason rather than half-imported. */
  format: "penguin-memory-scope";
  /** Document version. Only version 1 was ever written. */
  version: 1;
  /** The scope this was exported from. Informational: an import writes into the scope its URL names. */
  scopeKey: string;
  kind: MemoryScopeInfo["kind"];
  /** The Workspace the source scope stood for, when it had a `.workspace` marker. */
  workspacePath?: string;
  /** When the document was produced (ISO 8601). */
  exportedAt: string;
  /** The scope's `MEMORY.md`, or null when the scope has none. Only the index reaches the model's context. */
  index: string | null;
  files: MemoryTransferFile[];
}

/**
 * What an import does with a memory the target scope already holds. A memory is a topic file and
 * the folder of its name (`csv-tools.md`, `csv-tools/`), and each mode acts on the two together; a
 * folder with no topic beside it is a memory of its own, named `<folder>/`:
 *   - `skip` — keep what is on disk, write only memories the scope does not have (destroys nothing);
 *   - `overwrite` — a memory the import carries replaces the one here, topic and folder;
 *   - `replace` — additionally delete every memory the import does not carry.
 * The two destructive modes require `confirm`.
 */
export type MemoryImportMode = "skip" | "overwrite" | "replace";

/**
 * POST …/memory/scopes/:key/import — exactly one of `dataBase64` and `payload`.
 *
 * Without `confirm`, an import that would overwrite or delete is refused with 409
 * `memory_import_confirm_required`, whose `details` name what is at stake: `overwritten` and
 * `removed` as JSON arrays of memory names, `replacesIndex` as `"true"` or `"false"`.
 */
export interface MemoryImportRequest {
  /** Defaults to `skip`. */
  mode?: MemoryImportMode;
  /** Required by an `overwrite` or `replace` that would destroy something. */
  confirm?: boolean;
  /** A zip of the scope folder as GET …/export answers it, base64: `MEMORY.md`, `<name>.md` and `<name>/…` at its root. */
  dataBase64?: string;
  /** A version 1 JSON document, exported before the zip. */
  payload?: MemoryScopeExport;
}

/** What one import did, memory by memory (a topic's name, or `<folder>/` for a folder with no topic), so the UI can report it rather than claim success. */
export interface MemoryImportResponse {
  scopeKey: string;
  mode: MemoryImportMode;
  /** Memories written that the scope did not have. */
  added: string[];
  /** Memories whose topic and folder were replaced, named as the scope held them. */
  overwritten: string[];
  /** Memories left untouched because the scope already had them (`skip` only), named as the scope holds them. */
  skipped: string[];
  /** Memories deleted, topic and folder, because `replace` dropped what the import did not carry. */
  removed: string[];
  /** Whether the scope's `MEMORY.md` was written or extended. */
  indexWritten: boolean;
}
// ---------------------------------------------------------------------------
// The archive query and the avatar cap (from api/types.ts, S3)
// ---------------------------------------------------------------------------

/**
 * The avatar cap — a user's own and an employee's — in characters of the data URL as it arrives
 * (131072 characters of base64 hold roughly 96 KiB of image): the same number the Web App
 * re-encodes against, so the browser and the server cannot disagree about what "too large"
 * means.
 */
export const AVATAR_MAX_CHARS = 131072;

/**
 * The archive route's query. Each part is `1` (carried) or `0` (left out); an absent part takes
 * its default: all carried but `schedules`, since an imported task runs on its schedule.
 * `workbenchData` is each workbench's `state.json`, and means nothing without `workbenches`.
 */
export interface AgentArchiveQuery {
  skills?: "0" | "1";
  hooks?: "0" | "1";
  memory?: "0" | "1";
  workbenches?: "0" | "1";
  workbenchData?: "0" | "1";
  schedules?: "0" | "1";
  /**
   * Which Sessions' Traces travel, every file of each: none (the default); the last N by
   * activity, 1–500, a subagent Session following its parent; or those whose date directory
   * lies in the range, both ends included.
   */
  traces?: "none" | `last:${number}` | `${string}..${string}`;
}
