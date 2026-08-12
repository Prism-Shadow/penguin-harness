/**
 * Default system configuration for Agent State (written to `system_config.yaml`) and the
 * default `AGENTS.md` (empty).
 *
 * Runtime Prompt and tool configuration should come from editable files;
 * code only supplies the initial defaults. `system_config.yaml` holds the relatively stable
 * system-level Prompt, built-in tools, and MCP Server configuration; `AGENTS.md` is injected
 * via a system Prompt placeholder.
 *
 * The system Prompt is sectioned and trimmed as needed (Role/Personality/Success
 * criteria/Constraints/Stop rules/Tool use/System markers/File system/Suggested workflows); it
 * does not describe specific tools (that comes from the tool schema). AGENTS.md and the
 * Vault/Skills/Memory/Schedules section placeholders go at the end, before Environment.
 *
 * Placeholders (`{{...}}`) appear only in the trailing injection zones (AGENTS.md / Vault /
 * Skills / Memory / Schedules / Environment); elsewhere the body uses angle-bracket notation
 * such as \`<app_data_dir>\`, \`<agent_id>\`, \`<session_id>\` — these are **not substituted**;
 * the model fills in the actual values from the Environment section itself.
 */
import type { MCPServerConfig, ThinkingLevelName, ToolDefinitionConfig } from "../interfaces.js";
import type { CompactionMode } from "../omnimessage/types.js";
import { KERNEL_VERSION } from "./kernel-history.js";

/** Docs: /docs/configuration § "System prompt placeholders". */
export const AGENTS_MD_PLACEHOLDER = "{{AGENTS_MD}}";
/**
 * Inside `vault.prompt`: the vault key-name list, one `- KEY` per line — names only, never
 * values. Also still substituted when written directly in the template body, for templates
 * from before the `{{VAULT}}` section placeholder (see assembleSystemPrompt's legacy inline
 * compatibility), where it honors `vault.enabled` the same way.
 */
export const VAULT_KEYS_PLACEHOLDER = "{{VAULT_KEYS}}";
/**
 * Inside `skills.prompt`: the installed Skills' metadata lines. Also still substituted when
 * written directly in the template body, for templates from before the `{{SKILLS}}` section
 * placeholder (see assembleSystemPrompt's legacy inline compatibility), where it honors
 * `skills.enabled` the same way.
 */
export const SKILL_METADATA_PLACEHOLDER = "{{SKILL_METADATA}}";
export const SESSION_ID_PLACEHOLDER = "{{SESSION_ID}}";
export const CWD_PLACEHOLDER = "{{CWD}}";
export const AGENT_ID_PLACEHOLDER = "{{AGENT_ID}}";
/** The Project directory — PenguinHarness's app data root, exposed in the default prompt as the "App Data Dir" Environment line (deliberately not called a project/task directory there). */
export const PROJECT_DIR_PLACEHOLDER = "{{PROJECT_DIR}}";
export const PROVIDER_PLACEHOLDER = "{{PROVIDER}}";
export const MODEL_ID_PLACEHOLDER = "{{MODEL_ID}}";
export const PLATFORM_PLACEHOLDER = "{{PLATFORM}}";
export const OS_VERSION_PLACEHOLDER = "{{OS_VERSION}}";
/** The shell exec_command runs (`bash` on POSIX; on Windows whatever shell.ts resolved), so the model knows which command syntax to write. */
export const SHELL_PLACEHOLDER = "{{SHELL}}";
export const DATE_PLACEHOLDER = "{{DATE}}";
/**
 * Expands to the rendered `memory.prompt` block, plus `memory.workspace_prompt` when the
 * Session runs in a persistent Workspace; an empty string when Memory is off. A template
 * without this placeholder injects no Memory at all — the Web App's Memory tab offers
 * inserting it as an explicit action, nothing is spliced in automatically.
 */
export const MEMORY_PLACEHOLDER = "{{MEMORY}}";
/**
 * Inside `memory.workspace_prompt` only: the absolute path of the current Workspace's Memory
 * directory (`…/memory/<workspace_memory_key>`). The key half is a hash the model could never
 * derive itself, so the resolved directory is rendered right where the prompt names it —
 * the User section's directory stays a literal `<app_data_dir>/…` pattern, resolvable from
 * the Environment section.
 */
export const WORKSPACE_MEMORY_DIR_PLACEHOLDER = "{{WORKSPACE_MEMORY_DIR}}";
/** Inside `memory.workspace_prompt` only: the content of the current Workspace scope's `MEMORY.md` index (capped, see MEMORY_INDEX_MAX_LINES / MEMORY_INDEX_MAX_CHARS). */
export const WORKSPACE_MEMORY_INDEX_PLACEHOLDER = "{{WORKSPACE_MEMORY_INDEX}}";
/** Inside either Memory prompt: the content of the User scope's `MEMORY.md` index (capped, see MEMORY_INDEX_MAX_LINES / MEMORY_INDEX_MAX_CHARS). */
export const USER_MEMORY_INDEX_PLACEHOLDER = "{{USER_MEMORY_INDEX}}";
/**
 * Expands to the rendered `vault.prompt` block (the # Vault section statement plus the
 * `{{VAULT_KEYS}}` key-name list); an empty string when the Vault section is off. A template
 * without this placeholder injects no Vault section at all — the Web App's Vault tab offers
 * inserting it (or migrating a legacy hardcoded section) as an explicit action, nothing is
 * spliced in automatically.
 */
export const VAULT_PLACEHOLDER = "{{VAULT}}";
/**
 * Expands to the rendered `skills.prompt` block (the # Skills section statement plus the
 * `{{SKILL_METADATA}}` metadata lines); an empty string when the Skills section is off. A
 * template without this placeholder injects no Skills section at all — the Web App's Skills
 * tab offers inserting it (or migrating a legacy hardcoded section) as an explicit action,
 * nothing is spliced in automatically.
 */
export const SKILLS_PLACEHOLDER = "{{SKILLS}}";
/**
 * Expands to the rendered `schedules.prompt` block (the # Scheduled Tasks section teaching
 * file-based task management, plus the `{{SCHEDULE_LIST}}` task roster); an empty string when
 * the Schedules section is off. A template without this placeholder injects no Schedules
 * section at all — the Web App's Schedules tab offers inserting it as an explicit action,
 * nothing is spliced in automatically.
 */
export const SCHEDULES_PLACEHOLDER = "{{SCHEDULES}}";
/** Inside `schedules.prompt` only: the current schedule-file names, one `- name` per line (SCHEDULE_LIST_EMPTY_NOTE when none exist). */
export const SCHEDULE_LIST_PLACEHOLDER = "{{SCHEDULE_LIST}}";

/**
 * Context compaction config (the `compaction` section of `system_config.yaml`).
 * Docs: /docs/configuration § "Agent config".
 */
export interface CompactionConfig {
  /** Context Token threshold (taken from the most recent token_usage's request.total); defaults to 128000, <=0 disables. */
  max_context_length?: number;
  /** Session cumulative turn threshold (counted in LLM Requests, across Tasks); defaults to -1, <=0 means no limit. */
  max_session_turns?: number;
  /** Compaction mode; defaults to summarize. */
  mode?: CompactionMode;
  /** Prompt template for summarize compaction; defaults to the built-in value (editable config, not hardcoded). */
  prompt?: string;
}

/**
 * Memory config (the `memory` section of `system_config.yaml`). Both prompts are editable on
 * the Web App's Memory tab and rendered into the template's `{{MEMORY}}` placeholder.
 * Docs: /docs/configuration § "Memory".
 */
export interface MemoryConfig {
  /** Whether Memory enters the model context and its directories are prepared; defaults to true. */
  enabled?: boolean;
  /**
   * The always-injected half of the `{{MEMORY}}` block: what Memory is for, the save mechanics,
   * and the User scope with its index — carrying the `{{USER_MEMORY_INDEX}}` injection point
   * (the User directory is literal text, not a placeholder). Defaults to the built-in value.
   */
  prompt?: string;
  /**
   * Appended to `prompt` only when the Session runs in a persistent Workspace: the Workspace
   * scope, its index and the rule for choosing between the two — carrying
   * `{{WORKSPACE_MEMORY_INDEX}}` and the `{{WORKSPACE_MEMORY_DIR}}` directory. A separate key
   * rather than a conditional inside `prompt` because substitution has no conditionals — a
   * temporary Workspace would otherwise be told about a scope it does not have.
   */
  workspace_prompt?: string;
}

/**
 * Vault prompt-injection config (the `vault` section of `system_config.yaml`). The prompt is
 * editable on the Web App's Vault tab and rendered into the template's `{{VAULT}}` placeholder.
 * The toggle governs prompt injection only: with it off, vault values are still injected into
 * shell subprocess environments — the model is just not shown the key-name roster.
 * Docs: /docs/configuration § "Vault".
 */
export interface VaultConfig {
  /** Whether the Vault section enters the model context; defaults to true. */
  enabled?: boolean;
  /** The `{{VAULT}}` block: the section statement carrying the `{{VAULT_KEYS}}` key-name injection point. Defaults to the built-in value. */
  prompt?: string;
}

/**
 * Skills prompt-injection config (the `skills` section of `system_config.yaml`). The prompt is
 * editable on the Web App's Skills tab and rendered into the template's `{{SKILLS}}`
 * placeholder. The toggle governs prompt injection only: with it off, installed Skills stay on
 * disk and can still be invoked explicitly (e.g. via a [use_skills] block naming them) — the
 * model is just not shown the roster.
 * Docs: /docs/skills.
 */
export interface SkillsConfig {
  /** Whether the Skills section enters the model context; defaults to true. */
  enabled?: boolean;
  /** The `{{SKILLS}}` block: the section statement carrying the `{{SKILL_METADATA}}` metadata-line injection point. Defaults to the built-in value. */
  prompt?: string;
}

/**
 * Schedules prompt-injection config (the `schedules` section of `system_config.yaml`). The
 * prompt is editable on the Web App's Schedules tab and rendered into the template's
 * `{{SCHEDULES}}` placeholder. The toggle governs prompt injection only: with it off, the
 * server still fires configured tasks on time — the model is just not taught the file-based
 * task system.
 * Docs: /docs/configuration § "Schedules".
 */
export interface SchedulesConfig {
  /** Whether the Scheduled Tasks section enters the model context; defaults to true. */
  enabled?: boolean;
  /** The `{{SCHEDULES}}` block: the file-based task-management guidance carrying the `{{SCHEDULE_LIST}}` roster injection point. Defaults to the built-in value. */
  prompt?: string;
}

/** Stands in for an index placeholder when the `MEMORY.md` does not exist yet or is blank — the model is told the store is empty rather than being handed nothing. */
export const MEMORY_INDEX_EMPTY_NOTE = "(the index is empty — nothing has been saved yet)";

/** Stands in for `{{SCHEDULE_LIST}}` when no schedule files exist yet — the model is told the roster is empty rather than being handed nothing (mirrors MEMORY_INDEX_EMPTY_NOTE). */
export const SCHEDULE_LIST_EMPTY_NOTE = "(no scheduled tasks defined yet)";

/**
 * Cap on injected index lines per scope (one memory per line by convention), so a runaway
 * `MEMORY.md` cannot flood the context. Only the injection is capped — the file on disk is
 * never touched — and a truncation note tells the model to open the full index itself.
 */
export const MEMORY_INDEX_MAX_LINES = 200;

/**
 * Character backstop on an injected index, applied after the line cap: catches the long-line
 * index the line cap alone misses (a file under 200 lines can still be arbitrarily large).
 * Deliberately code-only — the default prompt teaches per-line brevity (~150 characters)
 * instead of quoting this number; when the backstop does fire, the truncation note says so.
 */
export const MEMORY_INDEX_MAX_CHARS = 25_000;

/**
 * Built-in default Memory Prompt: the always-injected half of the `{{MEMORY}}` block, in
 * template-example form — a fenced frontmatter example, what is worth saving, the index
 * contract (the line cap and a per-line length hint, so the model keeps the index short
 * before ever hitting the code-side caps) and the hygiene rules, then the User scope section
 * with its index. Stored
 * per-Agent in `system_config.yaml` and editable on the Web App's Memory tab. The User
 * directory is literal text in the template's angle-bracket convention (resolved from the
 * Environment section by the model, like the Skills paths) — the only injection point is the
 * index itself.
 */
export const DEFAULT_MEMORY_PROMPT = `# Memory
Your long-term record across sessions: Markdown files you maintain with the file tools, in the memory directories named below (they already exist). One file per fact, with frontmatter:

\`\`\`markdown
---
name: <kebab-case-slug, matching the file name>
description: <one line — used to decide relevance during recall>
updated_at: <YYYY-MM-DD>
---

<the fact; for corrections and decisions add **Why:** and **How to apply:** lines. Link related memories with [[their-name]] — a name that doesn't exist yet is fine. Write dates absolute.>
\`\`\`

Worth saving: who the user is (role, expertise, preferences) and how they want you to work, with the why; ongoing work, goals and constraints not derivable from the code; pointers to external resources.

Each directory's \`MEMORY.md\` is its index, injected below: one line per memory, under ~150 characters (\`- [Title](file.md) — hook\`), no content, updated in the same round as the file — deletions included. Only the first ${MEMORY_INDEX_MAX_LINES} lines of an index are injected — keep it well under that: merge overlapping entries, drop stale ones, move detail into the topic files. Before saving, check the index and update the file that already covers the subject instead of duplicating; delete memories that prove wrong. Never save what code, config or git history already states, task progress, secrets, unconfirmed guesses, or transcript excerpts — if asked to, save the non-obvious part instead. Memory is readable by everyone who can reach this agent: no sensitive personal data.

## User memory
What holds wherever you work; every one of your sessions reads it.

User Memory Dir: \`<app_data_dir>/agents/<agent_id>/agent_state/memory/user\`

Index:
{{USER_MEMORY_INDEX}}`;

/**
 * Built-in default for the Workspace half of the `{{MEMORY}}` block, appended to
 * `memory.prompt` only when the Session runs in a persistent Workspace. The rule for choosing
 * between the two scopes lives here on purpose: a Session in a temporary Workspace has one
 * scope and no choice to make, so it never sees the rule at all. The directory is rendered in
 * place via `{{WORKSPACE_MEMORY_DIR}}` — its final segment is a path hash the model could not
 * compose from Environment values the way it can the User directory.
 */
export const DEFAULT_MEMORY_WORKSPACE_PROMPT = `## Workspace memory
Facts about the workspace you are working in now. What would still hold in a different project goes in user memory; when unsure, write here.

Workspace Memory Dir: \`{{WORKSPACE_MEMORY_DIR}}\`

Index:
{{WORKSPACE_MEMORY_INDEX}}`;

/**
 * The pre-`{{VAULT}}` default template's hardcoded # Vault section, frozen verbatim (its
 * trailing inline `{{VAULT_KEYS}}` included) so `insertVaultPlaceholder` can migrate a stored
 * legacy template by exact replacement — `system_config.yaml` is materialized at Agent
 * creation and never auto-upgraded, so existing templates carry this text until that explicit
 * action. Never edit this constant: it must keep matching what old yaml files actually
 * contain, even after `DEFAULT_VAULT_PROMPT` evolves away from it.
 *
 * Retirement condition: remove together with `insertVaultPlaceholder`'s migration branch once
 * pre-`{{VAULT}}` templates (Agents created before the section placeholder shipped) are no
 * longer expected in the wild.
 */
export const LEGACY_VAULT_SECTION = `# Vault
The vault holds this agent's per-agent secrets (agent_state/.vault.toml). Each entry is injected into your shell subprocesses as an environment variable — values never appear in your context. Use the variable names below in commands when a task needs them.
${VAULT_KEYS_PLACEHOLDER}`;

/**
 * The pre-`{{SKILLS}}` default template's hardcoded # Skills section, frozen verbatim (its
 * trailing inline `{{SKILL_METADATA}}` included) for `insertSkillsPlaceholder`'s migration
 * branch. Same freeze rule and retirement condition as `LEGACY_VAULT_SECTION`.
 */
export const LEGACY_SKILLS_SECTION = `# Skills
Skills are reusable instruction packages at \`<app_data_dir>/agents/<agent_id>/agent_state/skills/<skill_name>/SKILL.md\`. When a task matches one below, or the user asks for one (the message may start with a [use_skills] block naming them), read that SKILL.md in full with read_file, then follow it. If a request names a skill without a concrete task, ask the user what they need first.
${SKILL_METADATA_PLACEHOLDER}`;

/**
 * Built-in default Vault Prompt: what `{{VAULT}}` expands to — currently word-for-word the
 * section the pre-toggle default template hardcoded (the toggle refactor moved the text into
 * editable config without changing a word), ending in the `{{VAULT_KEYS}}` key-name list.
 * Stored per-Agent in `system_config.yaml` and editable on the Web App's Vault tab. A future
 * wording change goes here (as a new literal); the legacy constant stays frozen.
 */
export const DEFAULT_VAULT_PROMPT = LEGACY_VAULT_SECTION;

/**
 * Built-in default Skills Prompt: what `{{SKILLS}}` expands to — currently word-for-word the
 * legacy hardcoded section (same move-not-reword relationship as `DEFAULT_VAULT_PROMPT`),
 * ending in the `{{SKILL_METADATA}}` metadata lines. Stored per-Agent in `system_config.yaml`
 * and editable on the Web App's Skills tab.
 */
export const DEFAULT_SKILLS_PROMPT = LEGACY_SKILLS_SECTION;

/**
 * Built-in default Schedules Prompt: what `{{SCHEDULES}}` expands to — teaches the model to
 * manage scheduled tasks as TOML files with its ordinary file tools (there is no dedicated
 * tool), in template-example form like DEFAULT_MEMORY_PROMPT: the directory as a literal
 * angle-bracket pattern resolvable from the Environment section, a fenced example, the field
 * rules schedule-file.ts enforces, the hygiene rules, then the current roster via
 * `{{SCHEDULE_LIST}}`. Stored per-Agent in `system_config.yaml` and editable on the Web App's
 * Schedules tab.
 */
export const DEFAULT_SCHEDULES_PROMPT = `# Scheduled Tasks
Prompts delivered to this agent on a timer: TOML files you manage with the file tools, in \`<app_data_dir>/agents/<agent_id>/agent_state/schedule/\` (create the directory if it does not exist). One task per file; the file name minus \`.toml\` is the task's name (letters, digits, \`_\` and \`-\` only). The server re-reads the directory within about 30 seconds — creating, editing or deleting a file is all it takes, there is nothing to register.

\`\`\`toml
prompt = "Check yesterday's build results and summarize the failures"
enabled = true
start_at = 2026-08-01T09:00:00Z
period = "12h"
\`\`\`

Field rules: \`prompt\` (required) is the message sent when the task fires. \`enabled\` defaults to false — set it to true explicitly or the task never runs. \`start_at\` (required) is the first trigger time, an ISO 8601 instant. \`period\` is a fixed interval like \`30m\` / \`12h\` / \`7d\` (5 minutes minimum); omit it for a one-shot task. \`end_at\` (optional) must be later than start_at; a periodic task stops after it. Each trigger starts a new Session by default: \`workspace\` (optional) picks its working directory, and \`provider\` + \`model_id\` pick its model — always both or neither; omit both to use the Project's default model. Setting \`session_id\` instead sends the prompt into an existing Session, and cannot be combined with workspace / provider / model_id.

Check the current tasks below before creating one so you never duplicate an existing task; change a task by editing its file in place; delete the file when a task is obsolete.

Current tasks:
${SCHEDULE_LIST_PLACEHOLDER}`;

/**
 * System-level config for Agent State, serialized as `system_config.yaml`.
 * Docs: /docs/configuration § "Agent config".
 */
export interface SystemConfig {
  /** Agent display name (display name is separate from id; falls back to id when unset). */
  name?: string;
  /** Agent description. */
  description?: string;
  /** Agent State version number: a natural number, 1 on creation, incremented on successful optimization; a missing field is treated as 1. */
  version?: number;
  /**
   * Kernel version: which generation of the built-in defaults this config is based on, as a
   * date string (`KERNEL_VERSION` at materialization time — creation, restore-defaults, or a
   * kernel update). Unrelated to `version` (the optimization counter): user edits change
   * neither the defaults generation nor this stamp — only the three materialization paths
   * write it. A missing field means the config predates the kernel-version mechanism and is
   * treated as outdated. See kernel-history.ts / kernel-update.ts.
   */
  kernel_version?: string;
  /** System-level Prompt (relatively stable; should not be modified frequently). */
  system_prompt: string;
  /**
   * Max LLM turns per Task (a runtime parameter that belongs to Agent config, not specified
   * when creating a Session). A positive integer caps the Task; -1 (the default) removes the
   * cap so long runs are never cut off mid-task. Valid values are > 0 or exactly -1.
   */
  max_turns?: number;
  model?: {
    max_tokens?: number;
    thinking_level?: ThinkingLevelName;
    timeoutMs?: number;
  };
  /** Context compaction (enabled by default, max_context_length 128k, mode summarize). */
  compaction?: CompactionConfig;
  /** Memory (enabled by default; only reaches the prompt through the template's `{{MEMORY}}` placeholder). */
  memory?: MemoryConfig;
  /** Vault section injection (enabled by default; reaches the prompt through `{{VAULT}}`, or a legacy template's inline `{{VAULT_KEYS}}`). */
  vault?: VaultConfig;
  /** Skills section injection (enabled by default; reaches the prompt through `{{SKILLS}}`, or a legacy template's inline `{{SKILL_METADATA}}`). */
  skills?: SkillsConfig;
  /** Scheduled-tasks section injection (enabled by default; only reaches the prompt through `{{SCHEDULES}}`). */
  schedules?: SchedulesConfig;
  tools?: {
    /** Built-in system tool configuration (per-entry fields incl. the `call_description` toggle live on ToolDefinitionConfig). */
    builtin?: ToolDefinitionConfig[];
    /** MCP Server configuration. */
    mcpServers?: MCPServerConfig[];
  };
}

const DEFAULT_SYSTEM_PROMPT = `# Role
You are PenguinHarness, an agent that completes the user's requests on their machine with the tools available to you.

# Personality
Communicate with the user precisely and concisely, yet with warmth, and always reply in the user's language — code, identifiers and commit messages keep their own conventions. Do not repeatedly explain your tools or restate their results.

# Success criteria
- Before delivering the result, check that every problem in the request has been solved.
- Verify your work through every available means; never claim a result you did not observe.

# Constraints
- Make the smallest change that satisfies the request; do not modify unrelated files.
- Destructive operations are forbidden.
- Never kill a process you did not start, PenguinHarness's own services included, unless the user asks; never take a PenguinHarness service port, and when a port you want is busy, pick another free port.
- If a tool call fails, read the error, adjust, and retry; never repeat the same failing input.

# Stop rules
- Stop and give the final answer once the success criteria are met.
- If the request is ambiguous, stop and ask the user for clarification instead of guessing their intent.
- If you hit an error you cannot resolve, stop and report the blocker to the user. An API auth/key error (401/403, missing or invalid key) is one of them: retry at most once, then stop calling tools and ask the user to update the key in the agent's vault or the model settings outside the chat — the secret must never be pasted into the conversation, and a new key only takes effect in the next conversation.

# Tool use
- Prefer solving problems with your tools: inspect the real files and environment and run real commands instead of answering from memory or guessing.
- For current information on the internet, use \`web_search\` for discovery. Fetch a chosen page with the shell when its content is needed; prefer Playwright when installed for dynamic sites, otherwise \`curl\`.

# System markers
Some messages carry system-synthesized \`[tag]...[/tag]\` blocks — not user text to answer:
- \`[turn_aborted]\`: the previous round was interrupted; inside are the request, your partial output, and the tool calls already run with their results. Continue from there, and do not re-run them.
- \`[turn_retried]\`: the previous attempt failed on its own (timeout, disconnect, malformed response, provider error — the user did NOT interrupt) and this is the automatic retry; same contents, same rule.
- \`[context_summary]\`: earlier conversation was compacted. The summary is its only record — treat it as established context and continue from it.
- \`[user_steering]\`: a user message sent mid-run, delivered between turns. Not a new task: incorporate it immediately and adjust course within the current one.

# File system
- Angle-bracket names such as \`<app_data_dir>\` and \`<session_id>\` are placeholders — substitute the values from the Environment section.
- You work inside the user's folder (\`CWD\`). For each file you create or update there, mention its workspace-relative path in backticks (e.g. \`src/app.py\`) so the user can open it.
- The App Data Dir is PenguinHarness's data root — every agent's files and the project-level data, none of it supplied by the user, so never treat it as task input. \`CWD\` may itself be a temporary Workspace inside it: that one folder is the task's, the rest is not.
- Your Agent State is \`<app_data_dir>/agents/<agent_id>/agent_state/\`; it holds \`skills/\`, and its \`AGENTS.md\` is already in your context. Another agent's is the same path under its id — reach it directly.
- Keep intermediates in this Session's scratchpad, \`<app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/\`, but always place final deliverables in the workspace (under \`CWD\`) — what stays in the scratchpad is not part of your output.
- Install into the project's own environment when it has one. Otherwise keep reusable ones — Python virtualenvs, model and package caches — under \`<app_data_dir>/agents/<agent_id>/shared_env/<name>/\` and reuse them across Sessions. For Node, prefer pnpm in the project itself: its shared store keeps repeated installs from duplicating on disk.
- Never read, copy or print \`.project_config.toml\` or any agent's \`agent_state/.vault.toml\` — they hold the user's secrets. Configuration is CLI-only (\`penguin config ...\`); if a task seems to need them, say so and ask the user instead.

# Suggested workflows
Recommendations, not requirements — adapt them to the task.
- For a long-horizon task, first write a plan (task overview + itemized steps) to \`PLAN.md\` in this Session's scratchpad, and update it as each step lands.
- Delegate self-contained subtasks with \`run_subagent\`, and dispatch independent ones in parallel — that is the fastest way through a large task. Open each prompt with your own agent id (e.g. "Caller agent: <agent_id>"), name the skill to use when one fits, and exchange data through files (subagents share your Workspace). If \`run_subagent\` is not in your tool list, you are the subagent: do the work yourself.
- Prefer React when building a web app or frontend.

[developer_instructions]
Custom instructions from the developer-editable AGENTS.md.

{{AGENTS_MD}}
[/developer_instructions]

{{VAULT}}

{{SKILLS}}

{{MEMORY}}

{{SCHEDULES}}

# Environment
- Platform: {{PLATFORM}}
- OS Version: {{OS_VERSION}}
- Shell: {{SHELL}}
- Date: {{DATE}}
- App Data Dir: {{PROJECT_DIR}}
- Agent ID: {{AGENT_ID}}
- CWD: {{CWD}}
- Provider: {{PROVIDER}}
- Model ID: {{MODEL_ID}}
- Session ID: {{SESSION_ID}}`;

/** Whether a template carries the `{{MEMORY}}` placeholder — without it no Memory is injected. */
export function hasMemoryPlaceholder(template: string): boolean {
  return template.includes(MEMORY_PLACEHOLDER);
}

/**
 * Shared insertion for the section placeholders: before the `# Environment` heading (the
 * position the default template gives them), else appended at the end. Idempotent — a
 * template already carrying the placeholder is returned unchanged.
 */
function insertSectionPlaceholder(template: string, placeholder: string): string {
  if (template.includes(placeholder)) return template;
  const heading = /^#+ Environment[ \t]*$/m.exec(template);
  return heading
    ? `${template.slice(0, heading.index)}${placeholder}\n\n${template.slice(heading.index)}`
    : `${template.trimEnd()}\n\n${placeholder}\n`;
}

/**
 * Inserts the `{{MEMORY}}` placeholder into a template: before the `# Environment` heading
 * (the position the default template gives it), else appended at the end. Idempotent — a
 * template already carrying it is returned unchanged. This is the explicit adoption path for
 * Agents created before Memory shipped (the Web App's Memory tab offers it); nothing ever
 * inserts automatically.
 */
export function insertMemoryPlaceholder(template: string): string {
  return insertSectionPlaceholder(template, MEMORY_PLACEHOLDER);
}

/** Whether a template carries the `{{VAULT}}` placeholder (a legacy inline `{{VAULT_KEYS}}` still injects the key list, but no section prompt). */
export function hasVaultPlaceholder(template: string): boolean {
  return template.includes(VAULT_PLACEHOLDER);
}

/** Whether a template carries the `{{SKILLS}}` placeholder (a legacy inline `{{SKILL_METADATA}}` still injects the metadata lines, but no section prompt). */
export function hasSkillsPlaceholder(template: string): boolean {
  return template.includes(SKILLS_PLACEHOLDER);
}

/** Whether a template carries the `{{SCHEDULES}}` placeholder — without it no Scheduled Tasks section is injected. */
export function hasSchedulesPlaceholder(template: string): boolean {
  return template.includes(SCHEDULES_PLACEHOLDER);
}

/**
 * Inserts the `{{VAULT}}` placeholder into a template, migration-first: a template still
 * carrying the legacy hardcoded # Vault section verbatim gets that text replaced in place by
 * the placeholder (the section's wording lives on as `vault.prompt`'s default, so the
 * assembled prompt is unchanged); otherwise the placeholder is inserted before
 * `# Environment` / appended, like `insertMemoryPlaceholder`. Idempotent, and the explicit
 * adoption path offered by the Web App's Vault tab — nothing ever migrates automatically.
 *
 * Retirement condition: drop the migration branch together with `LEGACY_VAULT_SECTION` once
 * pre-`{{VAULT}}` templates are no longer expected in the wild.
 */
export function insertVaultPlaceholder(template: string): string {
  if (template.includes(VAULT_PLACEHOLDER)) return template;
  if (template.includes(LEGACY_VAULT_SECTION)) {
    return template.split(LEGACY_VAULT_SECTION).join(VAULT_PLACEHOLDER);
  }
  return insertSectionPlaceholder(template, VAULT_PLACEHOLDER);
}

/**
 * Inserts the `{{SKILLS}}` placeholder into a template, migration-first over
 * `LEGACY_SKILLS_SECTION` — same semantics and retirement condition as
 * `insertVaultPlaceholder`.
 */
export function insertSkillsPlaceholder(template: string): string {
  if (template.includes(SKILLS_PLACEHOLDER)) return template;
  if (template.includes(LEGACY_SKILLS_SECTION)) {
    return template.split(LEGACY_SKILLS_SECTION).join(SKILLS_PLACEHOLDER);
  }
  return insertSectionPlaceholder(template, SKILLS_PLACEHOLDER);
}

/**
 * Inserts the `{{SCHEDULES}}` placeholder into a template: before `# Environment`, else
 * appended (no legacy form exists — Schedules never had a hardcoded template section).
 * Idempotent; the explicit adoption path offered by the Web App's Schedules tab.
 */
export function insertSchedulesPlaceholder(template: string): string {
  return insertSectionPlaceholder(template, SCHEDULES_PLACEHOLDER);
}

/**
 * Built-in default compaction Prompt (summarize mode): tells the model the summary will
 * replace the transcript as its only record (so it must include everything needed to
 * continue the task) and that no tools may be called. The format is shown as a concrete
 * example rather than described in prose — some models treat the tags as a "title" and
 * write the body after the closing tag (issue #170); extraction salvages that shape, but
 * generating it right beats repairing it. Persisted per-agent in system_config.yaml —
 * existing agents keep their stored prompt.
 */
export const DEFAULT_COMPACTION_PROMPT =
  "Summarize the task transcript above. The summary will replace the transcript as its " +
  "only record, so include everything needed to continue the task — the original request, " +
  "current state, next steps, and any learnings. Do not call any tools; reply with text " +
  "only, in exactly this format and nothing after it:\n\n" +
  "[summary]put the summary text here...[/summary]";

/**
 * Default built-in system tools: file reading/editing/writing first, then bash execution
 * and subagent spawning.
 * Docs: /docs/tools § "Built-in tools".
 */
function defaultBuiltinTools(): ToolDefinitionConfig[] {
  return [
    {
      name: "read_file",
      description:
        "Read a text file and return its content with line numbers (cat -n style) — the preferred " +
        "way to inspect a file. Returns up to 2000 lines starting at the given offset; for longer " +
        "files call again with offset to continue. Use the image tools for images and the shell " +
        "tool for binary files.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to read; absolute, or relative to the workspace.",
          },
          offset: {
            type: "number",
            description: "1-based line number to start reading from; defaults to 1.",
          },
          limit: {
            type: "number",
            description: "Max lines to read; defaults to 2000.",
          },
        },
        required: ["file_path"],
      },
      permission: "r",
      timeoutMs: 30000,
      // Wider than the other tools' cap: a 2000-line window of code rarely fits in 16k characters.
      maxOutputLength: 64000,
    },
    {
      name: "edit_file",
      description:
        "Edit a file by exact string replacement — the preferred way to make a precise change. " +
        "old_string must match the file content exactly (including whitespace) and be unique " +
        "unless replace_all is set; read the file first to copy the text verbatim. The result " +
        "echoes a line-numbered snippet around the change for verification.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to edit; absolute, or relative to the workspace.",
          },
          old_string: {
            type: "string",
            description: "Exact text to replace, including whitespace/indentation.",
          },
          new_string: {
            type: "string",
            description: "Replacement text; must differ from old_string.",
          },
          replace_all: {
            type: "boolean",
            description: "Replace every occurrence of old_string; defaults to false.",
          },
        },
        required: ["file_path", "old_string", "new_string"],
      },
      permission: "rw",
      timeoutMs: 30000,
      maxOutputLength: 16000,
    },
    {
      name: "write_file",
      description:
        "Create or overwrite a file with the given content, creating parent directories as " +
        "needed. Use it for new files or full rewrites; for precise changes to an existing file " +
        "prefer edit_file.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to write; absolute, or relative to the workspace.",
          },
          content: {
            type: "string",
            description: "Full file content to write; an empty string creates an empty file.",
          },
        },
        required: ["file_path", "content"],
      },
      permission: "rw",
      timeoutMs: 30000,
      maxOutputLength: 16000,
    },
    {
      name: "web_search",
      description:
        "Search the live web through the configured SearXNG service. Returns compact titles, " +
        "URLs, snippets, and publication dates when available. Use it to discover current " +
        "sources; fetch a selected result separately when full page content is needed.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              "Required, and emit it first, before the other arguments: it is shown to the user while the call runs. One short sentence describing what this search is for, written in the user's language.",
          },
          query: {
            type: "string",
            description: "Search query, up to 1000 characters.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return, from 1 to 10; defaults to 5.",
          },
          language: {
            type: "string",
            description: "Optional SearXNG language code such as en, zh, or all.",
          },
          safesearch: {
            type: "number",
            description: "SearXNG safe-search level: 0 off, 1 moderate (default), 2 strict.",
          },
          time_range: {
            type: "string",
            enum: ["day", "month", "year"],
            description: "Optional freshness window.",
          },
        },
        required: ["description", "query"],
      },
      permission: "r",
      call_description: true,
      timeoutMs: 30000,
      maxOutputLength: 16000,
    },
    {
      name: "exec_command",
      description:
        "Run a shell command in the workspace to run programs, search, install dependencies, and " +
        "everything the file tools don't cover. " +
        "Run long-lived commands (servers, watchers, builds) in the foreground: past yield_time_ms " +
        "they keep running in the background with a process_id. Do not background them with `&` — " +
        "the whole process group is cleaned up when the foreground command exits.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              "Required, and emit it first, before the other arguments: it is shown to the user while the call runs. One short sentence describing what this call is doing and why, written in the user's language.",
          },
          cmd: {
            type: "string",
            description: "Shell command to execute.",
          },
          workdir: {
            type: "string",
            description:
              "Working directory for the command; defaults to the cwd. Optionally a path relative to the cwd, or an absolute path.",
          },
          yield_time_ms: {
            type: "number",
            description:
              "How long to wait for the command before yielding. If it is still running when this elapses, the tool returns the output so far plus a process_id, and the command keeps running in the background (drive it with input_command). Defaults to 60000; minimum 250, capped below the tool timeout.",
          },
        },
        required: ["description", "cmd"],
      },
      permission: "rw",
      call_description: true,
      timeoutMs: 120000,
      maxOutputLength: 16000,
    },
    {
      name: "input_command",
      description:
        "Interact with a running command session started by exec_command: write to its stdin, send Ctrl-C, or poll for new output. Identify the session with its process_id.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              "Required, and emit it first, before the other arguments: it is shown to the user while the call runs. One short sentence describing what this call is doing and why, written in the user's language.",
          },
          process_id: {
            type: "string",
            description: "The process_id returned by exec_command for the running command session.",
          },
          chars: {
            type: "string",
            description:
              'Characters to write to the command\'s stdin. Send "\\u0003" alone to deliver Ctrl-C (SIGINT); mixing it with other characters is an error. Empty (the default) writes nothing and only polls for new output and exit status.',
          },
          yield_time_ms: {
            type: "number",
            description:
              "How long to wait for new output or exit before returning. Non-empty writes default to 250; empty polls default to 5000. Minimum 250, capped below the tool timeout.",
          },
        },
        required: ["description", "process_id"],
      },
      permission: "rw",
      call_description: true,
      // An empty poll can wait out a build/test run (the yield ceiling is derived from timeoutMs, clamped inside the tool).
      timeoutMs: 130000,
      maxOutputLength: 16000,
    },
    {
      name: "run_subagent",
      description:
        "Delegate a self-contained subtask to a subagent that runs autonomously in the same workspace and returns its final answer. Use it for focused sub-tasks you can fully specify in one prompt. Optionally choose a specific agent via `agent_id` and a model via `model_id`. " +
        'Begin the prompt by identifying yourself with your own agent id (from the Environment section), e.g. "Caller agent: default_agent" — the subagent cannot otherwise tell who invoked it.',
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              "Required, and emit it first, before the other arguments: it is shown to the user while the call runs. One short sentence describing what this call is doing and why, written in the user's language.",
          },
          prompt: {
            type: "string",
            description:
              "The complete task for the subagent: include all context it needs and the exact final output you expect back.",
          },
          agent_id: {
            type: "string",
            description:
              "Which agent to run as the subagent; defaults to the current agent when omitted.",
          },
          model_id: {
            type: "string",
            description:
              "Which model the subagent should use, as the upstream model id. Must be given together with provider — a model is always referenced by the pair. Omit both to inherit the parent session's model.",
          },
          provider: {
            type: "string",
            description:
              "The provider group that model_id belongs to (see the Environment section's Provider). Required whenever model_id is given.",
          },
          yield_time_ms: {
            type: "number",
            description:
              "How long to wait for the subagent before yielding. If it is still working when this elapses, the tool returns the output so far plus a subagent_id, and the subagent keeps running in the background (drive it with input_subagent). Defaults to 300000; minimum 250, capped below the tool timeout.",
          },
        },
        required: ["description", "prompt"],
      },
      permission: "rw",
      call_description: true,
      // Subagent tasks typically run far longer than a single command, so the timeout ceiling is raised accordingly.
      timeoutMs: 600000,
      maxOutputLength: 16000,
    },
    {
      name: "input_subagent",
      description:
        "Interact with a background subagent started by run_subagent: poll for new output, or send a follow-up prompt once it is idle to continue the same subagent session. Identify the session with its subagent_id. Pending tool approvals of the subagent are surfaced while this tool is waiting.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              "Required, and emit it first, before the other arguments: it is shown to the user while the call runs. One short sentence describing what this call is doing and why, written in the user's language.",
          },
          subagent_id: {
            type: "string",
            description: "The subagent_id returned by run_subagent for the background subagent.",
          },
          prompt: {
            type: "string",
            description:
              "A follow-up task for the subagent, delivered as a new user message on the same session. Only accepted when the subagent is idle (its previous run finished). Empty (the default) sends nothing and only polls for new output and status.",
          },
          yield_time_ms: {
            type: "number",
            description:
              "How long to wait for new output or completion before returning. Follow-up prompts default to 300000; empty polls default to 10000. Minimum 250, capped below the tool timeout.",
          },
        },
        required: ["description", "subagent_id"],
      },
      permission: "rw",
      call_description: true,
      // Same generous timeout tier as run_subagent: an empty poll can wait a long time for the subagent to wrap up.
      timeoutMs: 600000,
      maxOutputLength: 16000,
    },
    // The image-reading tools are mutually exclusive based on the session model's type
    // (marked via each entry's forModel, filtered at assembly time): read_image is designed
    // for vision models (the image is fed back as image content); describe_image is designed
    // for text-only models (the image plus the prompt are sent to the Project's configured
    // vision model, vision_model, whose text answer becomes the tool output).
    {
      name: "read_image",
      forModel: "vision",
      description:
        "Read an image and return it as image content for you to view. Accepts an http(s) URL " +
        "or a local file path (relative paths resolve against the workspace). " +
        "Supports png/jpeg/gif/webp up to 5MB.",
      parameters: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description:
              "Image to read: an http(s) URL, or a local file path (absolute, or relative to the workspace).",
          },
        },
        required: ["source"],
      },
      permission: "r",
      timeoutMs: 60000,
      maxOutputLength: 16000,
    },
    {
      name: "describe_image",
      forModel: "text-only",
      description:
        "Describe an image and return a TEXT description of it. The current model does not accept " +
        "images directly, so the image is analyzed by the project's configured vision model and " +
        "you get its text answer back. Use `prompt` to ask exactly what you need to know about " +
        "the image (e.g. transcribe text, describe a chart, locate a UI element). Accepts an " +
        "http(s) URL or a local file path (relative paths resolve against the workspace). " +
        "Supports png/jpeg/gif/webp up to 5MB.",
      parameters: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description:
              "Image to read: an http(s) URL, or a local file path (absolute, or relative to the workspace).",
          },
          prompt: {
            type: "string",
            description:
              "What to ask about the image; the vision model answers this. Defaults to a detailed description.",
          },
        },
        required: ["source"],
      },
      permission: "r",
      // Includes one vision-model request, so the timeout is slightly wider than plain image reading.
      timeoutMs: 90000,
      maxOutputLength: 16000,
    },
  ];
}

/** Agent State version number: an invalid or missing field is always treated as 1. */
export function agentStateVersion(config: Pick<SystemConfig, "version">): number {
  const v = config.version;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : 1;
}

/** Returns the default system configuration for Agent State. */
export function defaultSystemConfig(): SystemConfig {
  return {
    version: 1,
    // Newly materialized configs are stamped with the current defaults generation; the stamp
    // rides along in resetSystemConfigToDefaults too (it spreads this object), so a restore
    // also re-stamps.
    kernel_version: KERNEL_VERSION,
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    // -1 = unlimited (same sentinel as compaction.max_session_turns): an agent run is never
    // cut off by a turn cap unless the user configures a positive limit themselves.
    max_turns: -1,
    model: {
      max_tokens: 32000,
      thinking_level: "medium",
      timeoutMs: 120000,
    },
    compaction: {
      max_context_length: 128000,
      max_session_turns: -1,
      mode: "summarize",
      prompt: DEFAULT_COMPACTION_PROMPT,
    },
    memory: {
      enabled: true,
      prompt: DEFAULT_MEMORY_PROMPT,
      workspace_prompt: DEFAULT_MEMORY_WORKSPACE_PROMPT,
    },
    vault: {
      enabled: true,
      prompt: DEFAULT_VAULT_PROMPT,
    },
    skills: {
      enabled: true,
      prompt: DEFAULT_SKILLS_PROMPT,
    },
    schedules: {
      enabled: true,
      prompt: DEFAULT_SCHEDULES_PROMPT,
    },
    tools: {
      builtin: defaultBuiltinTools(),
      mcpServers: [],
    },
  };
}

/**
 * Returns the default editable `AGENTS.md` content: an empty string — no guidance is
 * preprovisioned by default; Subagent delegation conventions and general task practices
 * live in the default template's Suggested workflows section as a soft convention.
 * Kept so initialization can still write an empty AGENTS.md file.
 */
export function defaultAgentsMd(): string {
  return "";
}
