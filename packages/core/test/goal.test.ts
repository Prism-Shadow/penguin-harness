import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  UNLIMITED_BUDGET,
  abortEvent,
  assistantText,
  budgetLimitMessage,
  emptyTokenCounts,
  goalFilePath,
  goalTaskMessage,
  readGoalStatus,
  runGoal,
  tokenUsage,
  userText,
  withOrigin,
  writeGoalFile,
} from "../src/index.js";
import type { GoalSession, OmniMessage, TokenCounts } from "../src/index.js";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-goal-"));
  file = path.join(dir, "session-1", "GOAL.yaml");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function usage(total: number, cacheRead = 0): TokenCounts {
  return { cache_read: cacheRead, cache_write: 0, output: 0, total };
}

/**
 * Fake session: each run yields the given messages for that round, then invokes an optional
 * side effect (standing in for the model editing GOAL.yaml with shell tools).
 */
function fakeSession(
  rounds: Array<{ messages?: OmniMessage[]; then?: () => Promise<void> }>,
): GoalSession & { prompts: string[] } {
  let i = 0;
  const prompts: string[] = [];
  return {
    prompts,
    async *run(newMessages: OmniMessage[]) {
      const round = rounds[i++];
      if (!round) throw new Error("fake session ran out of rounds");
      const p = newMessages[0]?.payload as { text?: string };
      prompts.push(p.text ?? "");
      for (const msg of round.messages ?? []) yield msg;
      await round.then?.();
    },
  };
}

/** Drains the runGoal generator, returning the yielded stream and the outcome. */
async function drain(gen: AsyncGenerator<OmniMessage, unknown>) {
  const messages: OmniMessage[] = [];
  for (;;) {
    const next = await gen.next();
    if (next.done) return { messages, outcome: next.value };
    messages.push(next.value);
  }
}

async function setStatus(status: string): Promise<void> {
  const raw = await fs.readFile(file, "utf8");
  await fs.writeFile(file, raw.replace(/^status: .*$/m, `status: ${status}`), "utf8");
}

describe("goal-file", () => {
  it("writes and reads back a status, creating the session directory", async () => {
    await writeGoalFile(file, {
      objective: "obj",
      status: "active",
      tokens: { budget: 1000, used: 250 },
    });
    expect(await readGoalStatus(file)).toBe("active");
    const parsed = parseYaml(await fs.readFile(file, "utf8")) as {
      objective: string;
      tokens: { budget: number; used: number; remaining?: number };
    };
    expect(parsed.objective).toBe("obj");
    expect(parsed.tokens).toEqual({ budget: 1000, used: 250, remaining: 750 });
  });

  it("omits remaining for an unlimited budget", async () => {
    await writeGoalFile(file, {
      objective: "obj",
      status: "active",
      tokens: { budget: UNLIMITED_BUDGET, used: 42 },
    });
    const parsed = parseYaml(await fs.readFile(file, "utf8")) as {
      tokens: Record<string, number>;
    };
    expect(parsed.tokens).toEqual({ budget: UNLIMITED_BUDGET, used: 42 });
  });

  it("normalizes a missing file, invalid YAML, and unknown statuses to blocked", async () => {
    expect(await readGoalStatus(file)).toBe("blocked");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "status: [unclosed", "utf8");
    expect(await readGoalStatus(file)).toBe("blocked");
    await fs.writeFile(file, "status: done_i_guess\n", "utf8");
    expect(await readGoalStatus(file)).toBe("blocked");
    // budget_limited is runner-written only: reading it back means the protocol was violated.
    await fs.writeFile(file, "status: budget_limited\n", "utf8");
    expect(await readGoalStatus(file)).toBe("blocked");
  });
});

describe("goal-prompts", () => {
  it("escapes the objective and renders the round and budget", () => {
    const text = goalTaskMessage({
      objective: "use <b> & </b>",
      goalFilePath: "/tmp/GOAL.yaml",
      round: 3,
      tokensUsed: 100,
      budget: 1000,
    });
    expect(text).toContain("round: 3");
    expect(text).toContain("use &lt;b&gt; &amp; &lt;/b&gt;");
    expect(text).toContain("Tokens used: 100 / 1000 (remaining: 900)");
    expect(text).toContain("/tmp/GOAL.yaml");
  });

  it("renders an unlimited budget as unbounded", () => {
    const text = goalTaskMessage({
      objective: "obj",
      goalFilePath: "/tmp/GOAL.yaml",
      round: 1,
      tokensUsed: 0,
      budget: UNLIMITED_BUDGET,
    });
    expect(text).toContain("Token budget: none (unbounded)");
    const wrap = budgetLimitMessage({
      objective: "obj",
      goalFilePath: "/tmp/GOAL.yaml",
      round: 2,
      tokensUsed: 5,
      budget: 100,
    });
    expect(wrap).toContain("reached its token budget");
    expect(wrap).toContain("round: 2");
  });

  it("renders a skills paragraph outside the escaped objective; none without skills", () => {
    const args = {
      objective: "use <use_skills> literally",
      goalFilePath: "/tmp/GOAL.yaml",
      round: 1,
      tokensUsed: 0,
      budget: UNLIMITED_BUDGET,
    };
    const text = goalTaskMessage({ ...args, skills: ["web-design", "data_viz"] });
    expect(text).toContain("Skills to use: web-design, data_viz.");
    // The objective's own tag stays escaped data even when skills are present.
    expect(text).toContain("use &lt;use_skills&gt; literally");
    expect(goalTaskMessage(args)).not.toContain("Skills to use");
    expect(goalTaskMessage({ ...args, skills: [] })).not.toContain("Skills to use");
  });
});

describe("goal paths", () => {
  it("derives the goal file path from the scratchpad session directory", () => {
    expect(goalFilePath("/root", "p", "a", "s1")).toBe(
      path.join("/root", "p", "agents", "a", "scratchpad", "s1", "GOAL.yaml"),
    );
  });
});

describe("runGoal", () => {
  it("loops until the model marks complete, injecting a goal_task round message each time", async () => {
    const session = fakeSession([
      { messages: [tokenUsage(usage(100), usage(100))] },
      {
        messages: [tokenUsage(usage(200), usage(50))],
        then: () => setStatus("complete"),
      },
    ]);
    const { messages, outcome } = await drain(
      runGoal(session, { objective: "obj", goalFilePath: file }),
    );
    expect(outcome).toEqual({ outcome: "complete", rounds: 2, tokensUsed: 150 });
    expect(session.prompts[0]).toContain("round: 1");
    expect(session.prompts[1]).toContain("round: 2");
    // The stream contains each round's injected user message followed by the round's output.
    const userTexts = messages.filter(
      (m) => m.type === "model_msg" && (m.payload as { role?: string }).role === "user",
    );
    expect(userTexts).toHaveLength(2);
    expect(await readGoalStatus(file)).toBe("complete");
  });

  it("treats a round the engine cut off (failed final assistant text) as terminal", async () => {
    // The max_turns cutoff: a final assistant notice with stop_reason "failed", no abort
    // event, and the model never reached the goal file — re-firing would loop forever.
    const session = fakeSession([
      { messages: [assistantText("[reached max turns (100); stopping]", "failed")] },
    ]);
    const { outcome } = await drain(runGoal(session, { objective: "o", goalFilePath: file }));
    expect(outcome).toEqual({ outcome: "aborted", rounds: 1, tokensUsed: 0 });
    // The on-disk goal stays active: the workspace and goal file remain the resume point.
    expect(await readGoalStatus(file)).toBe("active");
  });

  it("a mid-round failed notice followed by normal text does not end the goal", async () => {
    const session = fakeSession([
      {
        messages: [assistantText("tool hiccup", "failed"), assistantText("recovered, done")],
        then: () => setStatus("complete"),
      },
    ]);
    const { outcome } = await drain(runGoal(session, { objective: "o", goalFilePath: file }));
    expect(outcome).toEqual({ outcome: "complete", rounds: 1, tokensUsed: 0 });
  });

  it("stops at the round cap when the model never writes the goal file", async () => {
    const session = fakeSession([{}, {}, {}]);
    const { outcome } = await drain(
      runGoal(session, { objective: "o", goalFilePath: file, maxRounds: 3 }),
    );
    expect(outcome).toEqual({ outcome: "aborted", rounds: 3, tokensUsed: 0 });
    expect(session.prompts).toHaveLength(3);
    expect(await readGoalStatus(file)).toBe("active");
  });

  it("an abort landing between rounds stops the loop without a phantom round", async () => {
    const ac = new AbortController();
    // The signal aborts AFTER round 1's stream ends — no abort event ever hits the stream,
    // which is exactly the window where a phantom round used to fire (and its <goal_task>
    // input would leak into the user's next message as engine carry-over).
    const session = fakeSession([
      {
        then: async () => {
          ac.abort();
        },
      },
    ]);
    const { outcome } = await drain(
      runGoal(session, { objective: "o", goalFilePath: file, signal: ac.signal }),
    );
    expect(outcome).toEqual({ outcome: "aborted", rounds: 1, tokensUsed: 0 });
    expect(session.prompts).toHaveLength(1);
  });

  it("repeats the skills paragraph in every round's injected message", async () => {
    const session = fakeSession([{}, { then: () => setStatus("complete") }]);
    const { outcome } = await drain(
      runGoal(session, { objective: "o", goalFilePath: file, skills: ["web-design"] }),
    );
    expect(outcome).toMatchObject({ outcome: "complete" });
    expect(session.prompts).toHaveLength(2);
    for (const prompt of session.prompts) expect(prompt).toContain("Skills to use: web-design");
  });

  it("stops when the model marks blocked (or breaks the file)", async () => {
    const session = fakeSession([{ then: () => setStatus("blocked") }]);
    const { outcome } = await drain(runGoal(session, { objective: "o", goalFilePath: file }));
    expect(outcome).toEqual({ outcome: "blocked", rounds: 1, tokensUsed: 0 });

    const corrupt = fakeSession([
      { then: () => fs.writeFile(file, ":: not yaml ::\n\t{", "utf8") },
    ]);
    const second = await drain(runGoal(corrupt, { objective: "o", goalFilePath: file }));
    expect(second.outcome).toEqual({ outcome: "blocked", rounds: 1, tokensUsed: 0 });
  });

  it("runs one wrap-up round and marks budget_limited when the budget is exhausted", async () => {
    const session = fakeSession([
      { messages: [tokenUsage(usage(120), usage(120))] },
      { messages: [tokenUsage(usage(150), usage(30))] },
    ]);
    const { outcome } = await drain(
      runGoal(session, { objective: "o", goalFilePath: file, budget: 100 }),
    );
    expect(outcome).toEqual({ outcome: "budget_limited", rounds: 2, tokensUsed: 150 });
    expect(session.prompts[1]).toContain("reached its token budget");
    // The terminal state is runner-written; the raw file records it even though reads normalize it.
    expect(await fs.readFile(file, "utf8")).toContain("status: budget_limited");
  });

  it("honors a truthful complete during the wrap-up round", async () => {
    const session = fakeSession([
      { messages: [tokenUsage(usage(120), usage(120))] },
      { then: () => setStatus("complete") },
    ]);
    const { outcome } = await drain(
      runGoal(session, { objective: "o", goalFilePath: file, budget: 100 }),
    );
    expect(outcome).toEqual({ outcome: "complete", rounds: 2, tokensUsed: 120 });
  });

  it("stops without re-firing when the main session aborts, leaving the goal active", async () => {
    const session = fakeSession([
      { messages: [tokenUsage(usage(80), usage(80)), abortEvent("interrupted")] },
    ]);
    const { outcome } = await drain(runGoal(session, { objective: "o", goalFilePath: file }));
    expect(outcome).toEqual({ outcome: "aborted", rounds: 1, tokensUsed: 80 });
    expect(await readGoalStatus(file)).toBe("active");
  });

  it("counts uncached input + output, including subagent (origin-marked) usage", async () => {
    const childUsage = withOrigin(tokenUsage(usage(500, 200), usage(500, 200)), "child-session");
    const childAbort = withOrigin(abortEvent("child failed"), "child-session");
    const session = fakeSession([
      {
        // Main request: total 1000 with 400 cached → 600; child: total 500 with 200 cached → 300.
        // A child abort must not end the goal loop.
        messages: [tokenUsage(usage(1000, 400), usage(1000, 400)), childUsage, childAbort],
        then: () => setStatus("complete"),
      },
    ]);
    const { outcome } = await drain(runGoal(session, { objective: "o", goalFilePath: file }));
    expect(outcome).toEqual({ outcome: "complete", rounds: 1, tokensUsed: 900 });
  });

  it("keeps the display tokens block fresh between rounds", async () => {
    const session = fakeSession([
      { messages: [tokenUsage(usage(70), usage(70))] },
      { then: () => setStatus("complete") },
    ]);
    // Capture the file the model would see at the start of round 2.
    const midRun: Array<{ tokens?: { used?: number } }> = [];
    const orig = session.run.bind(session);
    let call = 0;
    session.run = async function* (msgs, opts) {
      call++;
      if (call === 2) {
        midRun.push(parseYaml(await fs.readFile(file, "utf8")) as { tokens?: { used?: number } });
      }
      yield* orig(msgs, opts);
    };
    await drain(runGoal(session, { objective: "o", goalFilePath: file }));
    expect(midRun[0]?.tokens?.used).toBe(70);
  });

  it("sanity: userText/emptyTokenCounts helpers exist for hosts", () => {
    expect(userText("x").payload.text).toBe("x");
    expect(emptyTokenCounts().total).toBe(0);
  });
});
