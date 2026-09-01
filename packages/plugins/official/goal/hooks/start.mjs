#!/usr/bin/env node
// Starts a goal: writes the Session's GOAL.json and prints the round-1 protocol message.
//
// stdin:  { "session_id", "scratchpad_dir", "objective", "budget" }
//         objective = the user's text with leading marker blocks stripped (what later rounds
//         restate and the file records); budget = tokens for the whole goal, -1 or absent =
//         none.
// stdout: { "input": "<round-1 protocol message>" } — the host sends it right AFTER the
//         user's own message (and any images), stamped `sender: "harness"`; the protocol
//         text points back at that message as the objective.
//
// The host runs this when a user starts a goal (the harness server does so for the `goal`
// field of POST /tasks); the stop hook (stop.mjs) drives every later round.
import path from "node:path";
import { GOAL_FILE, readInput, roundMessage, writeGoal } from "./lib.mjs";

const input = readInput();
const scratchpadDir = String(input.scratchpad_dir || "");
const objective = String(input.objective || "").trim();
if (!scratchpadDir || !objective) {
  process.stderr.write("start.mjs: scratchpad_dir and a non-empty objective are required\n");
  process.exit(1);
}
const budget = Number.isFinite(input.budget) && input.budget > 0 ? Math.round(input.budget) : -1;
const goalFile = path.join(scratchpadDir, GOAL_FILE);
const goal = { objective, status: "active", budget, round: 1, tokens_used: 0 };
writeGoal(goalFile, goal);
process.stdout.write(
  `${JSON.stringify({ input: roundMessage(goal, goalFile, { firstRound: true }) })}\n`,
);
