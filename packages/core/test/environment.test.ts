import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Environment } from "../src/environment/index.js";
import { TruncatedToolOutputCapture } from "../src/environment/truncated-tool-output-archive.js";
import {
  partialToolCallOutput,
  toolCall,
  toolCallOutput,
  withOrigin,
} from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import { BUILTIN_TOOL_FACTORIES } from "../src/environment/tools/registry.js";
import type { ToolConfig, ToolDefinitionConfig } from "../src/interfaces/index.js";

/** Tool config for exec_command (permission/maxOutputLength adjustable). */
function execTool(overrides: Partial<ToolDefinitionConfig> = {}): ToolDefinitionConfig {
  return {
    name: "exec_command",
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

/**
 * Reads a file the shell just wrote, retrying briefly until it holds `expected`.
 *
 * The tool completes when the shell process exits, which does not promise the write is visible
 * to this process yet — on Windows CI it intermittently is not. Retrying asserts the same exact
 * content, it just stops the assertion from racing the filesystem; a genuinely wrong write
 * still fails, one timeout later, with the last value read.
 */
async function readFileEventually(
  file: string,
  expected: string,
  timeoutMs = 2000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    last = await readFile(file, "utf8").catch(() => "");
    if (last === expected || Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
}

function payloadTypes(messages: OmniMessage[]): string[] {
  return messages.map((m) => (m.payload as { type?: string }).type ?? "");
}

/** Extracts the plain archive path from the note (the path is always last before `]`). */
function recoveryPath(output: string): string | undefined {
  return output.match(/\[output archived[^:]*: ([^\]]+)\]/)?.[1];
}

let tmp: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-env-"));
  // exec_command runs via a `bash -l` login shell (product behavior): a login shell loads the
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
  // Retries: on Windows a just-killed process tree releases its cwd/file locks asynchronously,
  // so an immediate recursive rm can hit EBUSY; fs.rm retries those with a linear backoff.
  await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("Environment.listTools", () => {
  it("returns exactly one exec_command tool with only definition fields", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
    });
    const tools = await env.listTools();
    expect(tools).toHaveLength(1);
    // Deep-equal to exactly the definition fields -- also proves permission / maxOutputLength
    // do not leak into the LLM tool definition.
    expect(tools[0]).toEqual({
      name: "exec_command",
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
    expect(tools.map((t) => t.name)).toEqual(["exec_command"]);
  });
});

describe("Environment.executeTool — basic file write", () => {
  it("streams start/delta?/stop + final tool_call_output and writes the file", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
    });
    const call = toolCall({
      name: "exec_command",
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

    const written = await readFileEventually(path.join(tmp, "note.txt"), "Hello, Penguin");
    expect(written).toBe("Hello, Penguin");
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
      name: "exec_command",
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

  it("reconfigure replaces the toolset and the vault as a whole; commands spawned afterwards see the new vault", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
      vault: { PENGUIN_VAULT_TEST_KEY: "old-value" },
    });
    try {
      expect((await env.listTools()).map((t) => t.name)).toEqual(["exec_command"]);

      // A context without exec_command: the tool is neither listed nor executable.
      env.reconfigure({ toolConfig: { customTools: [], mcpServers: [] }, vault: {} });
      expect(await env.listTools()).toEqual([]);
      expect(env.toolPermission("exec_command")).toBeUndefined();
      const gone = await collect(
        env.executeTool({
          toolCall: toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "echo nope" }),
            toolCallId: "call_gone",
          }),
        }),
      );
      expect((gone[gone.length - 1]!.payload as { output?: string }).output).toContain(
        "Unknown tool: exec_command",
      );

      // Re-equipped with the tool and a new vault: a command spawned now carries the new
      // values (and only those — the replaced entry is gone, not merged).
      env.reconfigure({
        toolConfig: makeToolConfig(),
        vault: { PENGUIN_VAULT_TEST_KEY: "new-value", PENGUIN_VAULT_ADDED: "added" },
      });
      expect(env.toolPermission("exec_command")).toBe("rw");
      const messages = await collect(
        env.executeTool({
          toolCall: toolCall({
            name: "exec_command",
            arguments: JSON.stringify({
              cmd: 'echo "k=$PENGUIN_VAULT_TEST_KEY added=$PENGUIN_VAULT_ADDED"',
            }),
            toolCallId: "call_revault",
          }),
        }),
      );
      const last = messages[messages.length - 1]!.payload as { output?: string };
      expect(last.output).toContain("k=new-value added=added");

      // An empty vault clears it (the vault is replaced as a whole, never merged).
      env.reconfigure({ toolConfig: makeToolConfig(), vault: {} });
      const cleared = await collect(
        env.executeTool({
          toolCall: toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: 'echo "k=[$PENGUIN_VAULT_TEST_KEY]"' }),
            toolCallId: "call_cleared",
          }),
        }),
      );
      expect((cleared[cleared.length - 1]!.payload as { output?: string }).output).toContain(
        "k=[]",
      );
    } finally {
      env.dispose();
    }
  });

  it("leaves the command env untouched when no vault is configured", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(),
    });
    const call = toolCall({
      name: "exec_command",
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
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "printf 'Hello' > note.txt" }),
          toolCallId: "c1",
        }),
      }),
    );
    await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "printf '!' >> note.txt" }),
          toolCallId: "c2",
        }),
      }),
    );

    expect(await readFileEventually(path.join(tmp, "note.txt"), "Hello!")).toBe("Hello!");
  });
});

describe("Environment.executeTool — maxOutputLength truncation", () => {
  it("keeps standalone Environment truncation-only (head and tail windows, no archive) without scratchpad config", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ maxOutputLength: 5 })),
    });
    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "printf 'abcdefghijklmnopqrstuvwxyz'" }),
          toolCallId: "call_standalone_truncation",
        }),
      }),
    );
    const output = (messages[messages.length - 1]!.payload as { output: string }).output;
    // Budget 5 splits into a 2-char head and a 3-char tail around the counting marker.
    expect(output).toBe("ab\n[output truncated: kept first 2 and last 3 of 26 chars]\nxyz");
    expect(output).not.toContain("[output archived:");
  });

  it("keeps head and tail windows, archives the received output, and keeps stream == complete", async () => {
    const maxOutputLength = 50;
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ maxOutputLength })),
      sessionScratchpadDir: path.join(tmp, "scratch"),
    });

    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "seq 1 100000" }),
          toolCallId: "call_big",
        }),
      }),
    );

    const last = messages[messages.length - 1]!;
    expect((last.payload as { type?: string }).type).toBe("tool_call_output");
    const output = (last.payload as { output: string }).output;
    // The budget splits into head and tail windows around a marker carrying kept and total
    // counts (the marker and notes do not count toward the limit).
    expect(output.startsWith("1\n2\n3\n")).toBe(true);
    const marker = output.match(/\[output truncated: kept first 25 and last 25 of (\d+) chars\]/);
    expect(marker).not.toBeNull();
    expect(output.indexOf(marker![0])).toBe(26); // right after the 25-char head + newline
    // The tail window surfaces the end of the run without reading the archive.
    expect(output).toContain("100000");
    const savedPath = recoveryPath(output);
    expect(savedPath).toBeDefined();
    const archived = await readFile(savedPath!, "utf8");
    expect(archived).toMatch(/100000\r?\n$/);
    // The marker's total equals the full text the archive preserved (ASCII: chars == bytes).
    expect(Number(marker![1])).toBe(archived.length);
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
    const sessionScratchpadDir = path.join(tmp, "scratch");
    const truncatedToolOutputRoot = path.join(sessionScratchpadDir, "truncated-tool-output");
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ maxOutputLength: 0 })),
      sessionScratchpadDir,
    });
    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "seq 1 100" }),
          toolCallId: "call_nolimit",
        }),
      }),
    );
    const output = (messages[messages.length - 1]!.payload as { output: string }).output;
    expect(output).toContain("100");
    expect(output).not.toContain("[output truncated");
    await expect(access(truncatedToolOutputRoot)).rejects.toThrow();
  });

  it("saves exact overflow for the Session without changing stream == complete", async () => {
    const maxOutputLength = 50;
    const workspaceDir = path.join(tmp, "workspace");
    await mkdir(workspaceDir);
    const sessionScratchpadDir = path.join(tmp, "session-scratchpad");
    const truncatedToolOutputRoot = path.join(sessionScratchpadDir, "truncated-tool-output");
    const toolConfig: ToolConfig = {
      customTools: [
        execTool({ maxOutputLength }),
        {
          name: "read_file",
          description: "Read a text file.",
          permission: "r",
          maxOutputLength: 64_000,
        },
      ],
      mcpServers: [],
    };
    const env = new Environment({
      workspaceDir,
      toolConfig,
      sessionScratchpadDir,
    });
    const expected = `BEGIN\n${"x".repeat(200)}\nEND\n`;
    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: `node -e ${JSON.stringify(`process.stdout.write(${JSON.stringify(expected)})`)}`,
          }),
          toolCallId: "call_recoverable",
        }),
      }),
    );

    const complete = messages[messages.length - 1]!.payload as {
      output: string;
      stop_reason?: string;
    };
    expect(complete.stop_reason).toBe("completed");
    expect(complete.output.startsWith(expected.slice(0, 25))).toBe(true);
    expect(complete.output).toContain(
      `[output truncated: kept first 25 and last 25 of ${expected.length} chars]`,
    );
    // The visible tail window carries the end of the output.
    expect(complete.output).toContain("\nEND\n");
    const savedPath = recoveryPath(complete.output);
    expect(savedPath).toBeDefined();
    if (process.platform === "win32") {
      expect(savedPath).not.toContain("\\");
    }
    expect(await readFile(savedPath!, "utf8")).toBe(expected);
    if (process.platform !== "win32") {
      expect((await stat(savedPath!)).mode & 0o777).toBe(0o600);
    }

    const streamed = messages
      .filter(
        (m) =>
          (m.payload as { type?: string }).type === "partial_tool_call_output" &&
          (m.payload as { event_type?: string }).event_type === "delta",
      )
      .map((m) => (m.payload as { output?: string }).output ?? "")
      .join("");
    // Core product invariant: Web/CLI consume this stream, while the Agent receives the
    // complete result. The archive path is present identically on both sides.
    expect(streamed).toBe(complete.output);

    // The production recovery directory is outside the Workspace. Pin that the existing
    // read_file tool accepts the absolute path, so no dedicated recovery tool is needed.
    const readMessages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "read_file",
          arguments: JSON.stringify({ file_path: savedPath }),
          toolCallId: "read_recovery",
        }),
      }),
    );
    const readOutput = (readMessages[readMessages.length - 1]!.payload as { output: string })
      .output;
    expect(readOutput).toContain("BEGIN");
    expect(readOutput).toContain("END");

    env.dispose();
    expect(await readFile(savedPath!, "utf8")).toBe(expected);
    await expect(access(truncatedToolOutputRoot)).resolves.toBeUndefined();

    // Resuming the Session creates a fresh Environment over the same scratchpad. The path
    // recorded in Trace must still work with the ordinary read_file tool.
    const resumedEnv = new Environment({
      workspaceDir,
      toolConfig,
      sessionScratchpadDir,
    });
    const resumedRead = await collect(
      resumedEnv.executeTool({
        toolCall: toolCall({
          name: "read_file",
          arguments: JSON.stringify({ file_path: savedPath }),
          toolCallId: "read_after_resume",
        }),
      }),
    );
    expect((resumedRead[resumedRead.length - 1]!.payload as { output: string }).output).toContain(
      "END",
    );
    resumedEnv.dispose();
  });

  it("does not create a Session output directory for a result that fits the visible limit", async () => {
    const sessionScratchpadDir = path.join(tmp, "scratch");
    const truncatedToolOutputRoot = path.join(sessionScratchpadDir, "truncated-tool-output");
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ maxOutputLength: 100 })),
      sessionScratchpadDir,
    });
    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "printf short" }),
          toolCallId: "call_short",
        }),
      }),
    );
    const output = (messages[messages.length - 1]!.payload as { output: string }).output;
    expect(output).not.toContain("[output archived:");
    await expect(access(truncatedToolOutputRoot)).rejects.toThrow();
  });

  it("keeps the original tool outcome when the recovery file cannot be written", async () => {
    const sessionScratchpadDir = path.join(tmp, "scratchpad-is-a-file");
    await writeFile(sessionScratchpadDir, "occupied", "utf8");
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ maxOutputLength: 20 })),
      sessionScratchpadDir,
    });
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    let messages: OmniMessage[];
    try {
      messages = await collect(
        env.executeTool({
          toolCall: toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "printf 'abcdefghijklmnopqrstuvwxyz'" }),
            toolCallId: "call_archive_failure",
          }),
        }),
      );
    } finally {
      stderrSpy.mockRestore();
    }
    const complete = messages[messages.length - 1]!.payload as {
      output: string;
      stop_reason?: string;
    };
    expect(complete.output).toMatch(/\[output archive failed: [^\]]+\]/);
    expect(complete.stop_reason).toBe("completed");
    expect(stderr.join("")).toMatch(
      /\[penguin\] tool "exec_command" truncated output archive write failed \([^)]+\)\./,
    );
    const streamed = messages
      .filter(
        (m) =>
          (m.payload as { type?: string }).type === "partial_tool_call_output" &&
          (m.payload as { event_type?: string }).event_type === "delta",
      )
      .map((m) => (m.payload as { output?: string }).output ?? "")
      .join("");
    expect(streamed).toBe(complete.output);
  });

  it("freezes the completed outcome before auxiliary archive I/O", async () => {
    const controller = new AbortController();
    const originalSave = TruncatedToolOutputCapture.prototype.save;
    const saveSpy = vi
      .spyOn(TruncatedToolOutputCapture.prototype, "save")
      .mockImplementation(function (this: TruncatedToolOutputCapture, toolName, toolCallId) {
        // The tool has already reached its terminal state when save() starts. This late abort
        // must not retroactively turn a completed tool into an aborted one.
        controller.abort();
        return originalSave.call(this, toolName, toolCallId);
      });
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ maxOutputLength: 5 })),
      sessionScratchpadDir: path.join(tmp, "scratch"),
    });
    try {
      const messages = await collect(
        env.executeTool({
          toolCall: toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "printf 'abcdefghijklmnopqrstuvwxyz'" }),
            toolCallId: "call_late_abort",
          }),
          signal: controller.signal,
        }),
      );
      const complete = messages[messages.length - 1]!.payload as {
        output: string;
        stop_reason?: string;
      };
      expect(saveSpy).toHaveBeenCalledOnce();
      expect(controller.signal.aborted).toBe(true);
      expect(complete.stop_reason).toBe("completed");
      expect(complete.output).toContain("[output archived:");
      expect(complete.output).not.toContain("[interrupted: tool aborted by user]");
    } finally {
      saveSpy.mockRestore();
    }
  });

  it("bounds a very large archive and preserves its UTF-8 head and tail", async () => {
    const NAME = "__large_text_tool__";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        yield partialToolCallOutput({
          eventType: "delta",
          output: "BEGIN-企鹅\n",
          toolCallId: ctx.toolCallId,
        });
        yield partialToolCallOutput({
          eventType: "delta",
          output: "x".repeat(8 * 1024 * 1024 + 100_000),
          toolCallId: ctx.toolCallId,
        });
        yield partialToolCallOutput({
          eventType: "delta",
          output: "\n-END-🐧",
          toolCallId: ctx.toolCallId,
        });
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "large", permission: "r", maxOutputLength: 50 }],
          mcpServers: [],
        },
        sessionScratchpadDir: path.join(tmp, "scratch"),
      });
      const messages = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "call_huge" }),
        }),
      );
      const complete = messages[messages.length - 1]!.payload as { output: string };
      expect(complete.output).toContain("head and tail kept");
      // The visible tail window ends with the intact trailing surrogate pair.
      expect(complete.output).toContain("-END-🐧");
      const savedPath = recoveryPath(complete.output);
      expect(savedPath).toBeDefined();
      const archived = await readFile(savedPath!, "utf8");
      expect(Buffer.byteLength(archived, "utf8")).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(archived).toContain("BEGIN-企鹅");
      expect(archived).toContain("-END-🐧");
      expect(archived).toContain("[archive middle truncated]");
      expect(archived).not.toContain("\uFFFD");
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });

  it("recovers a compatibility tool that returns only a complete message", async () => {
    const NAME = "__complete_message_tool__";
    const source = `COMPLETE-ONLY-${"z".repeat(100)}-END`;
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        yield toolCallOutput({
          output: source,
          toolCallId: ctx.toolCallId,
          stopReason: "completed",
        });
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [
            { name: NAME, description: "complete", permission: "r", maxOutputLength: 20 },
          ],
          mcpServers: [],
        },
        sessionScratchpadDir: path.join(tmp, "scratch"),
      });
      const messages = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "complete-only" }),
        }),
      );
      const complete = messages[messages.length - 1]!.payload as {
        output: string;
        stop_reason?: string;
      };
      const savedPath = recoveryPath(complete.output);
      expect(savedPath).toBeDefined();
      expect(await readFile(savedPath!, "utf8")).toBe(source);
      // The full-message basis gets the same head/tail windows as the streamed path.
      expect(complete.output.startsWith(source.slice(0, 10))).toBe(true);
      expect(complete.output).toContain(
        `[output truncated: kept first 10 and last 10 of ${source.length} chars]`,
      );
      expect(complete.output).toContain("-END");
      expect(complete.stop_reason).toBe("completed");
      const streamed = messages
        .filter(
          (m) =>
            (m.payload as { type?: string }).type === "partial_tool_call_output" &&
            (m.payload as { event_type?: string }).event_type === "delta",
        )
        .map((m) => (m.payload as { output?: string }).output ?? "")
        .join("");
      expect(streamed).toBe(complete.output);
      env.dispose();
      expect(await readFile(savedPath!, "utf8")).toBe(source);
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });

  it("flushes withheld text verbatim when the total stays within budget", async () => {
    const NAME = "__band_tool__";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        for (const piece of ["alpha-", "beta-", "gamma"]) {
          yield partialToolCallOutput({
            eventType: "delta",
            output: piece,
            toolCallId: ctx.toolCallId,
          });
        }
      },
    });
    try {
      const sessionScratchpadDir = path.join(tmp, "scratch");
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "band", permission: "r", maxOutputLength: 20 }],
          mcpServers: [],
        },
        sessionScratchpadDir,
      });
      const messages = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "band" }),
        }),
      );
      const complete = messages[messages.length - 1]!.payload as {
        output: string;
        stop_reason?: string;
      };
      // 16 chars: past the 10-char head window but within the 20-char budget. The part past the
      // head arrives as a finalization flush — complete result, no marker, no archive.
      expect(complete.output).toBe("alpha-beta-gamma");
      expect(complete.stop_reason).toBe("completed");
      await expect(
        access(path.join(sessionScratchpadDir, "truncated-tool-output")),
      ).rejects.toThrow();
      const streamed = messages
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

  it("keeps surrogate pairs whole at both window cuts", async () => {
    const NAME = "__surrogate_cut_tool__";
    // Budget 8 → 4-char head, 4-char tail. The first delta ends exactly at the head window with
    // a high surrogate; its low half arrives in the next delta together with the overflow.
    const deltas = ["abc\ud83d", `\udc27${"x".repeat(20)}`];
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        for (const piece of deltas) {
          yield partialToolCallOutput({
            eventType: "delta",
            output: piece,
            toolCallId: ctx.toolCallId,
          });
        }
      },
    });
    try {
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [
            { name: NAME, description: "surrogate", permission: "r", maxOutputLength: 8 },
          ],
          mcpServers: [],
        },
        sessionScratchpadDir: path.join(tmp, "scratch"),
      });
      const messages = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "surrogate" }),
        }),
      );
      const complete = messages[messages.length - 1]!.payload as { output: string };
      // The pairable high surrogate is withheld instead of closing the head, so the visible
      // result carries no half characters; the dropped pair stays intact in the archive.
      expect(complete.output).toContain("[output truncated: kept first 3 and last 4 of 25 chars]");
      expect(/[\ud800-\udfff]/.test(complete.output)).toBe(false);
      const savedPath = recoveryPath(complete.output);
      expect(savedPath).toBeDefined();
      expect(await readFile(savedPath!, "utf8")).toBe("abc🐧" + "x".repeat(20));
      const streamed = messages
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
        return { stopReason: "fatal" as const };
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
      expect(complete.stop_reason).toBe("fatal"); // Finish reason reported via the return value
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
        return { stopReason: "fatal" as const, images: ["data:image/png;base64,AAAA"] };
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
      expect(complete.stop_reason).toBe("fatal");
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
    const childOutput = "child result ".repeat(100);
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        // Nested forwarding: origin-tagged messages pass through verbatim (a child session's
        // complete tool_call_output is not folded into the finish either).
        yield withOrigin(toolCallOutput({ output: childOutput, toolCallId: "child_call" }), hop);
        yield partialToolCallOutput({
          eventType: "delta",
          output: "own output",
          toolCallId: ctx.toolCallId,
        });
      },
    });
    try {
      const sessionScratchpadDir = path.join(tmp, "scratch");
      const truncatedToolOutputRoot = path.join(sessionScratchpadDir, "truncated-tool-output");
      const env = new Environment({
        workspaceDir: tmp,
        toolConfig: {
          customTools: [{ name: NAME, description: "fwd", permission: "rw", maxOutputLength: 10 }],
          mcpServers: [],
        },
        sessionScratchpadDir,
      });
      const out = await collect(
        env.executeTool({
          toolCall: toolCall({ name: NAME, arguments: "{}", toolCallId: "f1" }),
        }),
      );
      // The forwarded nested message keeps its origin and original payload.
      const forwarded = out.find((m) => m.origin?.length);
      expect(forwarded).toBeDefined();
      expect((forwarded!.payload as { output?: string }).output).toBe(childOutput);
      // This tool's own complete output contains only its own deltas, not mixed with the
      // child session's content.
      const completes = out.filter(
        (m) => !m.origin?.length && (m.payload as { type?: string }).type === "tool_call_output",
      );
      expect(completes).toHaveLength(1);
      expect((completes[0]!.payload as { output?: string }).output).toBe("own output");
      expect((completes[0]!.payload as { stop_reason?: string }).stop_reason).toBe("completed");
      // The oversized child result belongs to the child's Session. The parent's own
      // output fits exactly, so the parent must not create a duplicate recovery archive.
      await expect(access(truncatedToolOutputRoot)).rejects.toThrow();
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });
});

describe("Environment.executeTool — timeoutMs (PRN-013)", () => {
  it("fails a tool exceeding timeoutMs, keeps prior output, and streams the timeout reason", async () => {
    // The timeout must stay below MIN_YIELD_MS (250): for larger values exec_command yields to
    // background (with a process_id) before the Environment timeout can ever fire.
    const timeoutMs = 200;
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: makeToolConfig(execTool({ timeoutMs })),
    });
    const startedAt = Date.now();

    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "exec_command",
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
    expect(last.stop_reason).toBe("fatal");
    // Kept-prior-output is asserted only where the shell can win the race: a Git-Bash login
    // shell on Windows needs several hundred ms to start, so nothing is printed before a
    // sub-250ms timeout there — the timeout mechanics above are still fully exercised.
    if (process.platform !== "win32") {
      expect(last.output).toContain("begin");
    }
    expect(last.output).toContain(`[tool timeout: exceeded ${timeoutMs}ms]`);
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
          name: "exec_command",
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

describe("Environment — stored entries for tools removed since (read_image / describe_image)", () => {
  it("skips them at assembly: not listed to the model, and a call by the old name gets the unknown-tool reply", async () => {
    const stale: ToolDefinitionConfig[] = [
      { name: "read_image", description: "old", forModel: "vision", permission: "r" },
      { name: "describe_image", description: "old", forModel: "text-only", permission: "r" },
    ];
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [execTool(), ...stale], mcpServers: [] },
    });
    expect((await env.listTools()).map((t) => t.name)).toEqual(["exec_command"]);
    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({
          name: "read_image",
          arguments: '{"source":"a.png"}',
          toolCallId: "call_stale",
        }),
      }),
    );
    const last = messages[messages.length - 1]!.payload as { output: string; stop_reason?: string };
    expect(last.stop_reason).toBe("fatal");
    expect(last.output).toContain("Unknown tool: read_image");
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
    expect(payload.stop_reason).toBe("fatal");
  });

  /** Runs one tool call and returns the payload of the last complete tool_call_output. */
  async function runTool(args: string, toolCallId: string) {
    const env = new Environment({ workspaceDir: tmp, toolConfig: makeToolConfig() });
    const messages = await collect(
      env.executeTool({
        toolCall: toolCall({ name: "exec_command", arguments: args, toolCallId }),
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
      expect(payload.stop_reason).toBe("fatal");
    }
  });

  it("tells the model the arguments were empty", async () => {
    const payload = await runTool("", "call_emptyargs");
    expect(payload.output).toContain("arguments field is empty");
    expect(payload.stop_reason).toBe("fatal");
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
          name: "exec_command",
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
          name: "exec_command",
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
    expect(payload.stop_reason).toBe("fatal");
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
          name: "exec_command",
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
      workspaceDir: tmpdir(),
      toolConfig: makeToolConfig(execTool({ permission: "rw" })),
    });
    expect(env.toolPermission("exec_command")).toBe("rw");
  });

  it("returns undefined for an unknown tool", () => {
    const env = new Environment({ workspaceDir: tmpdir(), toolConfig: makeToolConfig() });
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
      expect(stop.stop_reason).toBe("fatal");
      const complete = out[4]!.payload as { stop_reason?: string; output?: string };
      expect(complete.stop_reason).toBe("fatal");
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
