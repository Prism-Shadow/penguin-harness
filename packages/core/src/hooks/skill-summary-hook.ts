/**
 * The skill-summary hook: a stop hook that turns a long session's findings into skill
 * edits. After every Task, once the Session has run at least `minTurns` LLM turns, it reads
 * the current Trace file, takes the records after the last summary it recorded there (or
 * the whole file), and — when that window holds `minTurns` completed turns — hands a
 * condensed excerpt of it to a background child Session of the same Agent, whose prompt
 * asks it to fold the durable findings into the Agent's own SKILL.md files.
 *
 * The Trace is the only state: the `hook` event this hook records is the next window's
 * start, so a restart changes nothing and a compaction (which rotates the Trace file)
 * simply starts a fresh window. The child is spawned straight through the SubagentRunner
 * — it takes no `run_subagent` background slot, shows in no subagents panel, reports no
 * completion notice — and runs detached: its own Trace is the record of what it changed.
 * It inherits the parent Session's model, thinking level and this run's approval callback.
 *
 * Only top-level Sessions carry this hook (the composition layer registers it), and an
 * Agent with no installed skill never fires it.
 * Docs: /docs/agent-loop § "Hooks".
 */
import { isEventMessage, isModelMessage, userText } from "../omnimessage/index.js";
import type { OmniMessage, ToolCallOutputPayload, ToolCallPayload } from "../omnimessage/index.js";
import {
  parseGoalMessage,
  parseSkillsMessage,
  parseUserSteeringText,
  stripConversationMarkers,
} from "../omnimessage/markers/index.js";
import type { ApproveFn, SubagentHandle, SubagentRunner } from "../interfaces/index.js";
import { modelVisiblePath } from "../internal/model-visible-path.js";
import { listInstalledSkills } from "../state/agent-state.js";
import { skillsDir } from "../state/paths.js";
import { readTraceTolerant } from "../trace/resume.js";
import type { StopHook, StopHookInput, StopHookResult } from "./stop-hook.js";

/** The hook's name: what its `hook` events carry as `name`, and what marks a window's start in the Trace. */
export const SKILL_SUMMARY_HOOK_NAME = "skill_summary";

export interface SkillSummaryHookOptions {
  root: string;
  projectId: string;
  agentId: string;
  sessionId: string;
  /** Completed LLM turns a window must hold before a summary fires. */
  minTurns: number;
  /** Spawns the child Session (the same Agent, inheriting the parent Session's model and thinking level). */
  runner: SubagentRunner;
  /** Seam for tests: reads the Trace file (defaults to the tolerant Trace reader). */
  readTrace?: (path: string) => Promise<OmniMessage[]>;
  /** Seam for tests: the installed skill names (defaults to scanning the Agent's skills directory). */
  listSkills?: () => Promise<string[]>;
}

export function createSkillSummaryHook(opts: SkillSummaryHookOptions): StopHook {
  const readTrace = opts.readTrace ?? readTraceTolerant;
  const listSkills =
    opts.listSkills ??
    (async () =>
      (await listInstalledSkills(opts.root, opts.projectId, opts.agentId)).map((s) => s.name));
  const dir = skillsDir(opts.root, opts.projectId, opts.agentId);

  const run = async (input: StopHookInput): Promise<StopHookResult | void> => {
    // The cheap gate first: a session shorter than one window never reads its Trace.
    if (input.turns < opts.minTurns || !input.tracePath) return;
    const skills = await listSkills();
    if (skills.length === 0) return;
    const window = summaryWindow(await readTrace(input.tracePath));
    const turns = window.filter(
      (m) => isEventMessage(m) && m.payload.type === "token_usage" && !m.origin?.length,
    ).length;
    if (turns < opts.minTurns) return;
    const prompt = buildSkillSummaryPrompt({
      sessionId: opts.sessionId,
      agentId: opts.agentId,
      skillsDir: dir,
      installed: skills,
      invoked: invokedSkills(window),
      turns,
      excerpt: condenseTrace(window),
    });
    const handle = await opts.runner.spawn({});
    runDetached(handle, [userText(prompt, "harness")], input.approve);
    return {
      reason: `session review delegated to subagent ${handle.sessionId} (${turns} turns since the last one)`,
      output: { session_id: handle.sessionId, turns },
    };
  };
  return { name: SKILL_SUMMARY_HOOK_NAME, run };
}

/** The records after the last skill-summary hook event in the file — the whole file when there is none. */
export function summaryWindow(records: OmniMessage[]): OmniMessage[] {
  let start = 0;
  records.forEach((m, i) => {
    if (
      isEventMessage(m) &&
      m.payload.type === "hook" &&
      m.payload.name === SKILL_SUMMARY_HOOK_NAME
    ) {
      start = i + 1;
    }
  });
  return records.slice(start);
}

/** Skill names the window's user messages invoked through `[use_skills]` blocks (a goal round's block is skipped first), deduplicated in order. */
export function invokedSkills(records: OmniMessage[]): string[] {
  const names: string[] = [];
  for (const m of records) {
    const text = mainUserText(m);
    if (text === null) continue;
    const body = parseGoalMessage(text)?.rest ?? text;
    for (const name of parseSkillsMessage(body)?.skills ?? []) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** Per-line clips of the excerpt: enough to recognize what happened, never a full dump. */
const CLIP = { user: 800, assistant: 1200, toolCall: 300, toolOutput: 400 } as const;

/** Total cap on the excerpt; the oldest lines go first when it is exceeded. */
export const EXCERPT_MAX_CHARS = 60_000;

/**
 * Condenses main-session records into a plain transcript excerpt: user text (marker blocks
 * stripped, a steering message's body), assistant text, tool calls with their arguments,
 * and tool outputs — each clipped — with thinking, images and events left out.
 */
export function condenseTrace(records: OmniMessage[], maxChars = EXCERPT_MAX_CHARS): string {
  const lines: string[] = [];
  const toolNames = new Map<string, string>();
  for (const m of records) {
    if (m.origin && m.origin.length > 0) continue;
    if (!isModelMessage(m)) continue;
    const p = m.payload;
    if (p.type === "text") {
      if (p.role === "user") {
        const body = parseUserSteeringText(p.text) ?? stripConversationMarkers(p.text);
        if (body) lines.push(`[user] ${clip(body, CLIP.user)}`);
      } else if (p.text.trim()) {
        lines.push(`[assistant] ${clip(p.text, CLIP.assistant)}`);
      }
    } else if (p.type === "tool_call") {
      const call = p as ToolCallPayload;
      toolNames.set(call.tool_call_id, call.name);
      lines.push(`[tool_call ${call.name}] ${clip(call.arguments, CLIP.toolCall)}`);
    } else if (p.type === "tool_call_output") {
      const out = p as ToolCallOutputPayload;
      const name = toolNames.get(out.tool_call_id) ?? out.tool_call_id;
      const status =
        out.stop_reason && out.stop_reason !== "completed" ? ` · ${out.stop_reason}` : "";
      lines.push(`[tool_output ${name}${status}] ${clip(out.output, CLIP.toolOutput)}`);
    }
  }
  let dropped = 0;
  let total = lines.reduce((n, l) => n + l.length + 1, 0);
  while (total > maxChars && lines.length > 1) {
    total -= lines.shift()!.length + 1;
    dropped += 1;
  }
  if (dropped > 0) lines.unshift(`[… ${dropped} earlier lines omitted]`);
  return lines.join("\n");
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function mainUserText(m: OmniMessage): string | null {
  if (m.origin && m.origin.length > 0) return null;
  if (!isModelMessage(m) || m.payload.type !== "text" || m.payload.role !== "user") return null;
  return m.payload.text;
}

/** The child Session's prompt: what the excerpt is, where the skills live, and how to record a finding. */
export function buildSkillSummaryPrompt(args: {
  sessionId: string;
  agentId: string;
  skillsDir: string;
  installed: string[];
  invoked: string[];
  turns: number;
  excerpt: string;
}): string {
  return [
    `Automated session review (skill_summary hook). The transcript excerpt below covers the last ${args.turns} turns of session ${args.sessionId}, run by agent ${args.agentId}. Extract the durable findings and fold them into this agent's skills, then reply with one paragraph on what you changed — or that nothing was worth recording.`,
    "",
    `Skills directory: ${modelVisiblePath(args.skillsDir)}`,
    `Installed skills: ${args.installed.join(", ")}`,
    `Skills invoked in this window: ${args.invoked.length > 0 ? args.invoked.join(", ") : "none"}`,
    "",
    "A finding is something a future session of this agent would want to know before it starts: a correction the user made, a gotcha in the environment or the codebase, a command or approach that worked or failed, a convention the user expects. Not a finding: session-specific trivia, secrets or credentials, and anything the skill already says.",
    "",
    "For each finding, edit the SKILL.md of the skill it belongs to — one of the invoked skills when it fits, otherwise the most relevant installed skill. Keep the guidance short and general, bump `version` and set `updated` (ISO 8601 UTC) in that file's frontmatter. Do not create new skills and do not touch anything outside the skills directory. If nothing durable was learned, change nothing.",
    "",
    "Transcript excerpt:",
    "",
    args.excerpt,
  ].join("\n");
}

/** Drives the child to completion in the background, dropping its stream (its own Trace is the record), and releases it. */
function runDetached(handle: SubagentHandle, messages: OmniMessage[], approve?: ApproveFn): void {
  void (async () => {
    try {
      const it = handle.run({ messages, ...(approve ? { approve } : {}) });
      for (;;) {
        const res = await it.next();
        if (res.done) break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[skill_summary] subagent ${handle.sessionId} failed: ${message}\n`);
    } finally {
      handle.dispose();
    }
  })();
}
