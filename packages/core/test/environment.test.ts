import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Environment } from "../src/environment/index.js";
import {
  partialToolCallOutput,
  toolCall,
  toolCallOutput,
  withOrigin,
} from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import { BUILTIN_TOOL_FACTORIES } from "../src/environment/tools/registry.js";
import type { ToolConfig, ToolDefinitionConfig } from "../src/interfaces.js";

/** Tool config for run_command (permission/maxOutputLength adjustable). */
function execTool(overrides: Partial<ToolDefinitionConfig> = {}): ToolDefinitionConfig {
  return {
    name: "run_command",
    description: "Run a shell command in the workspace.",
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string" },
        workdir: { type: "string" },
      },
      required: ["cmd"],
    },
    permission: "rw",
    maxOutputLength: 16000,
    ...overrides,
  };
}

function makeToolConfig(tool: ToolDefinitionConfig = execTool()): ToolConfig {
  return { customTools: [tool], mcpServers: [] };
}

/** Collects all OmniMessages produced by an async generator. */
async function collect(gen: AsyncGenerator<OmniMessage>): Promise<OmniMessage[]> {
  const out: OmniMessage[] = [];
  for await (const msg of gen) {
    out.push(msg);
  }
  return out;
}

function payloadTypes(messages: OmniMessage[]): string[] {
  return messages.map((m) => (m.payload as { type?: string }).type ?? "");
}

let tmp: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-env-"));
  // run_command runs via a `bash -l` login shell (product behavior): a login shell loads the
  // developer's ~/.bash_profile and similar files, whose latency (e.g. nvm taking hundreds of
  // ms) and stderr output (e.g. nvm warnings) can leak into tool output, letting the local
  // profile hijack timeout/truncation test cases. Pointing HOME at an empty temp directory makes
  // the login shell read only the system-level profile (quiet, millisecond-scale), decoupling
  // tests from the developer's environment.
  originalHome = process.env.HOME;
  process.env.HOME = tmp;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await rm(tmp, { recursive: true, force: true });
});

describe("Environment.listTools", () => {
  it("returns exactly one run_command tool with only definition fields", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
    });
    const tools = await env.listTools();
    expect(tools).toHaveLength(1);
    // Deep-equal to exactly the definition fields -- also proves permission / maxOutputLength
    // do not leak into the LLM tool definition.
    expect(tools[0]).toEqual({
      name: "run_command",
      description: "Run a shell command in the workspace.",
      parameters: {
        type: "object",
        properties: {
          cmd: { type: "string" },
          workdir: { type: "string" },
        },
        required: ["cmd"],
      },
    });
  });

  it("does not expose configured tools that are not supported by the registry", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [
          execTool(),
          { name: "not_a_registered_tool", description: "unsupported", permission: "r" },
        ],
        mcpServers: [],
      },
    });
    // An unrecognized tool name is neither executable nor exposed to the LLM.
    const tools = await env.listTools();
    expect(tools.map((t) => t.name)).toEqual(["run_command"]);
  });
});

describe("Environment.executeTool — basic file write", () => {
  it("streams start/delta?/stop + final tool_call_output and writes the file", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
    });
    const call = toolCall({
      name: "run_command",
      arguments: JSON.stringify({ cmd: "printf 'Hello, Penguin' > note.txt" }),
      toolCallId: "call_write",
    });

    const messages = await collect(env.executeTool({ toolCall: call }));

    const types = payloadTypes(messages);
    // The first is partial(start), includes one partial(stop), and the last is the complete
    // tool_call_output.
    expect(types[0]).toBe("partial_tool_call_output");
    expect((messages[0]!.payload as { event_type?: string }).event_type).toBe("start");
    expect(types).toContain("partial_tool_call_output");
    const last = messages[messages.length - 1]!;
    expect((last.payload as { type?: string }).type).toBe("tool_call_output");

    // There is a stop partial.
    const hasStop = messages.some(
      (m) =>
        (m.payload as { type?: string }).type === "partial_tool_call_output" &&
        (m.payload as { event_type?: string }).event_type === "stop",
    );
    expect(hasStop).toBe(true);

    // tool_call_id is echoed back as-is; a successful command has stop_reason completed.
    const outPayload = last.payload as {
      tool_call_id: string;
      stop_reason?: string;
    };
    expect(outPayload.tool_call_id).toBe("call_write");
    expect(outPayload.stop_reason).toBe("completed");

    const written = await readFile(path.join(tmp, "note.txt"), "utf8");
    expect(written).toBe("Hello, Penguin");
  });
});

describe("Environment — legacy exec_command alias", () => {
  it("assembles and dispatches a config entry still named exec_command (pre-rename on-disk configs)", async () => {
    // Old agents' system_config.yaml is loaded verbatim, so the entry keeps the old name;
    // the registry alias must route it to the same shell tool under that name.
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ name: "exec_command" })),
    });
    // Exposed to the LLM under the config entry's (legacy) name.
    const tools = await env.listTools();
    expect(tools.map((t) => t.name)).toEqual(["exec_command"]);
    expect(env.toolPermission("exec_command")).toBe("rw");
    // Dispatches by the legacy name and actually runs the command.
    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "printf legacy > legacy.txt" }),
          toolCallId: "call_legacy",
        }),
      }),
    );
    const last = messages[messages.length - 1]!.payload as { type?: string; stop_reason?: string };
    expect(last.type).toBe("tool_call_output");
    expect(last.stop_reason).toBe("completed");
    expect(await readFile(path.join(tmp, "legacy.txt"), "utf8")).toBe("legacy");
  });
});

describe("Environment.executeTool — vault env injection", () => {
  it("injects vault entries into the command env; hardened entries are not overridable", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
      // PAGER is a hardened entry (HARDENED_ENV); a same-named vault entry must not override it.
      vault: { PENGUIN_VAULT_TEST_KEY: "vault-secret-value", PAGER: "less" },
    });
    const call = toolCall({
      name: "run_command",
      arguments: JSON.stringify({ cmd: 'echo "k=$PENGUIN_VAULT_TEST_KEY pager=$PAGER"' }),
      toolCallId: "call_vault",
    });

    const messages = await collect(env.executeTool({ toolCall: call }));
    const last = messages[messages.length - 1]!.payload as { output?: string };
    expect(last.output).toContain("k=vault-secret-value");
    // Injection order is vault -> HARDENED_ENV: the hardened entry wins (settings that prevent
    // an interactive hang must not be overridable).
    expect(last.output).toContain("pager=cat");
    env.dispose();
  });

  it("leaves the command env untouched when no vault is configured", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
    });
    const call = toolCall({
      name: "run_command",
      arguments: JSON.stringify({ cmd: 'echo "k=[$PENGUIN_VAULT_TEST_KEY]"' }),
      toolCallId: "call_no_vault",
    });

    const messages = await collect(env.executeTool({ toolCall: call }));
    const last = messages[messages.length - 1]!.payload as { output?: string };
    expect(last.output).toContain("k=[]");
    env.dispose();
  });
});

describe("Environment.executeTool — edit file", () => {
  it("appends to an existing file", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
    });

    await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "run_command",
          arguments: JSON.stringify({ cmd: "printf 'Hello' > note.txt" }),
          toolCallId: "c1",
        }),
      }),
    );
    await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "run_command",
          arguments: JSON.stringify({ cmd: "printf '!' >> note.txt" }),
          toolCallId: "c2",
        }),
      }),
    );

    const written = await readFile(path.join(tmp, "note.txt"), "utf8");
    expect(written).toBe("Hello!");
  });
});

describe("Environment.executeTool — maxOutputLength truncation", () => {
  it("truncates front-to-back at the limit with a trailing marker; stream == complete", async () => {
    const maxOutputLength = 50;
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ maxOutputLength })),
    });

    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "run_command",
          arguments: JSON.stringify({ cmd: "seq 1 100000" }),
          toolCallId: "call_big",
        }),
      }),
    );

    const last = messages[messages.length - 1]!;
    expect((last.payload as { type?: string }).type).toBe("tool_call_output");
    const output = (last.payload as { output: string }).output;
    // Truncates front-to-back: the head is kept, and the truncation marker is appended at the
    // tail (the marker does not count toward the limit).
    expect(output.startsWith("1\n2\n3\n")).toBe(true);
    const marker = `[output truncated: exceeded ${maxOutputLength} chars]`;
    expect(output).toContain(marker);
    expect(output.length).toBeLessThanOrEqual(maxOutputLength + marker.length + 1);
    // Even when truncated, concatenating the streamed deltas == the complete content (the
    // excess part is never forwarded).
    const streamed = messages
      .filter(
        (m) =>
          (m.payload as { type?: string }).type === "partial_tool_call_output" &&
          (m.payload as { event_type?: string }).event_type === "delta",
      )
      .map((m) => (m.payload as { output?: string }).output ?? "")
      .join("");
    expect(streamed).toBe(output);
  });

  it("maxOutputLength <= 0 disables truncation", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ maxOutputLength: 0 })),
    });
    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "run_command",
          arguments: JSON.stringify({ cmd: "seq 1 100" }),
          toolCallId: "call_nolimit",
        }),
      }),
    );
    const output = (messages[messages.length - 1]!.payload as { output: string }).output;
    expect(output).toContain("100");
    expect(output).not.toContain("[output truncated");
  });
});

describe("Environment.executeTool — relaxed tool contract", () => {
  it("frames a tool that yields bare deltas (no start/stop/complete) and reports via return value", async () => {
    const NAME = "__bare_delta_tool__";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        // New contract: yields only deltas, with no start/stop, no complete message; the
        // finish reason is reported via the return value.
        yield partialToolCallOutput({
          eventType: "delta",
          output: "partial ",
          toolCallId: ctx.toolCallId,
        });
        yield partialToolCallOutput({
          eventType: "delta",
          output: "result",
          toolCallId: ctx.toolCallId,
        });
        return { stopReason: "failed" as const };
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "bare", permission: "rw" }],
          mcpServers: [],
        },
      });
      const out = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "b1" }),
        }),
      );
      // Environment uniformly frames it: start -> delta* -> stop -> complete message.
      expect((out[0]!.payload as { event_type?: string }).event_type).toBe("start");
      const complete = out[out.length - 1]!.payload as {
        type?: string;
        output?: string;
        stop_reason?: string;
      };
      expect(complete.type).toBe("tool_call_output");
      expect(complete.output).toBe("partial result");
      expect(complete.stop_reason).toBe("failed"); // Finish reason reported via the return value
      expect((out[out.length - 2]!.payload as { event_type?: string }).event_type).toBe("stop");
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });

  it("carries ToolResult.images once via a streamed delta before stop, then again on the complete message", async () => {
    const NAME = "__image_tool__";
    const dataUrl = "data:image/png;base64,AAAA";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        // Images are reported via the return value; text deltas stream as usual.
        yield partialToolCallOutput({
          eventType: "delta",
          output: "image/png, 4 B",
          toolCallId: ctx.toolCallId,
        });
        return { images: [dataUrl] };
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "img", permission: "r" }],
          mcpServers: [],
        },
      });
      const out = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "i1" }),
        }),
      );
      const complete = out[out.length - 1]!.payload as {
        type?: string;
        output?: string;
        images?: string[];
        stop_reason?: string;
      };
      expect(complete.type).toBe("tool_call_output");
      expect(complete.stop_reason).toBe("completed");
      expect(complete.output).toBe("image/png, 4 B");
      expect(complete.images).toEqual([dataUrl]);
      // Streamed concatenation == complete message: images are not delta-streamed; they are
      // carried once, whole, by a single delta right before stop.
      const partials = out
        .map((m) => m.payload as { type?: string; event_type?: string; images?: string[] })
        .filter((p) => p.type === "partial_tool_call_output");
      const withImages = partials.filter((p) => p.images !== undefined);
      expect(withImages).toHaveLength(1);
      expect(withImages[0]!.event_type).toBe("delta");
      expect(withImages[0]!.images).toEqual([dataUrl]);
      // The image delta comes immediately before stop (after the text delta).
      expect(partials[partials.length - 1]!.event_type).toBe("stop");
      expect(partials[partials.length - 2]!.images).toEqual([dataUrl]);
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });

  it("drops ToolResult.images when the tool did not complete normally", async () => {
    const NAME = "__failed_image_tool__";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        yield partialToolCallOutput({
          eventType: "delta",
          output: "broken",
          toolCallId: ctx.toolCallId,
        });
        return { stopReason: "failed" as const, images: ["data:image/png;base64,AAAA"] };
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "img", permission: "r" }],
          mcpServers: [],
        },
      });
      const out = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "i2" }),
        }),
      );
      const complete = out[out.length - 1]!.payload as { stop_reason?: string; images?: string[] };
      // Only a normal completion carries images: a failed finish drops them (neither the
      // stream nor the complete message carries them), keeping the finish handling simple.
      expect(complete.stop_reason).toBe("failed");
      expect(complete.images).toBeUndefined();
      for (const m of out) {
        const p = m.payload as { type?: string };
        if (p.type === "partial_tool_call_output") expect("images" in p).toBe(false);
      }
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });

  it("passes origin-tagged nested messages through verbatim, excluded from the tool output", async () => {
    const NAME = "__forwarding_tool__";
    const hop = "sess_child";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        // Nested forwarding: origin-tagged messages pass through verbatim (a child session's
        // complete tool_call_output is not folded into the finish either).
        yield withOrigin(toolCallOutput({ output: "child result", toolCallId: "child_call" }), hop);
        yield partialToolCallOutput({
          eventType: "delta",
          output: "own output",
          toolCallId: ctx.toolCallId,
        });
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "fwd", permission: "rw" }],
          mcpServers: [],
        },
      });
      const out = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "f1" }),
        }),
      );
      // The forwarded nested message keeps its origin and original payload.
      const forwarded = out.find((m) => m.origin?.length);
      expect(forwarded).toBeDefined();
      expect((forwarded!.payload as { output?: string }).output).toBe("child result");
      // This tool's own complete output contains only its own deltas, not mixed with the
      // child session's content.
      const completes = out.filter(
        (m) => !m.origin?.length && (m.payload as { type?: string }).type === "tool_call_output",
      );
      expect(completes).toHaveLength(1);
      expect((completes[0]!.payload as { output?: string }).output).toBe("own output");
      expect((completes[0]!.payload as { stop_reason?: string }).stop_reason).toBe("completed");
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });
});

describe("Environment.executeTool — timeoutMs (PRN-013)", () => {
  it("fails a tool exceeding timeoutMs, keeps prior output, and streams the timeout reason", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ timeoutMs: 200 })),
    });
    const startedAt = Date.now();

    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "run_command",
          arguments: JSON.stringify({ cmd: "echo begin; sleep 5" }),
          toolCallId: "call_timeout",
        }),
      }),
    );

    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeLessThan(3000); // Did not wait the full 5s -> timeout aborts execution

    // A timeout is a failure: stop_reason failed, the timeout reason is written into
    // tool_call_output, and the already-produced output is kept.
    const last = messages[messages.length - 1]!.payload as {
      type: string;
      output: string;
      stop_reason?: string;
    };
    expect(last.type).toBe("tool_call_output");
    expect(last.stop_reason).toBe("failed");
    expect(last.output).toContain("begin");
    expect(last.output).toContain("[tool timeout: exceeded 200ms]");
    // The timeout marker is also produced via streaming: concatenating the streamed deltas ==
    // the complete content.
    const streamed = messages
      .filter(
        (m) =>
          (m.payload as { type?: string }).type === "partial_tool_call_output" &&
          (m.payload as { event_type?: string }).event_type === "delta",
      )
      .map((m) => (m.payload as { output?: string }).output ?? "")
      .join("");
    expect(streamed).toBe(last.output);
  });

  it("user abort takes precedence over a pending timeout (aborted, not failed)", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ timeoutMs: 60000 })),
    });
    const controller = new AbortController();
    const messagesPromise = collect(
      env.executeTool({
        toolCall: toolCall({
          name: "run_command",
          arguments: JSON.stringify({ cmd: "sleep 5" }),
          toolCallId: "call_user_abort",
        }),
        signal: controller.signal,
      }),
    );
    const abortTimer = setTimeout(() => controller.abort(), 100);
    const messages = await messagesPromise;
    clearTimeout(abortTimer);

    const last = messages[messages.length - 1]!.payload as {
      output: string;
      stop_reason?: string;
    };
    expect(last.stop_reason).toBe("aborted");
    expect(last.output).toContain("[interrupted: tool aborted by user]");
  });
});

describe("Environment.executeTool — robustness", () => {
  it("returns an explanatory output for an unknown tool name without throwing", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
    });

    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "not_a_real_tool",
          arguments: "{}",
          toolCallId: "call_unknown",
        }),
      }),
    );

    // Errors are also produced via streaming (renderable by the frontend): start ->
    // delta(explanation) -> stop -> complete message.
    expect(payloadTypes(messages)).toEqual([
      "partial_tool_call_output",
      "partial_tool_call_output",
      "partial_tool_call_output",
      "tool_call_output",
    ]);
    const delta = messages[1]!.payload as { event_type?: string; output?: string };
    expect(delta.event_type).toBe("delta");
    expect(delta.output).toContain("Unknown tool: not_a_real_tool"); // Streamed content includes the explanation
    const payload = messages[3]!.payload as {
      type: string;
      output: string;
      tool_call_id: string;
      stop_reason?: string;
    };
    expect(payload.type).toBe("tool_call_output");
    expect(payload.output).toContain("Unknown tool: not_a_real_tool"); // Complete content matches
    expect(payload.tool_call_id).toBe("call_unknown");
    expect(payload.stop_reason).toBe("failed");
  });

  /** Runs one tool call and returns the payload of the last complete tool_call_output. */
  async function runTool(args: string, toolCallId: string) {
    const env = new Environment({ workspaceDir: tmp, toolConfig: makeToolConfig() });
    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({ name: "run_command", arguments: args, toolCallId }),
      }),
    );
    return messages[messages.length - 1]!.payload as {
      type: string;
      output: string;
      stop_reason?: string;
    };
  }

  it("converges unparsable arguments to an explanatory failed output without throwing", async () => {
    // On the normal path, bad JSON already finishes as malformed at the LLM layer and is
    // retried via reconnect, so it never reaches the Environment; this is the public interface's
    // defensive fallback, uniformly converging to a "not valid JSON" failed output.
    const bad = ["{not valid json", "{'a':1}", '{"a" "b"}', '{"cmd": "echo hi'];
    for (const [i, args] of bad.entries()) {
      const payload = await runTool(args, `call_badjson_${i}`);
      expect(payload.type).toBe("tool_call_output");
      expect(payload.output, args).toContain("not valid JSON");
      expect(payload.stop_reason).toBe("failed");
    }
  });

  it("tells the model the arguments were empty", async () => {
    const payload = await runTool("", "call_emptyargs");
    expect(payload.output).toContain("arguments field is empty");
    expect(payload.stop_reason).toBe("failed");
  });

  it("never returns an empty tool output", async () => {
    // A silently successful command (no stdout/stderr): an empty tool_result would leave the
    // model unable to tell "no output" from "failure".
    const payload = await runTool(JSON.stringify({ cmd: "true" }), "call_silent");
    expect(payload.type).toBe("tool_call_output");
    expect(payload.stop_reason).toBe("completed");
    expect(payload.output).toBe("[no output]");
  });

  it("returns an explanatory output when cmd is missing", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
    });

    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "run_command",
          arguments: JSON.stringify({ workdir: "." }),
          toolCallId: "call_nocmd",
        }),
      }),
    );

    const last = messages[messages.length - 1]!;
    const payload = last.payload as { type: string; output: string };
    expect(payload.type).toBe("tool_call_output");
    expect(payload.output).toContain("Missing required argument");
  });

  it("reports a non-zero exit code in the final output", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
    });

    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "run_command",
          arguments: JSON.stringify({ cmd: "exit 3" }),
          toolCallId: "call_fail",
        }),
      }),
    );

    const last = messages[messages.length - 1]!;
    const payload = last.payload as {
      output: string;
      stop_reason?: string;
    };
    expect(payload.output).toContain("[exit code: 3]");
    expect(payload.stop_reason).toBe("failed");
    // The exit-code marker is also produced via streaming (renderable by the frontend); the
    // streamed deltas concatenated == the complete content (short output here, no truncation).
    const streamed = messages
      .filter(
        (m) =>
          (m.payload as { type?: string }).type === "partial_tool_call_output" &&
          (m.payload as { event_type?: string }).event_type === "delta",
      )
      .map((m) => (m.payload as { output?: string }).output ?? "")
      .join("");
    expect(streamed).toContain("[exit code: 3]");
    expect(streamed).toBe(payload.output);
  });

  it("aborts background children without waiting for inherited pipes", async () => {
    // #23: on interrupt, kill the whole process group -- even though background children
    // inherit the stdout/stderr pipes, they should end immediately on abort rather than
    // waiting for a natural exit (otherwise executeTool would be stuck on unclosed pipes).
    const env = new Environment({ workspaceDir: tmp, toolConfig: makeToolConfig() });
    const controller = new AbortController();
    const startedAt = Date.now();

    const messagesPromise = collect(
      env.executeTool({
        toolCall: toolCall({
          name: "run_command",
          arguments: JSON.stringify({
            cmd: 'node -e "setTimeout(()=>{},5000)" & wait',
          }),
          toolCallId: "call_abort_bg",
        }),
        signal: controller.signal,
      }),
    );
    const abortTimer = setTimeout(() => controller.abort(), 200);
    const messages = await messagesPromise;
    clearTimeout(abortTimer);

    const elapsedMs = Date.now() - startedAt;
    const last = messages[messages.length - 1]!;
    const payload = last.payload as { output: string; stop_reason?: string };
    expect(elapsedMs).toBeLessThan(2000); // Did not wait the full 5s -> the process group was interrupted as a whole
    expect(payload.output).toContain("[interrupted: tool aborted by user");
    expect(payload.stop_reason).toBe("aborted");
  });
});

describe("Environment.toolPermission", () => {
  it("returns the configured permission for a known tool", () => {
    const env = new Environment({
      workspaceDir: "/tmp",
      toolConfig: makeToolConfig(execTool({ permission: "rw" })),
    });
    expect(env.toolPermission("run_command")).toBe("rw");
  });

  it("returns undefined for an unknown tool", () => {
    const env = new Environment({ workspaceDir: "/tmp", toolConfig: makeToolConfig() });
    expect(env.toolPermission("nope")).toBeUndefined();
  });
});

describe("Environment structure invariant on tool throw (PRN-012)", () => {
  it("closes an open partial segment before the failed output when a tool throws mid-stream", async () => {
    // Temporarily register a tool that yields partial(start)+delta then throws, to verify
    // Environment backfills a partial(stop).
    const NAME = "__throwing_test_tool__";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        yield partialToolCallOutput({ eventType: "start", toolCallId: ctx.toolCallId });
        yield partialToolCallOutput({
          eventType: "delta",
          output: "working",
          toolCallId: ctx.toolCallId,
        });
        throw new Error("kaboom");
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "throws", permission: "rw" }],
          mcpServers: [],
        },
      });
      const out = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "z1" }),
        }),
      );
      // start -> delta(working) -> delta(error marker) -> stop -> complete failed output: the
      // error marker is also produced via streaming, and the concatenated streamed fragments
      // match the complete message.
      expect(
        out.map(
          (m) =>
            `${(m.payload as { type?: string }).type}:${(m.payload as { event_type?: string }).event_type ?? ""}`,
        ),
      ).toEqual([
        "partial_tool_call_output:start",
        "partial_tool_call_output:delta",
        "partial_tool_call_output:delta",
        "partial_tool_call_output:stop",
        "tool_call_output:",
      ]);
      const noteDelta = out[2]!.payload as { output?: string };
      expect(noteDelta.output).toContain("kaboom"); // The error marker is produced via a streamed delta
      const stop = out[3]!.payload as { stop_reason?: string };
      expect(stop.stop_reason).toBe("failed");
      const complete = out[4]!.payload as { stop_reason?: string; output?: string };
      expect(complete.stop_reason).toBe("failed");
      expect(complete.output).toContain("kaboom");
      expect(complete.output).toContain("working"); // Keeps the partial content already streamed.
      // Concatenating the streamed deltas == the complete content (relevant for frontend rendering).
      const streamedText = out
        .filter(
          (m) =>
            (m.payload as { type?: string }).type === "partial_tool_call_output" &&
            (m.payload as { event_type?: string }).event_type === "delta",
        )
        .map((m) => (m.payload as { output?: string }).output ?? "")
        .join("");
      expect(streamedText).toBe(complete.output);
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });
});

describe("Environment abort handling (interrupt -> aborted, PRN-012)", () => {
  it("labels a thrown error as aborted (not failed) when the signal is aborted", async () => {
    const NAME = "__abort_throw_tool__";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        yield partialToolCallOutput({ eventType: "start", toolCallId: ctx.toolCallId });
        yield partialToolCallOutput({
          eventType: "delta",
          output: "partial",
          toolCallId: ctx.toolCallId,
        });
        // Simulates a throw caused by an interrupt (e.g. an underlying operation throwing AbortError).
        throw new Error("aborted mid-run");
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "throws", permission: "rw" }],
          mcpServers: [],
        },
      });
      const controller = new AbortController();
      controller.abort();
      const out = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "z1" }),
          signal: controller.signal,
        }),
      );
      // The structure is closed, and the interrupt maps to aborted (crucially: not failed).
      const stop = out.find(
        (m) =>
          (m.payload as { type?: string }).type === "partial_tool_call_output" &&
          (m.payload as { event_type?: string }).event_type === "stop",
      )!.payload as { stop_reason?: string };
      expect(stop.stop_reason).toBe("aborted");
      const complete = out.find(
        (m) => (m.payload as { type?: string }).type === "tool_call_output",
      )!.payload as { stop_reason?: string; output?: string };
      expect(complete.stop_reason).toBe("aborted");
      expect(complete.output).toContain("interrupted");
      expect(complete.output).toContain("partial"); // Keeps the partial content already streamed.
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });

  it("relabels a completed output as aborted when the signal is aborted, even if the tool did not self-report it", async () => {
    const NAME = "__abort_noselfreport_tool__";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        // The tool does not self-report aborted, and only yields one ordinary complete output.
        yield toolCallOutput({ output: "done anyway", toolCallId: ctx.toolCallId });
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "ok", permission: "rw" }],
          mcpServers: [],
        },
      });
      const controller = new AbortController();
      controller.abort();
      const out = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "z2" }),
          signal: controller.signal,
        }),
      );
      const complete = out.find(
        (m) => (m.payload as { type?: string }).type === "tool_call_output",
      )!.payload as { stop_reason?: string; output?: string };
      // Environment finalizes aborted based on the signal it holds, keeping the tool's
      // already-produced content and appending the interrupt notice.
      expect(complete.stop_reason).toBe("aborted");
      expect(complete.output).toContain("done anyway");
      expect(complete.output).toContain("interrupted");
      // Even when the tool yields only a complete message (no streaming), the whole content is
      // backfilled as a stream: concatenating the streamed deltas == the complete content.
      const streamed = out
        .filter(
          (m) =>
            (m.payload as { type?: string }).type === "partial_tool_call_output" &&
            (m.payload as { event_type?: string }).event_type === "delta",
        )
        .map((m) => (m.payload as { output?: string }).output ?? "")
        .join("");
      expect(streamed).toBe(complete.output);
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });

  it("streams full content when a tool emits start + a content-bearing complete but no delta, then is aborted (stream == complete, no separator drift)", async () => {
    const NAME = "__abort_bufferonly_tool__";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        // An internally-buffering tool: yields start, produces no delta, and directly gives
        // one complete message with content.
        yield partialToolCallOutput({ eventType: "start", toolCallId: ctx.toolCallId });
        yield toolCallOutput({ output: "buffered result", toolCallId: ctx.toolCallId });
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "x", permission: "rw" }],
          mcpServers: [],
        },
      });
      const controller = new AbortController();
      controller.abort();
      const out = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "z3" }),
          signal: controller.signal,
        }),
      );
      const complete = out.find(
        (m) => (m.payload as { type?: string }).type === "tool_call_output",
      )!.payload as { stop_reason?: string; output?: string };
      expect(complete.stop_reason).toBe("aborted");
      expect(complete.output).toContain("buffered result");
      expect(complete.output).toContain("interrupted");
      // Key point: tool content that was never streamed is backfilled as a whole; concatenating
      // the streamed deltas == the complete content (no separator misalignment).
      const streamed = out
        .filter(
          (m) =>
            (m.payload as { type?: string }).type === "partial_tool_call_output" &&
            (m.payload as { event_type?: string }).event_type === "delta",
        )
        .map((m) => (m.payload as { output?: string }).output ?? "")
        .join("");
      expect(streamed).toBe(complete.output);
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });

  it("emits exactly one complete output (== streamed) with a trailing stop when a tool yields only partials and returns", async () => {
    const NAME = "__no_complete_tool__";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        yield partialToolCallOutput({ eventType: "start", toolCallId: ctx.toolCallId });
        yield partialToolCallOutput({
          eventType: "delta",
          output: "partial only",
          toolCallId: ctx.toolCallId,
        });
        // Does not yield a complete tool_call_output, and just returns (fallback path).
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "x", permission: "rw" }],
          mcpServers: [],
        },
      });
      const out = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "z4" }),
        }),
      );
      // The fallback still guarantees exactly one complete tool_call_output (keeping
      // tool_use/result paired), with content == what was already streamed.
      const completes = out.filter(
        (m) => (m.payload as { type?: string }).type === "tool_call_output",
      );
      expect(completes).toHaveLength(1);
      expect((completes[0]!.payload as { output?: string }).output).toBe("partial only");
      // The last is the complete message, immediately preceded by a stop.
      expect((out[out.length - 1]!.payload as { type?: string }).type).toBe("tool_call_output");
      expect((out[out.length - 2]!.payload as { event_type?: string }).event_type).toBe("stop");
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });
});
