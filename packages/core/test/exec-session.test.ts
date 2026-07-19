/**
 * Behavior tests for long-running command sessions (exec_command yield + input_command).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Environment, ManagedSession } from "../src/environment/index.js";
import { toolCall } from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type { ToolConfig, ToolDefinitionConfig } from "../src/interfaces.js";

function execTool(overrides: Partial<ToolDefinitionConfig> = {}): ToolDefinitionConfig {
  return {
    name: "exec_command",
    description: "Run a shell command.",
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string" },
        workdir: { type: "string" },
        yield_time_ms: { type: "number" },
      },
      required: ["cmd"],
    },
    permission: "rw",
    maxOutputLength: 16000,
    ...overrides,
  };
}

function inputCommandTool(overrides: Partial<ToolDefinitionConfig> = {}): ToolDefinitionConfig {
  return {
    name: "input_command",
    description: "Interact with a running command session.",
    parameters: {
      type: "object",
      properties: {
        process_id: { type: "string" },
        chars: { type: "string" },
        yield_time_ms: { type: "number" },
      },
      required: ["process_id"],
    },
    permission: "rw",
    maxOutputLength: 16000,
    ...overrides,
  };
}

function sessionConfig(): ToolConfig {
  return { customTools: [execTool(), inputCommandTool()], mcpServers: [] };
}

interface FinalOutput {
  output: string;
  stopReason?: string;
}

/** Runs one tool call and returns the final tool_call_output's content and stop_reason. */
async function runTool(
  env: Environment,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<FinalOutput> {
  let last: OmniMessage | null = null;
  for await (const msg of env.executeTool({
    toolCall: toolCall({ name, arguments: JSON.stringify(args), toolCallId: `call_${name}` }),
    ...(signal ? { signal } : {}),
  })) {
    if ((msg.payload as { type?: string }).type === "tool_call_output") last = msg;
  }
  const p = (last?.payload ?? {}) as { output?: string; stop_reason?: string };
  return { output: p.output ?? "", stopReason: p.stop_reason };
}

function extractProcessId(output: string): string {
  const m = output.match(/process_id (proc-[0-9a-f]+)/);
  expect(m, `expected a process_id in: ${JSON.stringify(output)}`).toBeTruthy();
  return m![1]!;
}

let tmp: string;
let env: Environment;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-exec-session-"));
  env = new Environment({ workspaceDir: tmp, toolConfig: sessionConfig() });
});

afterEach(async () => {
  env.dispose();
  await rm(tmp, { recursive: true, force: true });
});

describe("exec_command — long-running command sessions", () => {
  it("returns promptly when a command backgrounds a long-lived child", async () => {
    // node stays resident in the background and inherits the pipes; bash exits immediately
    // after the foreground echo. The old implementation waited for close (pipe EOF) -> stuck
    // for 5s; the new implementation goes by the foreground exit + a short drain, returning
    // within seconds, and reaps the leftover background process.
    const startedAt = Date.now();
    const res = await runTool(env, "exec_command", {
      cmd: 'node -e "setTimeout(()=>{},5000)" & echo hello',
    });
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(2000);
    expect(res.output).toContain("hello");
    expect(res.output).not.toContain("process running with process_id");
    expect(res.stopReason).toBe("completed");
  });

  it("streams output incrementally while the command is running", async () => {
    // Two output chunks arrive 400ms apart: they should be produced as separate delta segments,
    // not returned all at once when the window ends.
    const deltas: string[] = [];
    for await (const msg of env.executeTool({
      toolCall: toolCall({
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "echo first; sleep 0.4; echo second" }),
        toolCallId: "call_stream",
      }),
    })) {
      const p = msg.payload as { type?: string; event_type?: string; output?: string };
      if (p.type === "partial_tool_call_output" && p.event_type === "delta" && p.output) {
        deltas.push(p.output);
      }
    }
    const firstIdx = deltas.findIndex((d) => d.includes("first"));
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(deltas[firstIdx]).not.toContain("second"); // first arrives earlier, not in the same segment as second
    expect(deltas.slice(firstIdx + 1).some((d) => d.includes("second"))).toBe(true);
  });

  it("yields a process_id when the command is still running past yield_time_ms", async () => {
    const res = await runTool(env, "exec_command", {
      cmd: "sleep 30",
      yield_time_ms: 300,
    });
    expect(res.stopReason).toBe("completed");
    expect(res.output).toContain("process running with process_id proc-");
  });

  it("input_command drives a running session: write stdin, get output and exit status", async () => {
    const start = await runTool(env, "exec_command", {
      cmd: "read line; echo got:$line",
      yield_time_ms: 300,
    });
    const pid = extractProcessId(start.output);

    const res = await runTool(env, "input_command", {
      process_id: pid,
      chars: "penguin\n",
      yield_time_ms: 2000,
    });
    expect(res.output).toContain("got:penguin");
    expect(res.stopReason).toBe("completed");
  });

  it("input_command with an empty chars polls new output without writing", async () => {
    const start = await runTool(env, "exec_command", {
      cmd: "for i in 1 2 3; do echo line$i; sleep 0.2; done",
      yield_time_ms: 100,
    });
    const pid = extractProcessId(start.output);

    const res = await runTool(env, "input_command", {
      process_id: pid,
      chars: "",
      yield_time_ms: 2000,
    });
    // The command finishes during polling, yielding the remaining output and exit status.
    expect(res.output).toContain("line3");
    expect(res.stopReason).toBe("completed");
  });

  it("input_command sends Ctrl-C (U+0003) to interrupt a running session", async () => {
    const start = await runTool(env, "exec_command", {
      cmd: "sleep 30",
      yield_time_ms: 300,
    });
    const pid = extractProcessId(start.output);

    const startedAt = Date.now();
    const res = await runTool(env, "input_command", {
      process_id: pid,
      chars: String.fromCharCode(3), // U+0003 = Ctrl-C
      yield_time_ms: 2000,
    });
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(3000); // Did not wait for the full sleep 30
    expect(res.output).not.toContain("still running");
    expect(res.stopReason).toBe("failed"); // Interrupted by signal -> non-zero exit
  });

  it("input_command rejects chars mixing U+0003 with other content", async () => {
    const start = await runTool(env, "exec_command", {
      cmd: "sleep 30",
      yield_time_ms: 300,
    });
    const pid = extractProcessId(start.output);

    const res = await runTool(env, "input_command", {
      process_id: pid,
      chars: `q${String.fromCharCode(3)}`, // Mixed with other content: errors, neither writes nor sends the signal
      yield_time_ms: 2000,
    });
    expect(res.output).toContain('send "\\u0003" alone');
    expect(res.stopReason).toBe("failed");

    // The session was not mistakenly killed: still running.
    const poll = await runTool(env, "input_command", { process_id: pid, yield_time_ms: 300 });
    expect(poll.output).toContain("still running");
  });

  it("input_command reports an unknown process_id without throwing", async () => {
    const res = await runTool(env, "input_command", { process_id: "proc-deadbeef" });
    expect(res.output).toContain("unknown process_id proc-deadbeef");
    expect(res.stopReason).toBe("failed");
  });

  it("input_command ignores writes to a closed stdin pipe without crashing", async () => {
    const start = await runTool(env, "exec_command", {
      cmd: "exec 0<&-; sleep 30",
      yield_time_ms: 300,
    });
    const pid = extractProcessId(start.output);

    const res = await runTool(env, "input_command", {
      process_id: pid,
      chars: "ignored\n",
      yield_time_ms: 300,
    });
    expect(res.output).toContain(`process still running with process_id ${pid}`);
    expect(res.stopReason).toBe("completed");
  });

  it("runs commands through pipes, not a TTY (isTTY=false)", async () => {
    const res = await runTool(env, "exec_command", {
      cmd: 'node -e "process.stdout.write(String(Boolean(process.stdout.isTTY)))"',
      yield_time_ms: 3000,
    });
    expect(res.output).toContain("false");
    expect(res.stopReason).toBe("completed");
  });

  it("hardens the child env against interactive hangs (editor/credentials/pager)", async () => {
    const res = await runTool(env, "exec_command", {
      cmd: 'echo "$GIT_EDITOR|$GIT_TERMINAL_PROMPT|$PAGER|$TERM"',
      yield_time_ms: 3000,
    });
    expect(res.output).toContain("true|0|cat|dumb");
    expect(res.stopReason).toBe("completed");
  });

  it("does not start new command sessions after the environment is disposed", async () => {
    env.dispose();
    const res = await runTool(env, "exec_command", {
      cmd: "echo should-not-run",
      yield_time_ms: 3000,
    });
    expect(res.output).toContain("command session manager disposed");
    expect(res.output).not.toContain("should-not-run");
    expect(res.stopReason).toBe("failed");
  });

  it("delivers output arriving while the consumer is suspended without waiting out the window", async () => {
    // Wake-race regression: when data arrives while suspended at `yield`, its wakeup happens
    // before the next wait begins (so it would be missed). collect must re-check the buffer
    // right before sleeping, otherwise this batch of data would not be produced until the
    // window ends (here, 5s).
    const session = new ManagedSession({ cmd: "echo first; cat", cwd: tmp, env: process.env });
    try {
      const gen = session.collect(5000);
      const first = await gen.next();
      expect(first.done).toBe(false);
      expect(String(first.value)).toContain("first");
      // The generator is still suspended at the yield above: writing to stdin now, with cat
      // echoing it back, means both the data event and the wakeup have already happened.
      session.write("second\n");
      await new Promise((r) => setTimeout(r, 300));
      const startedAt = Date.now();
      const next = await gen.next();
      expect(String(next.value)).toContain("second");
      expect(Date.now() - startedAt).toBeLessThan(1500);
      await gen.return(undefined);
    } finally {
      session.kill();
    }
  });
});
