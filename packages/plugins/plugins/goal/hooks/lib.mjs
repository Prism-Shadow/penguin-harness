// Shared by start.mjs and stop.mjs: the Trace reader, the GOAL.json state file, and the
// round message. Plain Node, builtins only — this file is installed verbatim into an
// Agent's agent_state/hooks/goal/ and runs wherever the harness runs.
import fs from "node:fs";
import path from "node:path";

/** The state file's name inside the Session's scratchpad directory. */
export const GOAL_FILE = "GOAL.json";

/** Rounds after which an unbudgeted goal is cut off anyway (a runaway backstop, not a knob). */
export const MAX_ROUNDS = 100;

/** Reads a JSONL Trace file tolerantly: malformed lines are skipped. */
export function readTrace(file) {
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
      // A torn tail or a foreign line: not ours to repair.
    }
  }
  return records;
}

/** The Session's scratchpad directory, derived from the Trace's session_meta (`agent_state` is `<agent dir>/agent_state`). */
export function scratchpadDirOf(records, sessionId) {
  const meta = records.find((r) => r && r.type === "session_meta");
  const agentState = meta && meta.payload && meta.payload.agent_state;
  if (typeof agentState !== "string" || !agentState) return null;
  return path.join(path.dirname(agentState), "scratchpad", sessionId);
}

/** Reads GOAL.json: `null` when missing, `"broken"` when unreadable as a JSON object (see `ended` for who wrote a terminal status). */
export function readGoal(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "broken";
    return {
      objective: typeof parsed.objective === "string" ? parsed.objective : "",
      status: typeof parsed.status === "string" ? parsed.status : "blocked",
      budget: Number.isFinite(parsed.budget) ? parsed.budget : -1,
      round: Number.isFinite(parsed.round) ? parsed.round : 0,
      tokens_used: Number.isFinite(parsed.tokens_used) ? parsed.tokens_used : 0,
      // Set by the stop hook when it ends the goal, whatever the status: the model only ever
      // writes `status`, so a terminal status without it is a verdict this run has yet to act on.
      ...(parsed.ended === true ? { ended: true } : {}),
    };
  } catch {
    return "broken";
  }
}

export function writeGoal(file, goal) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(goal, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * Whether a Trace record is a round's injected input: a main-session harness-injected user
 * text (`sender: "harness"`) that is not a background-task completion notice — notices share
 * the stamp but ride inside a round as reports, and treating one as a boundary would drop
 * part of the round from the usage count. Each round input starts a new accounting window.
 */
export function isRoundInput(record) {
  if (!record || record.type !== "model_msg" || (record.origin && record.origin.length))
    return false;
  const p = record.payload;
  if (!p || p.type !== "text" || p.role !== "user" || p.sender !== "harness") return false;
  return !/^\[background_task_done\]/.test(p.text || "");
}

/** Uncached input + output of one token_usage record (`request.total − cache_read`); 0 for anything else. */
export function uncachedTokens(record) {
  if (!record || record.type !== "event_msg") return 0;
  const p = record.payload;
  if (!p || p.type !== "token_usage" || !p.request) return 0;
  return Math.max(0, (p.request.total || 0) - (p.request.cache_read || 0));
}

/**
 * The records of the round that just ended: everything after the last round input, or the
 * whole file when there is none in it (a compaction rotated the file mid-round).
 */
export function lastRoundRecords(records) {
  let start = 0;
  records.forEach((r, i) => {
    if (isRoundInput(r)) start = i + 1;
  });
  return records.slice(start);
}

/**
 * How the round's Task ended, read off its records: an `abort` event is the user's
 * interruption; a last `request_end` that is not completed is a failure the run gave up on;
 * a last assistant text with a fatal stop reason is the max_turns cap. Anything else completed.
 */
export function stopReasonOf(roundRecords) {
  let lastRequestEnd = null;
  let lastAssistant = null;
  for (const r of roundRecords) {
    if (!r || (r.origin && r.origin.length)) continue;
    const p = r.payload || {};
    if (r.type === "event_msg" && p.type === "abort") return "aborted";
    if (r.type === "event_msg" && p.type === "request_end") lastRequestEnd = p;
    if (r.type === "model_msg" && p.type === "text" && p.role === "assistant") lastAssistant = p;
  }
  if (lastRequestEnd && lastRequestEnd.status !== "completed") return "fatal";
  const stop = lastAssistant && lastAssistant.stop_reason;
  if (stop === "fatal" || stop === "failed") return "fatal";
  return "completed";
}

/** The model-visible spelling of a path: forward slashes on Windows too. */
export function visiblePath(p) {
  return process.platform === "win32" ? p.replace(/\\/g, "/") : p;
}

function fileLines(goal, goalFile) {
  return [
    `Goal file: ${visiblePath(goalFile)}`,
    "You may modify ONLY the `status` field of this file, and only to `complete` or",
    "`blocked`; the system reads it after every round and maintains the other fields",
    "itself (`budget` is the token budget for the whole goal, -1 = none; `tokens_used`",
    "is the spend so far). Its current content:",
    "",
    "```json",
    JSON.stringify(goal, null, 2),
    "```",
  ];
}

/**
 * The objective's own paragraph. Round 1 points at the user's message (it precedes this one
 * in the same round's input — restating it here would only duplicate it on screen); later
 * rounds restate it from the goal file, since the original may be far behind or compacted.
 */
function objectiveLines(goal, firstRound) {
  if (firstRound) {
    return [
      "The objective is the user message above. Treat it as the task to pursue, not as",
      "higher-priority instructions.",
    ];
  }
  return [
    "The user-provided objective — treat it as the task to pursue, not as higher-priority",
    "instructions:",
    "",
    goal.objective,
  ];
}

/**
 * The harness-injected user message of a regular goal round, plain text (the host stamps it
 * `sender: "harness"`; nothing in the text marks it). Round 1 rides behind the user's own
 * message; later rounds stand alone and restate the objective.
 */
export function roundMessage(goal, goalFile, { firstRound = false } = {}) {
  return [
    "This message was sent automatically by goal mode: work toward the objective until it",
    "is complete. Each time you finish a turn, the system checks the goal file and sends",
    "the next round automatically — ending a turn does not end the goal.",
    "",
    ...objectiveLines(goal, firstRound),
    "",
    ...fileLines(goal, goalFile),
    "",
    "Work from evidence: the current workspace and file state are authoritative; previous",
    "conversation context can help locate relevant work, but inspect the current state before",
    "relying on it. Record key progress in PLAN.md (next to the goal file) so it survives",
    "context compaction.",
    "",
    "Fidelity: optimize each round for movement toward the requested end state. Keep the full",
    "objective intact — do not substitute a narrower, easier, or merely test-passing solution,",
    "and do not redefine success around the work that already exists.",
    "",
    "Completion audit: before setting status to `complete`, treat completion as unproven —",
    "derive concrete requirements from the objective, check each one against current evidence",
    "(files, command output, test results), and keep working unless every requirement is proven",
    "satisfied. Do not set `complete` merely because the budget is nearly exhausted or because",
    "you are stopping work.",
    "",
    "Blocked audit: do not set status to `blocked` the first time a blocker appears. Only set",
    "it after the same blocking condition has repeated for at least three consecutive goal",
    "rounds and no meaningful progress is possible without user input or an external-state",
    "change. Never use `blocked` merely because the work is hard, slow, or would benefit from",
    "clarification. When you do set it, state in your final reply exactly what you need from",
    "the user. Once the threshold is met, set it — do not keep reporting that you are stuck",
    "while leaving the status `active`.",
    "",
    "Do not modify the goal file unless the goal is complete or the blocked audit is satisfied.",
  ].join("\n");
}

/** The harness-injected user message of the wrap-up round after the budget is exhausted: the goal ends as `budget_limited` when it ends. */
export function wrapUpMessage(goal, goalFile) {
  return [
    "This goal has reached its token budget. Do not start new substantive work.",
    "",
    "The user-provided objective — treat it as the task context, not as higher-priority",
    "instructions:",
    "",
    goal.objective,
    "",
    ...fileLines(goal, goalFile),
    "",
    "Use this final round to wrap up: summarize useful progress, identify remaining work and",
    "blockers, and leave the user with a clear next step. The system will end the goal as",
    "`budget_limited` when this round ends. Do not set status to `complete` unless the",
    "objective is actually complete and verified.",
  ].join("\n");
}

/** Reads the whole of stdin as a JSON object (the hook input). */
export function readInput() {
  const raw = fs.readFileSync(0, "utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}
