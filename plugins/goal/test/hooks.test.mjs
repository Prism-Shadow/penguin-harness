// Goal mode's hooks, measured the way the harness runs them: as Node subprocesses with JSON on
// stdin, against the scenarios in `fixtures/`.
//
// The assertions state what the plugin promises about itself, not what it happens to do:
// `plugin.json` — "a stop hook that keeps the session working toward an objective — re-injecting
// it every round and checking the goal file — until the goal is complete, blocked, or out of
// token budget" — and `packages/docs/content/goal-mode.en.md` § "How a goal runs", whose seven
// cases these scripts implement, in that order. (`plugins/goal` ships no README.md; those two,
// plus the scripts' own header comments, are its description of itself.) A round of an open goal
// is re-injected; a goal ends on completion, on a block, and on an exhausted budget — the three
// endings the manifest names — with the cut-off, round-cap and broken-file endings documented
// beside them.
//
// Plain Node, builtins only: no install, no dependency. `plugins/goal/package.json` stays a
// published manifest with no `scripts` and no devDependencies, so this file is run directly.
// Node 18 accepts the directory; from Node 22 on a bare directory argument is run as a file, so
// the argument has to be a pattern that expands to this file:
//
//     node --test plugins/goal/test/
//     node --test 'plugins/goal/test/**/*.test.mjs'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const hooksDir = path.resolve(here, "../hooks");
const fixturesDir = path.join(here, "fixtures");

/** The session the fixtures are written for. */
const SESSION = "s1";

let root;
let agentState;
let scratchpad;
let tracePath;
let goalFile;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-goal-plugin-"));
  agentState = path.join(root, "agents", "a1", "agent_state");
  scratchpad = path.join(root, "agents", "a1", "scratchpad", SESSION);
  tracePath = path.join(root, "agents", "a1", "traces", "2026-09-25", `${SESSION}_001.jsonl`);
  goalFile = path.join(scratchpad, "GOAL.json");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Runs one hook script the way the host does: JSON in on stdin, its answer parsed off stdout. */
function run(script, input) {
  const res = spawnSync(process.execPath, [path.join(hooksDir, script)], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  const text = (res.stdout ?? "").trim();
  return { out: text ? JSON.parse(text) : undefined, status: res.status, stderr: res.stderr };
}

/** `start.mjs` — the `user_prompt` hook that opens a goal. */
const startGoal = (prompt, budget = -1) =>
  run("start.mjs", {
    hook: "user_prompt",
    session_id: SESSION,
    scratchpad_dir: scratchpad,
    prompt,
    budget,
  });

/** `stop.mjs` — the stop hook the harness consults after every round. */
const stopGoal = () =>
  run("stop.mjs", { hook: "stop", session_id: SESSION, trace_path: tracePath });

const fileExists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

/** GOAL.json as it stands, or `null` when there is none (the hook moves a broken one aside). */
async function readGoal() {
  if (!(await fileExists(goalFile))) return null;
  return JSON.parse(await fs.readFile(goalFile, "utf8"));
}

/** Replaces the fixture tokens (`$AGENT_STATE`, `$SESSION`, `$ROUND_INPUT`, `$INJECTED`) in every string of a record tree. */
function substitute(value, tokens) {
  if (typeof value === "string") {
    let out = value;
    for (const [token, text] of Object.entries(tokens)) out = out.split(token).join(text);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, tokens));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, tokens)]),
    );
  }
  return value;
}

const writeTrace = (records) =>
  fs.writeFile(tracePath, records.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf8");

const loadFixture = async (name) =>
  JSON.parse(await fs.readFile(path.join(fixturesDir, `${name}.json`), "utf8"));

/**
 * Plays one fixture — opens the goal when it starts one, applies the model's own edit when it has
 * one, then feeds every step's records to the stop hook in order — and answers one entry per
 * step: the hook's parsed answer and GOAL.json as it stands right after that step. `$ROUND_INPUT`
 * is the round-1 protocol message the start hook actually printed and `$INJECTED` the previous
 * step's `input`, so a multi-step fixture is one continuous session.
 */
async function play(fixture) {
  await fs.mkdir(path.dirname(tracePath), { recursive: true });
  let roundInput = "";
  if (fixture.start) {
    const started = startGoal(fixture.start.objective, fixture.start.budget);
    assert.equal(started.status, 0, `start.mjs failed: ${started.stderr}`);
    assert.equal(typeof started.out.context, "string");
    roundInput = started.out.context;
  }
  if (fixture.goal !== undefined) {
    // The model may only touch `status`, so a fixture patches the fields it changes onto the file
    // the hook wrote; a string replaces the file verbatim — the broken-file case.
    const file =
      typeof fixture.goal === "string"
        ? fixture.goal
        : `${JSON.stringify({ ...(await readGoal()), ...fixture.goal }, null, 2)}\n`;
    await fs.writeFile(goalFile, file, "utf8");
  }
  const steps = [];
  let injected = "";
  for (const step of fixture.steps) {
    await writeTrace(
      substitute(step.records, {
        $AGENT_STATE: agentState,
        $SESSION: SESSION,
        $ROUND_INPUT: roundInput,
        $INJECTED: injected,
      }),
    );
    const stopped = stopGoal();
    assert.equal(stopped.status, 0, `stop.mjs failed: ${stopped.stderr}`);
    steps.push({ out: stopped.out, goal: await readGoal() });
    injected = stopped.out?.input ?? "";
  }
  return steps;
}

describe("start.mjs (the user_prompt hook)", () => {
  it("writes the goal file and prints round 1 as the prompt's expansion context", async () => {
    const { out, status } = startGoal("make all tests pass", 500);
    assert.equal(status, 0);
    assert.deepEqual(await readGoal(), {
      objective: "make all tests pass",
      status: "active",
      budget: 500,
      round: 1,
      tokens_used: 0,
    });
    const context = out.context;
    // Plain text, no marker block: the host stamps it `sender: "harness"` and sends it right
    // behind the user's own message.
    assert.ok(!context.startsWith("["));
    assert.match(context, /sent automatically by goal mode/);
    // Round 1 points back at the user's message instead of restating the objective.
    assert.match(context, /The objective is the user message above/);
    assert.ok(!context.includes("The user-provided objective"));
    // It embeds the file it just wrote, so the model sees exactly what it is asked to edit.
    assert.ok(context.includes(`Goal file: ${goalFile}`));
    assert.ok(context.includes('"round": 1'));
    assert.ok(context.includes('"budget": 500'));
    assert.ok(context.includes('"tokens_used": 0'));
  });

  it("refuses an empty objective and reads a non-positive budget as none", async () => {
    const refused = startGoal("   ");
    assert.notEqual(refused.status, 0);
    assert.equal(await fileExists(goalFile), false, "no goal file for a refused objective");
    startGoal("make all tests pass", 0);
    assert.deepEqual(await readGoal(), {
      objective: "make all tests pass",
      status: "active",
      budget: -1,
      round: 1,
      tokens_used: 0,
    });
  });
});

describe("stop.mjs — the manifest's promise: re-inject while open, stop on an ending", () => {
  it("stays silent when the Session has no goal at all", async () => {
    const [{ out }] = await play(await loadFixture("no-goal"));
    assert.equal(out, undefined);
  });

  it("re-injects the objective as the next round while the goal is open", async () => {
    const [{ out, goal }] = await play(await loadFixture("open-goal"));
    assert.equal(out.decision, "continue");
    // 60 = the round's uncached input and output (100 − 40). The 999 tokens recorded before the
    // round's harness input are outside the accounting window and stay uncounted.
    assert.deepEqual(out.output, { status: "active", round: 2, tokens_used: 60, budget: 1000 });
    // Later rounds restate the objective: the original message may be far behind or compacted.
    assert.match(out.input, /The user-provided objective/);
    assert.ok(out.input.includes("make all tests pass"));
    assert.ok(out.input.includes(`Goal file: ${goalFile}`));
    assert.ok(out.input.includes('"round": 2'));
    assert.match(out.reason, /round 2/);
    assert.deepEqual(goal, {
      objective: "make all tests pass",
      status: "active",
      budget: 1000,
      round: 2,
      tokens_used: 60,
    });
  });

  it("ends as complete when the model claims completion", async () => {
    const [{ out, goal }] = await play(await loadFixture("complete"));
    assert.equal(out.decision, "stop");
    assert.deepEqual(out.output, { status: "complete", round: 1, tokens_used: 50, budget: -1 });
    assert.equal(out.input, undefined, "a stopped goal re-injects nothing");
    assert.match(out.reason, /complete/);
    // The hook marks the ending itself: the model only ever writes `status`.
    assert.deepEqual(goal, {
      objective: "make all tests pass",
      status: "complete",
      budget: -1,
      round: 1,
      tokens_used: 50,
      ended: true,
    });
  });

  it("ends as blocked when the model claims an impasse", async () => {
    const [{ out, goal }] = await play(await loadFixture("blocked"));
    assert.equal(out.decision, "stop");
    assert.deepEqual(out.output, { status: "blocked", round: 1, tokens_used: 50, budget: -1 });
    assert.match(out.reason, /blocked/);
    assert.equal(goal.status, "blocked");
    assert.equal(goal.ended, true);
  });

  it("ends as budget_limited after one wrap-up round once the budget is used up", async () => {
    const [{ out: wrapUp, goal: wrappingUp }, { out: ended, goal: budgetLimited }] = await play(
      await loadFixture("budget-exhausted"),
    );
    // Round 1 spent 120 of a 100-token budget: the goal is not cut off mid-thought, it gets one
    // final round and the goal ends when that round is over.
    assert.equal(wrapUp.decision, "continue");
    assert.deepEqual(wrapUp.output, {
      status: "wrapping_up",
      round: 2,
      tokens_used: 120,
      budget: 100,
    });
    assert.match(wrapUp.reason, /wrap-up/);
    assert.match(wrapUp.input, /reached its token budget/);
    assert.ok(wrapUp.input.includes("make all tests pass"));
    assert.equal(wrappingUp.status, "wrapping_up");
    assert.equal(wrappingUp.ended, undefined, "the goal has not ended yet");
    assert.equal(ended.decision, "stop");
    assert.deepEqual(ended.output, {
      status: "budget_limited",
      round: 2,
      tokens_used: 130,
      budget: 100,
    });
    assert.match(ended.reason, /budget_limited/);
    assert.equal(budgetLimited.status, "budget_limited");
    assert.equal(budgetLimited.ended, true);
  });
});

describe("stop.mjs — the endings the loop documents beside the three", () => {
  it("ends as aborted when the round was cut off: a user stop, a failed request, the max_turns cap", async () => {
    for (const fixture of ["cut-off-user-stop", "cut-off-fatal-request", "cut-off-max-turns"]) {
      const [{ out, goal }] = await play(await loadFixture(fixture));
      assert.equal(out.decision, "stop", fixture);
      assert.deepEqual(
        out.output,
        { status: "aborted", round: 1, tokens_used: 5, budget: -1 },
        fixture,
      );
      assert.match(out.reason, /aborted/, fixture);
      assert.equal(goal.ended, true, fixture);
    }
  });

  it("ends as aborted at the round cap, the backstop for a goal the model never ends", async () => {
    const [{ out }] = await play(await loadFixture("max-rounds"));
    assert.equal(out.decision, "stop");
    assert.deepEqual(out.output, { status: "aborted", round: 100, tokens_used: 1, budget: -1 });
    assert.match(out.reason, /aborted/);
  });

  it("treats a status outside the protocol as blocked", async () => {
    const [{ out }] = await play(await loadFixture("status-outside-protocol"));
    assert.equal(out.decision, "stop");
    assert.deepEqual(out.output, { status: "blocked", round: 1, tokens_used: 1, budget: -1 });
  });

  it("ends as blocked and moves a goal file that no longer parses aside", async () => {
    const [{ out: broken, goal: moved }, { out: after }] = await play(
      await loadFixture("broken-file"),
    );
    assert.equal(broken.decision, "stop");
    assert.deepEqual(broken.output, { status: "blocked", round: 0, tokens_used: 0, budget: -1 });
    assert.equal(moved, null, "the broken file is moved aside");
    assert.equal(await fileExists(`${goalFile}.broken`), true);
    assert.equal(after, undefined, "nothing left to decide");
  });

  it("stays silent about a goal an earlier run already ended", async () => {
    const [{ out }] = await play(await loadFixture("already-ended"));
    assert.equal(out, undefined);
  });
});
