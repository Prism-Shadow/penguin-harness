/**
 * The skill-summary plugin's stop script, run as the harness runs it (a Node subprocess with
 * JSON on stdin) against a fake Trace and skills directory: silent while the just-ended Task
 * stays at or under the threshold, a subagent request with the condensed excerpt once a Task
 * exceeds it — the window is the Task itself, so it fires at most once per Task.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = path.resolve(import.meta.dirname, "../../../plugins/skill-summary/hooks/stop.mjs");

let root: string;
let agentState: string;
let tracePath: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-summary-plugin-"));
  agentState = path.join(root, "agents", "a1", "agent_state");
  tracePath = path.join(root, "agents", "a1", "traces", "2026-08-29", "s1_001.jsonl");
  await fs.mkdir(path.dirname(tracePath), { recursive: true });
  await fs.mkdir(path.join(agentState, "skills", "web-design"), { recursive: true });
  await fs.writeFile(
    path.join(agentState, "skills", "web-design", "SKILL.md"),
    "---\nname: web-design\n---\n",
  );
  await fs.mkdir(path.join(agentState, "skills", "penguin-cli"), { recursive: true });
  await fs.writeFile(
    path.join(agentState, "skills", "penguin-cli", "SKILL.md"),
    "---\nname: penguin-cli\n---\n",
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function stop():
  { reason?: string; output?: Record<string, unknown>; subagent?: { prompt: string } } | undefined {
  const res = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ hook: "stop", session_id: "s1", trace_path: tracePath }),
    encoding: "utf8",
  });
  expect(res.status, res.stderr).toBe(0);
  const text = res.stdout.trim();
  return text ? JSON.parse(text) : undefined;
}

const meta = () => ({
  type: "session_meta",
  payload: { session_id: "s1", agent_state: agentState },
});
const user = (text: string) => ({
  type: "model_msg",
  payload: { type: "text", role: "user", text },
});
const assistant = (text: string) => ({
  type: "model_msg",
  payload: { type: "text", role: "assistant", text },
});
const usage = () => ({
  type: "event_msg",
  payload: {
    type: "token_usage",
    session: { total: 1, cache_read: 0, cache_write: 0, output: 0 },
    request: { total: 1, cache_read: 0, cache_write: 0, output: 0 },
  },
});
const toolCall = (name: string, id: string, args: string) => ({
  type: "model_msg",
  payload: { type: "tool_call", role: "assistant", name, tool_call_id: id, arguments: args },
});
const toolOutput = (id: string, output: string, stop_reason = "completed") => ({
  type: "model_msg",
  payload: { type: "tool_call_output", role: "user", tool_call_id: id, output, stop_reason },
});
// One in-task turn: the model answers, calls a tool, gets its output, usage lands — no new
// user input, so the Task keeps going.
const turn = (i: number) => [
  assistant(`working ${i}`),
  toolCall("exec_command", `t${i}`, '{"cmd":"ls"}'),
  toolOutput(`t${i}`, "ok"),
  usage(),
];

const append = (records: unknown[]) =>
  fs.appendFile(tracePath, records.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf8");

describe("skill-summary stop.mjs", () => {
  it("is silent while the task stays at 30 turns, fires with the condensed task once it exceeds them", async () => {
    await append([
      meta(),
      user("[use_skills]\nskills: web-design\n[/use_skills]\n\nmake it pretty"),
    ]);
    for (let i = 1; i <= 30; i++) await append(turn(i));
    expect(stop()).toBeUndefined();
    await append([
      toolOutput("c2", "boom", "fatal"),
      user("[user_steering]\nskip the tests\n[/user_steering]"),
      ...turn(31),
    ]);
    const res = stop();
    expect(res).toMatchObject({ output: { turns: 31 } });
    expect(res!.reason).toContain("31 turns");
    const prompt = res!.subagent!.prompt;
    expect(prompt).toContain("Installed skills: penguin-cli, web-design");
    expect(prompt).toContain("Skills invoked in this task: web-design");
    expect(prompt).toContain("agent_state/skills");
    expect(prompt).toContain("[user] make it pretty");
    expect(prompt).toContain('[tool_call exec_command] {"cmd":"ls"}');
    expect(prompt).toContain("[tool_output c2 · fatal] boom");
    expect(prompt).toContain("[user] skip the tests");
    expect(prompt).not.toContain("[use_skills]");
    expect(prompt).toContain("YYYY-MM-DD.N");
  });

  it("windows per task: a new input resets the count, and it never fires without skills", async () => {
    // A long task that already fired…
    await append([meta(), user("big refactor")]);
    for (let i = 1; i <= 35; i++) await append(turn(i));
    expect(stop()).toMatchObject({ output: { turns: 35 } });
    // …then a short follow-up task: its own window, silent — the long task never re-fires.
    await append([user("quick question"), assistant("quick answer"), usage()]);
    expect(stop()).toBeUndefined();
    // A harness-injected input (a goal round) starts its own task window too.
    await append([
      {
        type: "model_msg",
        payload: { type: "text", role: "user", text: "goal round 2 protocol", sender: "harness" },
      },
      assistant("round work"),
      usage(),
    ]);
    expect(stop()).toBeUndefined();
    await fs.rm(path.join(agentState, "skills"), { recursive: true, force: true });
    expect(stop()).toBeUndefined();
  });

  it("mid-task deliveries do not reset the window: steering and steered notices ride inside", async () => {
    await append([meta(), user("long task")]);
    for (let i = 1; i <= 25; i++) await append(turn(i));
    await append([
      user("[user_steering]\nkeep going\n[/user_steering]"),
      user(
        "[background_task_done]\nkind: command\nid: p1\nstatus: completed\ndelivery: steering\n[/background_task_done]\n\nBackground command finished",
      ),
    ]);
    for (let i = 26; i <= 31; i++) await append(turn(i));
    expect(stop()).toMatchObject({ output: { turns: 31 } });
  });
});
