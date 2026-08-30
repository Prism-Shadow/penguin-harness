#!/usr/bin/env node
// Goal mode's stop hook: consulted after every Task of a run. Reads the Session's Trace to
// find its GOAL.json and this round's token usage, then either injects the next `[goal]`
// round or ends the goal.
//
// stdin:  { "hook": "stop", "session_id", "trace_path" }
// stdout: nothing when no goal is live on this Session; otherwise
//         { "decision": "continue", "input": "<next round>", "reason", "output": {…} } or
//         { "decision": "stop", "reason", "output": { status, round, tokens_used, budget } }
//
// The decision, first match wins: the file says complete / blocked → that outcome; the Task
// was cut off (abort, a failure the run gave up on, the max_turns cap — the model never got
// to write the file) → aborted; the wrap-up round just ran → budget_limited; the round cap →
// aborted; the budget is reached → one wrap-up round; otherwise → the next round. Every
// ending is written back with `ended: true` — the model only ever writes `status`, so that
// flag is what tells a goal this run just ended from one that ended on an earlier run (the
// hook stays silent for those). A file that no longer parses ends the goal as blocked and is
// moved aside as GOAL.json.broken.
import fs from "node:fs";
import path from "node:path";
import {
  GOAL_FILE,
  MAX_ROUNDS,
  lastRoundRecords,
  readGoal,
  readInput,
  readTrace,
  roundMessage,
  scratchpadDirOf,
  stopReasonOf,
  uncachedTokens,
  wrapUpMessage,
  writeGoal,
} from "./lib.mjs";

const input = readInput();
const sessionId = String(input.session_id || "");
const tracePath = typeof input.trace_path === "string" ? input.trace_path : "";
if (!sessionId || !tracePath) process.exit(0);

const records = readTrace(tracePath);
const scratchpad = scratchpadDirOf(records, sessionId);
if (!scratchpad) process.exit(0);
const goalFile = path.join(scratchpad, GOAL_FILE);
const goal = readGoal(goalFile);
if (goal === null) process.exit(0);

const emit = (result) => process.stdout.write(`${JSON.stringify(result)}\n`);
const record = (g) => ({
  status: g.status,
  round: g.round,
  tokens_used: g.tokens_used,
  budget: g.budget,
});
const tokens = (g) => `tokens ${g.tokens_used}${g.budget > 0 ? ` / ${g.budget}` : ""}`;
const stop = (g, outcome, write) => {
  g.status = outcome;
  g.ended = true;
  if (write) writeGoal(goalFile, g);
  emit({
    decision: "stop",
    reason: `${outcome} · ${g.round} round${g.round === 1 ? "" : "s"} · ${tokens(g)}`,
    output: record(g),
  });
};

if (goal === "broken") {
  fs.renameSync(goalFile, `${goalFile}.broken`);
  stop(
    { objective: "", status: "blocked", budget: -1, round: 0, tokens_used: 0 },
    "blocked",
    false,
  );
  process.exit(0);
}
// A goal that already ended on this Session (an earlier run) is not this run's business.
if (goal.ended) process.exit(0);

const round = lastRoundRecords(records);
goal.tokens_used += round.reduce((n, r) => n + uncachedTokens(r), 0);

if (goal.status === "complete" || goal.status === "blocked") {
  stop(goal, goal.status, true);
} else if (goal.status !== "active" && goal.status !== "wrapping_up") {
  // Anything else in `status` is outside the protocol the model was given: a broken channel.
  stop(goal, "blocked", true);
} else if (stopReasonOf(round) !== "completed") {
  stop(goal, "aborted", true);
} else if (goal.status === "wrapping_up") {
  stop(goal, "budget_limited", true);
} else if (goal.round >= MAX_ROUNDS) {
  stop(goal, "aborted", true);
} else {
  goal.round += 1;
  const wrapUp = goal.budget > 0 && goal.tokens_used >= goal.budget;
  goal.status = wrapUp ? "wrapping_up" : "active";
  writeGoal(goalFile, goal);
  const compose = wrapUp ? wrapUpMessage : roundMessage;
  emit({
    decision: "continue",
    input: compose(goal, goalFile, goal.objective),
    reason: `round ${goal.round}${wrapUp ? " (wrap-up: budget reached)" : ""} · ${tokens(goal)}`,
    output: record(goal),
  });
}
