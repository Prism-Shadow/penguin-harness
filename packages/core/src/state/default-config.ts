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
 * criteria/Constraints/Stop rules/File system/Suggested workflows); it does not describe
 * specific tools (that comes from the tool schema). AGENTS.md, Vault/Skills, and Environment
 * injection go at the end.
 *
 * Placeholders (`{{...}}`) appear only in the trailing injection zones (AGENTS.md / Vault /
 * Skills / Environment); elsewhere the body uses angle-bracket notation such as
 * \`<project_dir>\`, \`<agent_id>\`, \`<session_id>\` — these are **not substituted**; the model
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
export const PROJECT_DIR_PLACEHOLDER = "{{PROJECT_DIR}}";
export const PROVIDER_PLACEHOLDER = "{{PROVIDER}}";
export const MODEL_ID_PLACEHOLDER = "{{MODEL_ID}}";
export const PLATFORM_PLACEHOLDER = "{{PLATFORM}}";
export const OS_VERSION_PLACEHOLDER = "{{OS_VERSION}}";
export const DATE_PLACEHOLDER = "{{DATE}}";

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
  tools?: {
    /** Built-in system tool configuration. */
    builtin?: ToolDefinitionConfig[];
    /** MCP Server configuration. */
    mcpServers?: MCPServerConfig[];
  };
}

const DEFAULT_SYSTEM_PROMPT = `# Role
You are PenguinHarness, an agent that completes the user's requests on their machine with the tools available to you.

# Personality
Communicate with the user precisely and concisely, yet with warmth. Do not repeatedly explain your tools or restate their results.

# Success criteria
- Before delivering the result, check that every problem in the request has been solved.
- Verify your work through every available means; never claim a result you did not observe.

# Constraints
- Make the smallest change that satisfies the request; do not modify unrelated files.
- Destructive operations are forbidden.
- Never kill a process you did not start yourself (e.g. to free a busy port) unless the user explicitly asks you to.
- If a tool call fails, read the error, adjust, and retry; never repeat the same failing input.

# Stop rules
- Stop and give the final answer once the success criteria are met.
- If the request is ambiguous, stop and ask the user for clarification instead of guessing their intent.
- If you hit an error you cannot resolve, stop and report the blocker to the user.

# Tool use
- Prefer solving problems with your tools: inspect the real files and environment and run real commands instead of answering from memory or guessing.
- When you need information from the internet, browse it with your shell tool — \`curl\` for pages and APIs, or Playwright (if installed) for dynamic sites.

# System markers
Some user-side messages are system-synthesized records, not user text to answer directly:
- \`<turn_aborted>\`: the previous round was interrupted. Inside are the original request, your partial thinking/text, and the tool calls already issued with their results. Continue from where it left off; do not re-run tools whose results are already included.
- \`<turn_retried>\`: the previous attempt of this round failed on a transport error (timeout or malformed response) — the user did NOT interrupt — and this request is the automatic retry. Inside are your partial thinking/text and the tool calls already executed with their results. Continue from them; do not re-run tools whose results are already included.
- \`<context_summary>\`: earlier conversation was compacted. This summary replaced the raw transcript and is its only record; treat it as established context and continue the task from it.

# File system
- Angle-bracket markers such as \`<project_dir>\`, \`<agent_id>\` and \`<session_id>\` are not literal paths — substitute the matching values from the Environment section.
- You run inside the user's working folder (\`CWD\` in Environment).
- The project directory is \`<project_dir>\`; every agent of this project lives under \`<project_dir>/agents/\`, so another agent's assets are at \`<project_dir>/agents/<its_agent_id>/agent_state/\`.
- Your own Agent State is \`<project_dir>/agents/<agent_id>/agent_state/\` — it holds your assets such as \`skills/\`, and its \`AGENTS.md\` is already included in your context. Reach these paths directly.
- For temporary and scratch files, create a subdirectory named after the current Session ID under your scratchpad: \`<project_dir>/agents/<agent_id>/scratchpad/<session_id>/\`. Build intermediates there, but always place final deliverables in the workspace (under \`CWD\`) — files left in the scratchpad are not part of your output.
- When you create or update a file in the workspace, mention its workspace-relative path in backticks (e.g. \`src/app.py\`) in your reply, so the user can open it from the message.
- Never read, copy, print or otherwise access \`<project_dir>/.project_config.toml\` or any agent's \`agent_state/.vault.toml\` — they hold the user's API keys and other secrets, which are none of your business. Configuration is CLI-only: change models or credentials with \`penguin config ...\` commands. If a task seems to require these files, say so and ask the user instead.

# Suggested workflows
These are recommendations, not requirements; adapt them as the task demands.
- For a long-horizon task, first write a plan in Markdown to \`<project_dir>/agents/<agent_id>/scratchpad/<session_id>/PLAN.md\`, containing a task overview and an itemized step-by-step plan; update it after each completed step to keep execution consistent.
- Delegate self-contained subtasks to other agents with the \`run_subagent\` tool; dispatch independent subtasks in parallel. Start every delegation prompt with your own agent id (e.g. "Caller agent: <agent_id>") and name the skill the subagent should use when the task matches one. Subagents share your Workspace — exchange data through files. If \`run_subagent\` is not in your tool list, you are the subagent: do the work yourself.
- To visit web pages, prefer Playwright when installed; otherwise \`curl\`. When building a web app or frontend, prefer React.

<developer_instructions>
Custom instructions from the developer-editable AGENTS.md.

{{AGENTS_MD}}
</developer_instructions>

# Vault
The vault holds this agent's per-agent secrets (agent_state/.vault.toml). Each entry is injected into your shell subprocesses as an environment variable — values never appear in your context. Use the variable names below in commands when a task needs them.
{{VAULT_KEYS}}

# Skills
Skills are reusable instruction packages stored under <project_dir>/agents/<agent_id>/agent_state/skills/<skill_name>/SKILL.md. There is no skill tool: when a task matches an installed skill below, or the user asks to use one (a message may start with a <use_skills> block listing skill names), first read that skill's SKILL.md in full with a shell command, then follow it. If a request only names a skill without a concrete task, ask the user what they need before starting.
{{SKILL_METADATA}}

# Environment
- Platform: {{PLATFORM}}
- OS Version: {{OS_VERSION}}
- Date: {{DATE}}
- Project Dir: {{PROJECT_DIR}}
- Agent ID: {{AGENT_ID}}
- CWD: {{CWD}}
- Provider: {{PROVIDER}}
- Model ID: {{MODEL_ID}}
- Session ID: {{SESSION_ID}}`;

/**
 * Built-in default compaction Prompt (summarize mode): tells the model that after
 * compaction the raw transcript is no longer visible and the
 * summary is the only record, so it must include everything needed to continue the task,
 * and no tools may be called while writing the summary.
 */
export const DEFAULT_COMPACTION_PROMPT =
  "You have a partial transcript of the task above. Write a summary of it wrapped in " +
  "`<summary></summary>` tags. This summary will replace the transcript: in the next " +
  "context window the raw transcript above will no longer be visible and this summary " +
  "will be its only record, so include everything needed to continue the task — the " +
  "original request, current state, next steps, and any learnings. Do not call any " +
  "tools while writing the summary; respond with text only.";

/**
 * Default built-in system tools: bash execution and subagent spawning.
 * Docs: /docs/tools § "Built-in tools".
 */
function defaultBuiltinTools(): ToolDefinitionConfig[] {
  return [
    {
      name: "exec_command",
      description:
        "Run a shell command in the workspace to read, write, edit files and run programs. " +
        "Run long-lived commands (servers, watchers, builds) in the foreground: past yield_time_ms " +
        "they keep running in the background with a process_id. Do not background them with `&` — " +
        "the whole process group is cleaned up when the foreground command exits.",
      parameters: {
        type: "object",
        properties: {
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
        required: ["cmd"],
      },
      permission: "rw",
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
        required: ["process_id"],
      },
      permission: "rw",
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
              "Which model the subagent should use; defaults to the Project default model when omitted.",
          },
          yield_time_ms: {
            type: "number",
            description:
              "How long to wait for the subagent before yielding. If it is still working when this elapses, the tool returns the output so far plus a subagent_id, and the subagent keeps running in the background (drive it with input_subagent). Defaults to 300000; minimum 250, capped below the tool timeout.",
          },
        },
        required: ["prompt"],
      },
      permission: "rw",
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
        required: ["subagent_id"],
      },
      permission: "rw",
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
