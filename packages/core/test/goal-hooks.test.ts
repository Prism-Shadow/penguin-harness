/**
 * The goal plugin's scripts, run the way the harness runs them — as Node subprocesses with
 * JSON on stdin — against a fake Trace and scratchpad: start.mjs writes GOAL.json and prints
 * the round-1 message; stop.mjs reads the round's usage off the Trace and decides.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const hooksDir = path.resolve(import.meta.dirname, "../../../plugins/goal/hooks");

let root: string;
let scratchpad: string;
let tracePath: string;
let goalFile: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-goal-plugin-"));
  scratchpad = path.join(root, "agents", "a1", "scratchpad", "s1");
  tracePath = path.join(root, "agents", "a1", "traces", "2026-08-29", "s1_001.jsonl");
  goalFile = path.join(scratchpad, "GOAL.json");
  await fs.mkdir(path.dirname(tracePath), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function run(
  script: string,
  input: unknown,
): { out: unknown; status: number | null; stderr: string } {
  const res = spawnSync(process.execPath, [path.join(hooksDir, script)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    cwd: hooksDir,
  });
  const text = res.stdout.trim();
  return { out: text ? JSON.parse(text) : undefined, status: res.status, stderr: res.stderr };
}

const start = (prompt: string, budget = -1) =>
  run("start.mjs", {
    hook: "user_prompt",
    session_id: "s1",
    scratchpad_dir: scratchpad,
    prompt,
    budget,
  });
const stop = () => run("stop.mjs", { hook: "stop", session_id: "s1", trace_path: tracePath });

const meta = () => ({
  type: "session_meta",
  payload: { session_id: "s1", agent_state: path.join(root, "agents", "a1", "agent_state") },
});
const user = (text: string) => ({
  type: "model_msg",
  payload: { type: "text", role: "user", text },
});
// A round's protocol input the way the host records it: stamped `sender: "harness"`.
const harness = (text: string) => ({
  type: "model_msg",
  payload: { type: "text", role: "user", text, sender: "harness" },
});
const assistant = (text: string, stop_reason?: string) => ({
  type: "model_msg",
  payload: { type: "text", role: "assistant", text, ...(stop_reason ? { stop_reason } : {}) },
});
const usage = (total: number, cacheRead = 0) => ({
  type: "event_msg",
  payload: {
    type: "token_usage",
    session: { total, cache_read: cacheRead, cache_write: 0, output: 0 },
    request: { total, cache_read: cacheRead, cache_write: 0, output: 0 },
  },
});
const requestEnd = (status: string) => ({
  type: "event_msg",
  payload: { type: "request_end", status },
});
const abort = () => ({ type: "event_msg", payload: { type: "abort", error_code: "user_abort" } });

async function writeTrace(records: unknown[]): Promise<void> {
  await fs.writeFile(tracePath, records.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf8");
}

async function readGoal(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(goalFile, "utf8")) as Record<string, unknown>;
}

async function setStatus(status: string): Promise<void> {
  const goal = await readGoal();
  await fs.writeFile(goalFile, JSON.stringify({ ...goal, status }), "utf8");
}

describe("start.mjs (the user_prompt hook)", () => {
  it("writes GOAL.json and prints the round-1 protocol message as context", async () => {
    const { out, status } = start("ship the landing page", 500);
    expect(status).toBe(0);
    expect(await readGoal()).toEqual({
      objective: "ship the landing page",
      status: "active",
      budget: 500,
      round: 1,
      tokens_used: 0,
    });
    const input = (out as { context: string }).context;
    // Plain text, no marker block: round 1 points at the user's own message instead of
    // restating the objective (the host sends this right behind it, stamped as harness).
    expect(input).toContain("sent automatically by goal mode");
    expect(input).toContain("The objective is the user message above");
    // No restatement paragraph on round 1 (the embedded file content still shows the field).
    expect(input).not.toContain("The user-provided objective");
    expect(input).not.toContain("[goal]");
    expect(input).toContain('"status": "active"');
    expect(input).toContain('"budget": 500');
  });

  it("rejects an empty prompt and treats a non-positive budget as none", async () => {
    expect(start("   ").status).not.toBe(0);
    start("obj", 0);
    expect((await readGoal()).budget).toBe(-1);
  });
});

describe("stop.mjs", () => {
  it("stays silent without a goal file, and after a goal an earlier run already ended", async () => {
    await writeTrace([meta(), user("hi"), assistant("hello"), usage(10)]);
    expect(stop().out).toBeUndefined();
    start("obj");
    // The hook's own endings carry `ended`; the model never writes it.
    await fs.writeFile(
      goalFile,
      JSON.stringify({ ...(await readGoal()), status: "aborted", ended: true }),
      "utf8",
    );
    expect(stop().out).toBeUndefined();
  });

  it("continues with the next round while the file stays active, counting the round's uncached usage", async () => {
    const { out: started } = start("obj", 1000);
    await writeTrace([
      meta(),
      usage(999),
      harness((started as { context: string }).context),
      assistant("working"),
      usage(100, 40),
      requestEnd("completed"),
      assistant("done for now"),
      usage(200, 50),
      requestEnd("completed"),
    ]);
    const { out } = stop();
    expect(out).toMatchObject({
      decision: "continue",
      output: { status: "active", round: 2, tokens_used: 210, budget: 1000 },
    });
    const input = (out as { input: string }).input;
    // Later rounds restate the objective from the file (the original message may be far
    // behind or compacted) — still plain text, no marker block.
    expect(input).toContain("sent automatically by goal mode");
    expect(input).toContain("obj");
    expect(input).toContain('"round": 2');
    expect(input).not.toContain("[goal]");
    expect(await readGoal()).toMatchObject({ status: "active", round: 2, tokens_used: 210 });
  });

  it("stops with the model's own verdict, keeping it in the file", async () => {
    const { out: started } = start("obj");
    await writeTrace([
      meta(),
      harness((started as { context: string }).context),
      assistant("all green"),
      usage(50),
    ]);
    await setStatus("complete");
    const { out } = stop();
    expect(out).toMatchObject({
      decision: "stop",
      output: { status: "complete", round: 1, tokens_used: 50 },
    });
    expect((out as { input?: string }).input).toBeUndefined();
    expect(await readGoal()).toMatchObject({ status: "complete", tokens_used: 50 });
  });

  it("a cut-off Task ends the goal as aborted: a user abort, a failed request, or the max_turns notice", async () => {
    for (const tail of [
      [abort()],
      [requestEnd("fatal")],
      [assistant("[reached max turns (10); stopping]", "fatal")],
    ]) {
      const { out: started } = start("obj");
      await writeTrace([
        meta(),
        harness((started as { context: string }).context),
        assistant("partial"),
        usage(5),
        ...tail,
      ]);
      expect(stop().out).toMatchObject({ decision: "stop", output: { status: "aborted" } });
      expect((await readGoal()).status).toBe("aborted");
    }
  });

  it("a failed request that was retried and then completed does not count as a cutoff", async () => {
    const { out: started } = start("obj");
    await writeTrace([
      meta(),
      harness((started as { context: string }).context),
      requestEnd("retryable"),
      assistant("recovered"),
      usage(5),
      requestEnd("completed"),
    ]);
    expect(stop().out).toMatchObject({ decision: "continue", output: { round: 2 } });
  });

  it("runs one wrap-up round once the budget is reached, then ends as budget_limited", async () => {
    const { out: started } = start("obj", 100);
    await writeTrace([
      meta(),
      harness((started as { context: string }).context),
      assistant("spent"),
      usage(120),
    ]);
    const wrap = stop().out as {
      decision: string;
      input: string;
      reason: string;
      output: Record<string, unknown>;
    };
    expect(wrap).toMatchObject({
      decision: "continue",
      output: { status: "wrapping_up", round: 2 },
    });
    expect(wrap.input).toContain("reached its token budget");
    expect(wrap.reason).toContain("wrap-up");
    await writeTrace([meta(), harness(wrap.input), assistant("summary"), usage(10)]);
    expect(stop().out).toMatchObject({
      decision: "stop",
      output: { status: "budget_limited", round: 2, tokens_used: 130 },
    });
  });

  it("honors a truthful complete during the wrap-up round", async () => {
    const { out: started } = start("obj", 100);
    await writeTrace([meta(), harness((started as { context: string }).context), usage(120)]);
    const wrap = stop().out as { input: string };
    await writeTrace([meta(), harness(wrap.input), usage(10)]);
    await setStatus("complete");
    expect(stop().out).toMatchObject({ decision: "stop", output: { status: "complete" } });
  });

  it("a background completion notice inside the round does not reset the usage window", async () => {
    const { out: started } = start("obj", 1000);
    const notice =
      "[background_task_done]\nkind: command\nid: proc-1\nstatus: completed\n[/background_task_done]\n\nBackground command finished";
    await writeTrace([
      meta(),
      harness((started as { context: string }).context),
      assistant("working"),
      usage(100),
      requestEnd("completed"),
      // Steered into the round mid-Task: harness-stamped, but a report — not a boundary.
      harness(notice),
      assistant("absorbed the report"),
      usage(50),
      requestEnd("completed"),
    ]);
    expect(stop().out).toMatchObject({
      decision: "continue",
      output: { round: 2, tokens_used: 150 },
    });
  });

  it("counts the whole file when a compaction rotated the round's input away", async () => {
    start("obj");
    await writeTrace([meta(), assistant("after compaction"), usage(30), usage(20)]);
    expect(stop().out).toMatchObject({
      decision: "continue",
      output: { round: 2, tokens_used: 50 },
    });
  });

  it("stops at the round cap", async () => {
    start("obj");
    await fs.writeFile(goalFile, JSON.stringify({ ...(await readGoal()), round: 100 }), "utf8");
    await writeTrace([meta(), usage(1)]);
    expect(stop().out).toMatchObject({
      decision: "stop",
      output: { status: "aborted", round: 100 },
    });
  });

  it("a file that no longer parses ends the goal as blocked and is moved aside", async () => {
    start("obj");
    await fs.writeFile(goalFile, "{ not json", "utf8");
    await writeTrace([meta(), usage(1)]);
    expect(stop().out).toMatchObject({ decision: "stop", output: { status: "blocked" } });
    await expect(fs.access(goalFile)).rejects.toThrow();
    await expect(fs.access(`${goalFile}.broken`)).resolves.toBeUndefined();
    // And the next stop is silent again.
    expect(stop().out).toBeUndefined();
  });
});
