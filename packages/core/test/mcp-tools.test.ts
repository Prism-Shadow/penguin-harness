import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";
import { Environment } from "../src/environment/index.js";
import { McpToolProvider, renderCallToolResult } from "../src/environment/mcp/provider.js";
import { Session } from "../src/session.js";
import { assistantText, toolCall, userText } from "../src/omnimessage/index.js";
import type { OmniMessage, SessionMetaPayload } from "../src/omnimessage/index.js";
import type { LLMInterface, LLMOutcome, MCPServerConfig } from "../src/interfaces/index.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url));

/** A `tools.mcpServers` entry spawning the stdio fixture, with optional extra config fields. */
function fixtureEntry(extra: Record<string, unknown> = {}): MCPServerConfig {
  return { name: "fx", config: { command: process.execPath, args: [FIXTURE], ...extra } };
}

/**
 * Removes a test dir, retrying transient Windows locks: the dir is the stdio server child's
 * cwd, `dispose()` kills that child fire-and-forget, and Windows keeps a directory locked
 * (EBUSY/EPERM on rmdir) while it is any live process's working directory — the lock lifts
 * once the child finishes exiting. A genuinely stuck dir still fails, one deadline later.
 */
async function rmEventually(dir: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM";
      if (!transient || Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function collect(gen: AsyncGenerator<OmniMessage>): Promise<OmniMessage[]> {
  const out: OmniMessage[] = [];
  for await (const msg of gen) out.push(msg);
  return out;
}

interface FinalPayload {
  type?: string;
  output?: string;
  stop_reason?: string;
  images?: string[];
}

function finalPayload(messages: OmniMessage[]): FinalPayload {
  return messages[messages.length - 1]!.payload as FinalPayload;
}

/** Joins the streamed content deltas (to compare against the complete message). */
function streamedText(messages: OmniMessage[]): string {
  return messages
    .map((m) => m.payload as { type?: string; event_type?: string; output?: string })
    .filter((p) => p.type === "partial_tool_call_output" && p.event_type === "delta")
    .map((p) => p.output ?? "")
    .join("");
}

function runTool(
  env: Environment,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<OmniMessage[]> {
  const call = toolCall({ name, arguments: JSON.stringify(args), toolCallId: "mcp-call-1" });
  return collect(env.executeTool({ toolCall: call, ...(signal ? { signal } : {}) }));
}

describe("renderCallToolResult", () => {
  it("maps the block types and falls back to structuredContent only when there is no text", () => {
    expect(
      renderCallToolResult({
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
          { type: "audio", data: "BBBB", mimeType: "audio/wav" },
          { type: "resource_link", uri: "file:///x", name: "x", description: "a file" },
          { type: "resource", resource: { uri: "mem://t", text: "embedded" } },
          { type: "resource", resource: { uri: "mem://b", blob: "CCCC" } },
        ],
        structuredContent: { ignored: true },
      }),
    ).toEqual({
      text: [
        "hello",
        "[audio content: audio/wav]",
        "[resource: file:///x] a file",
        "embedded",
        "[resource: mem://b (binary)]",
      ].join("\n"),
      images: ["data:image/png;base64,AAAA"],
    });

    expect(renderCallToolResult({ content: [], structuredContent: { a: 1 } })).toEqual({
      text: JSON.stringify({ a: 1 }, null, 2),
      images: [],
    });
  });
});

describe("MCP over stdio through Environment", () => {
  let tmp: string;
  let env: Environment;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-")));
    env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [fixtureEntry()] },
      vault: { FIXTURE_SECRET: "from-vault" },
    });
  });

  afterAll(async () => {
    env.dispose();
    await rmEventually(tmp);
  }, 30_000);

  it("lists discovered tools under prefixed names with their schemas", async () => {
    const tools = await env.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "mcp__fx__echo",
      "mcp__fx__fail",
      "mcp__fx__pic",
      "mcp__fx__slow",
      "mcp__fx__probe",
      "mcp__fx__spam",
    ]);
    const echo = tools.find((t) => t.name === "mcp__fx__echo")!;
    expect(echo.description).toBe("Echoes back the input text.");
    const params = echo.parameters as { type?: string; properties?: Record<string, unknown> };
    expect(params.type).toBe("object");
    expect(Object.keys(params.properties ?? {})).toContain("text");
  });

  it("executes a call with Environment framing; streamed deltas equal the complete message", async () => {
    const messages = await runTool(env, "mcp__fx__echo", { text: "hi" });
    const first = messages[0]!.payload as { type?: string; event_type?: string };
    expect(first.type).toBe("partial_tool_call_output");
    expect(first.event_type).toBe("start");
    const final = finalPayload(messages);
    expect(final.type).toBe("tool_call_output");
    expect(final.stop_reason).toBe("completed");
    expect(final.output).toBe("echo: hi");
    expect(streamedText(messages)).toBe(final.output);
  });

  it("maps a tool-level isError result to failed with the server's message", async () => {
    const final = finalPayload(await runTool(env, "mcp__fx__fail", {}));
    expect(final.stop_reason).toBe("fatal");
    expect(final.output).toBe("boom");
  });

  it("carries image content as data-URL images alongside the text", async () => {
    const final = finalPayload(await runTool(env, "mcp__fx__pic", {}));
    expect(final.stop_reason).toBe("completed");
    expect(final.output).toBe("a tiny image");
    expect(final.images).toHaveLength(1);
    expect(final.images![0]).toMatch(/^data:image\/png;base64,/);
  });

  it("keeps the vault out of the server process and defaults cwd to the Workspace", async () => {
    const final = finalPayload(await runTool(env, "mcp__fx__probe", {}));
    const [secret, cwd] = (final.output ?? "").split("|");
    // The Environment was built with a vault, but MCP server processes must not see it —
    // only the entry's own env reaches them (covered in the budgets block below).
    expect(secret).toBe("");
    // realpath'd on both sides; case-insensitive to stay stable on Windows drives.
    expect(cwd!.toLowerCase()).toBe(tmp.toLowerCase());
  });

  it("answers toolPermission from the server's readOnlyHint annotation", async () => {
    await env.listTools();
    expect(env.toolPermission("mcp__fx__echo")).toBe("r");
    expect(env.toolPermission("mcp__fx__fail")).toBe("rw");
    expect(env.toolPermission("mcp__fx__missing")).toBeUndefined();
  });

  it("collapses an unknown MCP name into the unknown-tool reply", async () => {
    const final = finalPayload(await runTool(env, "mcp__fx__nope", {}));
    expect(final.stop_reason).toBe("fatal");
    expect(final.output).toContain("Unknown tool: mcp__fx__nope");
  });
});

describe("MCP over stdio — per-server budgets and interruption", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-b-")));
  });

  afterAll(async () => {
    await rmEventually(tmp);
  }, 30_000);

  function makeEnv(extra: Record<string, unknown>): Environment {
    return new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [fixtureEntry(extra)] },
    });
  }

  it("applies the per-server maxOutputLength with the standard truncation marker", async () => {
    const env = makeEnv({ maxOutputLength: 100 });
    try {
      const final = finalPayload(await runTool(env, "mcp__fx__spam", {}));
      expect(final.stop_reason).toBe("completed");
      expect(final.output).toBe(
        `${"x".repeat(50)}\n[output truncated: kept first 50 and last 50 of 500 chars]\n${"x".repeat(50)}`,
      );
    } finally {
      env.dispose();
    }
  });

  it("applies the per-server timeoutMs and finalizes as failed", async () => {
    const env = makeEnv({ timeoutMs: 300 });
    try {
      const final = finalPayload(await runTool(env, "mcp__fx__slow", { ms: 60_000 }));
      expect(final.stop_reason).toBe("fatal");
      expect(final.output).toContain("[tool timeout: exceeded 300ms]");
    } finally {
      env.dispose();
    }
  });

  it("finalizes a user interruption as aborted", async () => {
    const env = makeEnv({});
    try {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 150);
      const final = finalPayload(await runTool(env, "mcp__fx__slow", { ms: 60_000 }, ac.signal));
      expect(final.stop_reason).toBe("aborted");
      expect(final.output).toContain("[interrupted: tool aborted by user]");
    } finally {
      env.dispose();
    }
  });

  it("passes the entry's env variables to the server process", async () => {
    const env = makeEnv({ env: { FIXTURE_SECRET: "from-entry" } });
    try {
      const final = finalPayload(await runTool(env, "mcp__fx__probe", {}));
      expect(final.output).toMatch(/^from-entry\|/);
    } finally {
      env.dispose();
    }
  });

  it("skips an unreachable server with a warning instead of failing", async () => {
    const warn = vi.fn();
    const provider = new McpToolProvider(
      [{ name: "broken", config: { command: "definitely-not-a-real-command-xyz" } }],
      { warn },
    );
    try {
      expect(await provider.listTools()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/MCP server "broken" unavailable/));
    } finally {
      await provider.close();
    }
  });
});

describe("MCP over stdio — per-server permission override", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-p-")));
  });

  afterAll(async () => {
    await rmEventually(tmp);
  }, 30_000);

  function makeEnv(extra: Record<string, unknown>): Environment {
    return new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [fixtureEntry(extra)] },
    });
  }

  // The fixture's "echo" advertises readOnlyHint: true and "fail" advertises no hint, so one
  // server exercises both directions of an explicit level contradicting the annotation.
  it('forces "rw" onto every tool, including one advertising readOnlyHint: true', async () => {
    const env = makeEnv({ permission: "rw" });
    try {
      await env.listTools();
      expect(env.toolPermission("mcp__fx__echo")).toBe("rw");
      expect(env.toolPermission("mcp__fx__fail")).toBe("rw");
    } finally {
      env.dispose();
    }
  });

  it('forces "r" onto every tool, including one advertising no hint', async () => {
    const env = makeEnv({ permission: "r" });
    try {
      await env.listTools();
      expect(env.toolPermission("mcp__fx__fail")).toBe("r");
      expect(env.toolPermission("mcp__fx__echo")).toBe("r");
    } finally {
      env.dispose();
    }
  });

  it('leaves the annotation in charge on an explicit "auto"', async () => {
    const env = makeEnv({ permission: "auto" });
    try {
      await env.listTools();
      expect(env.toolPermission("mcp__fx__echo")).toBe("r");
      expect(env.toolPermission("mcp__fx__fail")).toBe("rw");
    } finally {
      env.dispose();
    }
  });

  it("skips a server whose permission value is not a level, keeping the Agent up", async () => {
    const warn = vi.fn();
    const provider = new McpToolProvider([fixtureEntry({ permission: "readonly" })], { warn });
    try {
      expect(await provider.listTools()).toEqual([]);
      expect(provider.serverNames()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/MCP server "fx" skipped: "permission" must be "auto", "r" or "rw"/),
      );
    } finally {
      await provider.close();
    }
  });
});

describe("Session first-run bootstrap events", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-s-")));
  });

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const fakeLLM: LLMInterface = {
    async *streamGenerate(): AsyncGenerator<OmniMessage, LLMOutcome> {
      yield assistantText("done");
      return { status: "completed" };
    },
  };

  function makeSession(env: Environment, written: OmniMessage[]): Session {
    const meta: SessionMetaPayload = {
      session_id: "s-mcp",
      provider: "custom",
      model_id: "m",
      model_context_window: 1000,
      system_prompt: "sp",
      agent_state: tmp,
      workspace: tmp,
    };
    return new Session({
      meta,
      bootstrap: async () => ({
        tools: await env.listTools(),
        llm: fakeLLM,
        mcp: env.mcpConnectResults(),
      }),
      mcpServers: env.mcpServerNames(),
      environment: env,
      trace: {
        write: async (msg) => {
          written.push(msg);
        },
      },
      imagesDir: path.join(tmp, "scratch"),
      modelHasVision: true,
    });
  }

  it("streams the connect pair and tool_list_ready before the first reply; the Trace puts them after the input", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [fixtureEntry()] },
    });
    const written: OmniMessage[] = [];
    const session = makeSession(env, written);
    try {
      const streamed: OmniMessage[] = [];
      for await (const msg of session.run([userText("go")])) streamed.push(msg);
      const types = streamed.map((m) => (m.payload as { type?: string }).type);
      expect(types.slice(0, 3)).toEqual([
        "mcp_connect_begin",
        "mcp_connect_end",
        "tool_list_ready",
      ]);
      expect(types).toContain("text");
      const begin = streamed[0]!.payload as { servers?: string[] };
      expect(begin.servers).toEqual(["fx"]);
      const end = streamed[1]!.payload as {
        status?: string;
        results?: { server: string; status: string; tools?: number; duration_ms: number }[];
      };
      expect(end.status).toBe("completed");
      expect(end.results).toHaveLength(1);
      expect(end.results![0]).toMatchObject({ server: "fx", status: "completed", tools: 6 });
      const toolsMsg = streamed[2]!.payload as { tools?: { name: string }[] };
      expect(toolsMsg.tools!.map((t) => t.name)).toContain("mcp__fx__echo");
      // Trace ordering: the engine writes the bootstrap records AFTER the run's input, so
      // the connect phase belongs to the new turn — meta, the user text, then the pair.
      const writtenTypes = written.map(
        (m) => (m.payload as { type?: string }).type ?? "session_meta",
      );
      expect(writtenTypes.slice(0, 5)).toEqual([
        "session_meta",
        "text",
        "mcp_connect_begin",
        "mcp_connect_end",
        "tool_list_ready",
      ]);
      // Second run: the bootstrap already happened — no repeated events.
      const second: OmniMessage[] = [];
      for await (const msg of session.run([userText("again")])) second.push(msg);
      const secondTypes = second.map((m) => (m.payload as { type?: string }).type);
      expect(secondTypes).not.toContain("mcp_connect_begin");
      expect(secondTypes).not.toContain("tool_list_ready");
    } finally {
      session.dispose();
    }
  });

  it("emits only tool_list_ready when no MCP servers are configured", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [] },
    });
    const written: OmniMessage[] = [];
    const session = makeSession(env, written);
    try {
      const streamed: OmniMessage[] = [];
      for await (const msg of session.run([userText("go")])) streamed.push(msg);
      const types = streamed.map((m) => (m.payload as { type?: string }).type);
      expect(types[0]).toBe("tool_list_ready");
      expect(types).not.toContain("mcp_connect_begin");
    } finally {
      session.dispose();
    }
  });

  it("aborts mid-connect: cancels the attempt (live-only events) and the next run reconnects", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [] },
    });
    const written: OmniMessage[] = [];
    // Capturing LLM: the carry-over assertion below reads what the request delivered.
    const requests: OmniMessage[][] = [];
    const capturingLLM: LLMInterface = {
      async *streamGenerate(parameters): AsyncGenerator<OmniMessage, LLMOutcome> {
        requests.push(parameters.newMessages);
        yield assistantText("done");
        return { status: "completed" };
      },
    };
    const session = new Session({
      meta: {
        session_id: "s-mcp-abort",
        provider: "custom",
        model_id: "m",
        model_context_window: 1000,
        system_prompt: "sp",
        agent_state: tmp,
        workspace: tmp,
      },
      bootstrap: async () => {
        calls += 1;
        await gate;
        return { tools: [{ name: "t", description: "d" }], llm: capturingLLM, mcp: [] };
      },
      mcpServers: ["fx"],
      environment: env,
      trace: {
        write: async (msg) => {
          written.push(msg);
        },
      },
      imagesDir: path.join(tmp, "scratch"),
      modelHasVision: true,
    });
    try {
      const ac = new AbortController();
      const first: OmniMessage[] = [];
      const run = (async () => {
        for await (const msg of session.run([userText("go")], { signal: ac.signal })) {
          first.push(msg);
        }
      })();
      // Wait for the begin event to stream, then interrupt mid-connect.
      for (let i = 0; i < 100 && first.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      ac.abort();
      await run;
      const firstTypes = first.map((m) => (m.payload as { type?: string }).type);
      expect(firstTypes).toEqual(["mcp_connect_begin", "mcp_connect_end", "abort"]);
      expect((first[1]!.payload as { status?: string }).status).toBe("aborted");
      // The aborted turn is RECORDED: the Session itself writes the input, the aborted
      // connect pair and the abort event (no engine exists to do it) — the analysis page
      // shows the interruption and a reload/restart keeps the message.
      const writtenTypes = written.map(
        (m) => (m.payload as { type?: string }).type ?? "session_meta",
      );
      expect(writtenTypes).toEqual([
        "session_meta",
        "text",
        "mcp_connect_begin",
        "mcp_connect_end",
        "abort",
      ]);
      expect((written.at(-2)!.payload as { status?: string }).status).toBe("aborted");

      release();
      const second: OmniMessage[] = [];
      for await (const msg of session.run([userText("again")])) second.push(msg);
      const secondTypes = second.map((m) => (m.payload as { type?: string }).type);
      expect(secondTypes.slice(0, 3)).toEqual([
        "mcp_connect_begin",
        "mcp_connect_end",
        "tool_list_ready",
      ]);
      expect((second[1]!.payload as { status?: string }).status).toBe("completed");
      expect(secondTypes).toContain("text");
      // Abort cancels the attempt: the next run started a FRESH bootstrap (reconnect).
      expect(calls).toBe(2);
      // The aborted run's input is carried into this run — persisted ahead of the new
      // input (dropping it would silently lose the user's message: nothing had reached
      // the Trace) and delivered to the model in the same order.
      const writtenUserTexts = written
        .filter((m) => m.type === "model_msg")
        .map((m) => (m.payload as { text?: string }).text)
        .filter((t): t is string => t === "go" || t === "again");
      expect(writtenUserTexts).toEqual(["go", "again"]);
      const requestTexts = (requests.at(-1) ?? [])
        .map((m) => (m.payload as { text?: string }).text)
        .filter((t): t is string => t === "go" || t === "again");
      expect(requestTexts).toEqual(["go", "again"]);
    } finally {
      session.dispose();
    }
  });

  it("cancelConnect aborts the in-flight attempt and the next listTools reconnects", async () => {
    const provider = new McpToolProvider([fixtureEntry()], { warn: () => {} });
    try {
      const first = provider.listTools();
      provider.cancelConnect();
      await expect(first).rejects.toThrow(/cancelled/);
      // Fresh attempt after the cancel: a full reconnect succeeds.
      const tools = await provider.listTools();
      expect(tools).toHaveLength(6);
      expect(provider.connectResults()[0]).toMatchObject({ server: "fx", status: "completed" });
    } finally {
      await provider.close();
    }
  });

  it("records per-server connect outcomes, including failures", async () => {
    const provider = new McpToolProvider(
      [
        fixtureEntry(),
        { name: "broken", config: { command: "definitely-not-a-real-command-xyz" } },
      ],
      { warn: () => {} },
    );
    try {
      await provider.listTools();
      const results = provider.connectResults();
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        server: "fx",
        transport: "stdio",
        status: "completed",
        tools: 6,
      });
      expect(results[1]).toMatchObject({
        server: "broken",
        transport: "stdio",
        status: "fatal",
        error_code: "connect_failed",
      });
      expect(results[1]!.error_message).toBeTruthy();
      expect(results[1]!.duration_ms).toBeGreaterThanOrEqual(0);
    } finally {
      await provider.close();
    }
  });

  it("skips tools whose prefixed name is unusable for LLM APIs, with a warning (count excludes them)", async () => {
    const warnings: string[] = [];
    const provider = new McpToolProvider([fixtureEntry()], { warn: (m) => warnings.push(m) });
    try {
      const tools = await provider.listTools();
      // The fixture's "dot.name" tool is listed by the server but never registered: one
      // unusable name in the schema list would 400 every request of the Session.
      expect(tools.map((t) => t.name)).not.toContain("mcp__fx__dot.name");
      expect(tools).toHaveLength(6);
      expect(provider.connectResults()[0]).toMatchObject({ status: "completed", tools: 6 });
      expect(warnings.some((w) => w.includes('"dot.name"') && w.includes("skipped"))).toBe(true);
    } finally {
      await provider.close();
    }
  });
});

describe("MCP over Streamable HTTP", () => {
  let httpServer: Server;
  let transport: NodeStreamableHTTPServerTransport;
  let url: string;
  const seenHeaders: IncomingHttpHeaders[] = [];

  beforeAll(async () => {
    const mcp = new McpServer({ name: "http-fixture", version: "1.0.0" });
    mcp.registerTool(
      "add",
      { description: "Adds two numbers.", inputSchema: z.object({ a: z.number(), b: z.number() }) },
      async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
    );
    transport = new NodeStreamableHTTPServerTransport();
    await mcp.connect(transport);
    httpServer = createServer((req, res) => {
      seenHeaders.push(req.headers);
      void transport.handleRequest(req, res);
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
  });

  afterAll(async () => {
    await transport.close();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it("discovers and calls tools over http, sending the configured headers on every request", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "penguin-mcp-http-"));
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [],
        mcpServers: [
          { name: "web", config: { transport: "http", url, headers: { "x-penguin-test": "yes" } } },
        ],
      },
    });
    try {
      const tools = await env.listTools();
      expect(tools.map((t) => t.name)).toEqual(["mcp__web__add"]);
      const final = finalPayload(await runTool(env, "mcp__web__add", { a: 2, b: 3 }));
      expect(final.stop_reason).toBe("completed");
      expect(final.output).toBe("5");
      expect(seenHeaders.length).toBeGreaterThan(0);
      expect(seenHeaders.every((h) => h["x-penguin-test"] === "yes")).toBe(true);
    } finally {
      env.dispose();
      await rmEventually(tmp);
    }
  });
});
