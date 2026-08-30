#!/usr/bin/env node
// The skill-summary stop hook: once the current Trace file holds MIN_TURNS completed turns
// since the last summary this hook recorded there, it condenses that window into an excerpt
// and asks the harness to hand it to a background subagent, whose prompt folds the durable
// findings into the agent's own skills.
//
// stdin:  { "hook": "stop", "session_id", "trace_path" }
// stdout: nothing while the window is short, the Agent has no skills, or the Trace is missing;
//         otherwise { "reason", "output": { "turns" }, "subagent": { "prompt" } }
//
// The Trace is the only state: the `hook` event the harness records for this answer marks the
// next window's start, so a restart changes nothing and a compaction (which rotates the Trace
// file) starts a fresh window. Plain Node, builtins only.
import fs from "node:fs";
import path from "node:path";

/** Completed LLM turns (token_usage records) a window must hold before a summary fires. */
const MIN_TURNS = 20;
/** Per-line clips of the excerpt and its total cap (the oldest lines go first). */
const CLIP = { user: 800, assistant: 1200, toolCall: 300, toolOutput: 400 };
const MAX_CHARS = 60_000;

function readTrace(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const records = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A torn tail or a foreign line is skipped.
    }
  }
  return records;
}

const isMain = (r) => r && !(r.origin && r.origin.length);
const isEvent = (r, type) =>
  isMain(r) && r.type === "event_msg" && r.payload && r.payload.type === type;

/** The records after the last summary hook event in the file — the whole file when there is none. */
function summaryWindow(records) {
  let start = 0;
  records.forEach((r, i) => {
    if (isEvent(r, "hook") && r.payload.name === "skill-summary") start = i + 1;
  });
  return records.slice(start);
}

/** Leading `[tag]…[/tag]` blocks (skill invocations, goal rounds, …) stripped off a user text; a `[user_steering]` block yields its body. */
function userBody(text) {
  const steering = /^\[user_steering\]\n([\s\S]*)\n\[\/user_steering\]$/.exec(text.trim());
  if (steering) return steering[1];
  let out = text;
  for (;;) {
    const m = /^\[([a-z_]+)\]\n[\s\S]*?\n\[\/\1\]\n*/.exec(out);
    if (!m) break;
    out = out.slice(m[0].length);
  }
  return out.trim();
}

function clip(text, max) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Condenses main-session records: user and assistant text, tool calls with arguments, tool outputs — each clipped; thinking, images and events left out. */
function condense(records) {
  const lines = [];
  const toolNames = new Map();
  for (const r of records) {
    if (!isMain(r) || r.type !== "model_msg" || !r.payload) continue;
    const p = r.payload;
    if (p.type === "text") {
      if (p.role === "user") {
        const body = userBody(p.text || "");
        if (body) lines.push(`[user] ${clip(body, CLIP.user)}`);
      } else if ((p.text || "").trim()) {
        lines.push(`[assistant] ${clip(p.text, CLIP.assistant)}`);
      }
    } else if (p.type === "tool_call") {
      toolNames.set(p.tool_call_id, p.name);
      lines.push(`[tool_call ${p.name}] ${clip(p.arguments || "", CLIP.toolCall)}`);
    } else if (p.type === "tool_call_output") {
      const name = toolNames.get(p.tool_call_id) || p.tool_call_id;
      const status = p.stop_reason && p.stop_reason !== "completed" ? ` · ${p.stop_reason}` : "";
      lines.push(`[tool_output ${name}${status}] ${clip(p.output || "", CLIP.toolOutput)}`);
    }
  }
  let dropped = 0;
  let total = lines.reduce((n, l) => n + l.length + 1, 0);
  while (total > MAX_CHARS && lines.length > 1) {
    total -= lines.shift().length + 1;
    dropped += 1;
  }
  if (dropped > 0) lines.unshift(`[… ${dropped} earlier lines omitted]`);
  return lines.join("\n");
}

/** Skill names the window's user messages invoked through `[use_skills]` blocks (a goal round's block is skipped first). */
function invokedSkills(records) {
  const names = [];
  for (const r of records) {
    if (!isMain(r) || r.type !== "model_msg" || !r.payload) continue;
    const p = r.payload;
    if (p.type !== "text" || p.role !== "user") continue;
    const text = (p.text || "").replace(/^\[goal\]\n[\s\S]*?\n\[\/goal\]\n*/, "");
    const m = /^\[use_skills\]\nskills: ([^\n]*)\n\[\/use_skills\]/.exec(text);
    if (!m) continue;
    for (const name of m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

function installedSkills(skillsDir) {
  try {
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          fs.existsSync(path.join(skillsDir, e.name, "SKILL.md")),
      )
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

const visiblePath = (p) => (process.platform === "win32" ? p.replace(/\\/g, "/") : p);

const raw = fs.readFileSync(0, "utf8");
const input = raw.trim() ? JSON.parse(raw) : {};
const sessionId = String(input.session_id || "");
const tracePath = typeof input.trace_path === "string" ? input.trace_path : "";
if (!sessionId || !tracePath) process.exit(0);

const records = readTrace(tracePath);
const meta = records.find((r) => r && r.type === "session_meta");
const agentState = meta && meta.payload && meta.payload.agent_state;
if (typeof agentState !== "string" || !agentState) process.exit(0);
const skillsDir = path.join(agentState, "skills");
const skills = installedSkills(skillsDir);
if (skills.length === 0) process.exit(0);

const window = summaryWindow(records);
const turns = window.filter((r) => isEvent(r, "token_usage")).length;
if (turns < MIN_TURNS) process.exit(0);

const invoked = invokedSkills(window);
const agentId = path.basename(path.dirname(agentState));
const prompt = [
  `Automated session review (skill-summary hook). The transcript excerpt below covers the last ${turns} turns of session ${sessionId}, run by agent ${agentId}. Extract the durable findings and fold them into this agent's skills, then reply with one paragraph on what you changed — or that nothing was worth recording.`,
  "",
  `Skills directory: ${visiblePath(skillsDir)}`,
  `Installed skills: ${skills.join(", ")}`,
  `Skills invoked in this window: ${invoked.length > 0 ? invoked.join(", ") : "none"}`,
  "",
  "A finding is something a future session of this agent would want to know before it starts: a correction the user made, a gotcha in the environment or the codebase, a command or approach that worked or failed, a convention the user expects. Not a finding: session-specific trivia, secrets or credentials, and anything the skill already says.",
  "",
  "For each finding, edit the SKILL.md of the skill it belongs to — one of the invoked skills when it fits, otherwise the most relevant installed skill. Keep the guidance short and general, and bump `version` in that file's frontmatter to today's date with the next sequence number (`YYYY-MM-DD.N`). Do not create new skills and do not touch anything outside the skills directory. If nothing durable was learned, change nothing.",
  "",
  "Transcript excerpt:",
  "",
  condense(window),
].join("\n");

process.stdout.write(
  `${JSON.stringify({
    reason: `session review delegated to a subagent (${turns} turns since the last one)`,
    output: { turns },
    subagent: { prompt },
  })}\n`,
);
