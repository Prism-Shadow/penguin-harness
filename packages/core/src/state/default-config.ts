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
 * does not describe specific tools (that comes from the tool schema). AGENTS.md, Vault/Skills,
 * and Environment injection go at the end.
 *
 * Placeholders (`{{...}}`) appear only in the trailing injection zones (AGENTS.md / Vault /
 * Skills / Environment); elsewhere the body uses angle-bracket notation such as
 * \`<app_data_dir>\`, \`<agent_id>\`, \`<session_id>\` — these are **not substituted**; the model
 * fills in the actual values from the Environment section itself.
 */
import type { MCPServerConfig, ThinkingLevelName, ToolDefinitionConfig } from "../interfaces.js";
import type { CompactionMode } from "../omnimessage/types.js";

/** Docs: /docs/configuration § "System prompt placeholders". */
export const AGENTS_MD_PLACEHOLDER = "{{AGENTS_MD}}";
export const VAULT_KEYS_PLACEHOLDER = "{{VAULT_KEYS}}";
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
 * Inside the template's Environment section (`- Workspace Memory Key: …`): the current
 * Workspace's Memory directory name — the workspace memory key, `memory/`'s subdirectory — or
 * a self-describing `(none — …)` value in a temporary Workspace / with Memory off. The Memory
 * prompts reference it as the final segment of the composed pattern
 * `<app_data_dir>/agents/<agent_id>/agent_state/memory/<workspace_memory_key>`, mirroring the
 * User section's literal `…/memory/user` line — only the per-Session segment is a value, and
 * values live in Environment, next to CWD.
 */
export const WORKSPACE_MEMORY_KEY_PLACEHOLDER = "{{WORKSPACE_MEMORY_KEY}}";
/** Inside `memory.workspace_prompt` only: the content of the current Workspace scope's `MEMORY.md` index (capped, see MEMORY_INDEX_MAX_LINES / MEMORY_INDEX_MAX_CHARS). */
export const MEMORY_INDEX_PLACEHOLDER = "{{MEMORY_INDEX}}";
/** Inside either Memory prompt: the content of the User scope's `MEMORY.md` index (capped, see MEMORY_INDEX_MAX_LINES / MEMORY_INDEX_MAX_CHARS). */
export const MEMORY_USER_INDEX_PLACEHOLDER = "{{MEMORY_USER_INDEX}}";

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
   * and the User scope with its index — carrying the `{{MEMORY_USER_INDEX}}` injection point
   * (directories are literal text, not placeholders). Defaults to the built-in value.
   */
  prompt?: string;
  /**
   * Appended to `prompt` only when the Session runs in a persistent Workspace: the Workspace
   * scope, its index and the rule for choosing between the two — carrying `{{MEMORY_INDEX}}`,
   * with the directory pattern's per-Session segment read from the Environment section's
   * `Workspace Memory Key` line. A separate key rather than a conditional inside `prompt`
   * because substitution has no conditionals — a temporary Workspace would otherwise be told
   * about a scope it does not have.
   */
  workspace_prompt?: string;
}

/** Stands in for an index placeholder when the `MEMORY.md` does not exist yet or is blank — the model is told the store is empty rather than being handed nothing. */
export const MEMORY_INDEX_EMPTY_NOTE = "(the index is empty — nothing has been saved yet)";

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
 * per-Agent in `system_config.yaml` and editable on the Web App's Memory tab. Directories are
 * literal text in the template's angle-bracket convention (resolved from the Environment
 * section by the model, like the Skills paths) — the only injection point is the index itself.
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

Directory: <app_data_dir>/agents/<agent_id>/agent_state/memory/user

Index:
{{MEMORY_USER_INDEX}}`;

/**
 * Built-in default for the Workspace half of the `{{MEMORY}}` block, appended to
 * `memory.prompt` only when the Session runs in a persistent Workspace. The rule for choosing
 * between the two scopes lives here on purpose: a Session in a temporary Workspace has one
 * scope and no choice to make, so it never sees the rule at all. The Directory line mirrors
 * the User section's pattern; its one per-Session segment, `<workspace_memory_key>`, is the
 * Environment section's `Workspace Memory Key` value.
 */
export const DEFAULT_MEMORY_WORKSPACE_PROMPT = `## Workspace memory
Facts about the workspace you are working in now. What would still hold in a different project goes in user memory; when unsure, write here.

Directory: <app_data_dir>/agents/<agent_id>/agent_state/memory/<workspace_memory_key>

Index:
{{MEMORY_INDEX}}`;

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
  /** System-level Prompt (relatively stable; should not be modified frequently). */
  system_prompt: string;
  /** Max LLM turns per Task (a runtime parameter that belongs to Agent config, not specified when creating a Session). */
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
- For anything on the internet, browse with your shell tool: prefer Playwright when it is installed — it handles dynamic sites — otherwise \`curl\` for pages and APIs.

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

# Vault
The vault holds this agent's per-agent secrets (agent_state/.vault.toml). Each entry is injected into your shell subprocesses as an environment variable — values never appear in your context. Use the variable names below in commands when a task needs them.
{{VAULT_KEYS}}

# Skills
Skills are reusable instruction packages at <app_data_dir>/agents/<agent_id>/agent_state/skills/<skill_name>/SKILL.md. When a task matches one below, or the user asks for one (the message may start with a [use_skills] block naming them), read that SKILL.md in full with read_file, then follow it. If a request names a skill without a concrete task, ask the user what they need first.
{{SKILL_METADATA}}

{{MEMORY}}

# Environment
- Platform: {{PLATFORM}}
- OS Version: {{OS_VERSION}}
- Shell: {{SHELL}}
- Date: {{DATE}}
- App Data Dir: {{PROJECT_DIR}}
- Agent ID: {{AGENT_ID}}
- CWD: {{CWD}}
- Workspace Memory Key: {{WORKSPACE_MEMORY_KEY}}
- Provider: {{PROVIDER}}
- Model ID: {{MODEL_ID}}
- Session ID: {{SESSION_ID}}`;

/**
 * Whether a template carries both Memory placeholders: `{{MEMORY}}` (the block itself) and
 * `{{WORKSPACE_MEMORY_KEY}}` (the Environment line the block's Workspace half points at).
 * Whatever is missing is simply not injected.
 */
export function hasMemoryPlaceholder(template: string): boolean {
  return (
    template.includes(MEMORY_PLACEHOLDER) && template.includes(WORKSPACE_MEMORY_KEY_PLACEHOLDER)
  );
}

/**
 * Inserts the missing Memory placeholders into a template: `{{MEMORY}}` before the
 * `# Environment` heading (the position the default template gives it), else appended at the
 * end; the `- Workspace Memory Key: {{WORKSPACE_MEMORY_KEY}}` line right after that heading
 * (any level), else appended. Idempotent — whatever is already present stays where it is. This
 * is the explicit adoption path for Agents created before Memory shipped (the Web App's Memory
 * tab offers it); nothing ever inserts automatically.
 */
export function insertMemoryPlaceholder(template: string): string {
  let next = template;
  if (!next.includes(MEMORY_PLACEHOLDER)) {
    const heading = /^#+ Environment[ \t]*$/m.exec(next);
    next = heading
      ? `${next.slice(0, heading.index)}${MEMORY_PLACEHOLDER}\n\n${next.slice(heading.index)}`
      : `${next.trimEnd()}\n\n${MEMORY_PLACEHOLDER}\n`;
  }
  if (!next.includes(WORKSPACE_MEMORY_KEY_PLACEHOLDER)) {
    const line = `- Workspace Memory Key: ${WORKSPACE_MEMORY_KEY_PLACEHOLDER}`;
    const heading = /^#+ Environment[ \t]*$/m.exec(next);
    if (heading) {
      const at = heading.index + heading[0].length;
      next = `${next.slice(0, at)}\n${line}${next.slice(at)}`;
    } else {
      next = `${next.trimEnd()}\n${line}\n`;
    }
  }
  return next;
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
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    max_turns: 100,
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
