/** Parent Session abort owns the whole retained child tree, even when already aborted at entry. */
import { describe, expect, it } from "vitest";
import { Session } from "../src/session.js";
import { assistantText, userText } from "../src/omnimessage/index.js";
import type { EnvironmentInterface, LLMInterface } from "../src/interfaces.js";
import type { SessionMetaPayload } from "../src/omnimessage/index.js";

const META: SessionMetaPayload = {
  session_id: "session-parent-abort",
  provider: "custom",
  model_id: "m1",
  model_context_window: 1000,
  system_prompt: "sp",
  agent_state: "/tmp/state",
  workspace: "/tmp/w",
};

const llm: LLMInterface = {
  async *streamGenerate() {
    yield assistantText("done");
    return { status: "completed" };
  },
};

function makeSession(interrupts: string[]): Session {
  const environment: EnvironmentInterface = {
    listTools: async () => [],
    async *executeTool() {},
    toolPermission: () => undefined,
    interruptAllSubagents: () => {
      interrupts.push("all");
      return 1;
    },
  };
  return new Session({
    meta: META,
    bootstrap: async () => ({ tools: [], llm, mcp: [] }),
    mcpServers: [],
    environment,
    imagesDir: "/tmp/session-parent-abort",
    modelHasVision: true,
  });
}

describe("Session parent-to-subagent abort cascade", () => {
  it("interrupts retained children when the parent signal aborts mid-run", async () => {
    const interrupts: string[] = [];
    const session = makeSession(interrupts);
    const ctrl = new AbortController();
    const run = session.run([userText("go")], { signal: ctrl.signal });
    const first = await run.next();
    expect(first.done).toBe(false);
    ctrl.abort();
    await run.return(undefined);
    expect(interrupts).toEqual(["all"]);
  });

  it("also cascades an already-aborted signal before the run starts", async () => {
    const interrupts: string[] = [];
    const session = makeSession(interrupts);
    const ctrl = new AbortController();
    ctrl.abort();
    for await (const _ of session.run([userText("go")], { signal: ctrl.signal })) {
      // Drain the well-formed abort flow.
    }
    expect(interrupts).toEqual(["all"]);
  });
});
