import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";
import { Environment } from "../src/environment/index.js";
import {
  TOOL_CALL_NAME as MCP_CALL_TOOL_NAME,
  TOOL_SEARCH_NAME as MCP_SEARCH_TOOL_NAME,
  McpToolProvider,
  renderCallToolResult,
} from "../src/environment/mcp/provider.js";
import { Session } from "../src/session.js";
import { assistantText, toolCall, userText } from "../src/omnimessage/index.js";
import type { OmniMessage, SessionMetaPayload } from "../src/omnimessage/index.js";
import type { LLMInterface, LLMOutcome, MCPServerConfig } from "../src/interfaces.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url));
const DYNAMIC_FIXTURE = fileURLToPath(
  new URL("./fixtures/mcp-dynamic-catalog-server.mjs", import.meta.url),
);
const EXPOSURE_FIXTURE = fileURLToPath(
  new URL("./fixtures/mcp-tool-exposure-server.mjs", import.meta.url),
);

/** A `tools.mcpServers` entry spawning the stdio fixture, with optional extra config fields. */
function fixtureEntry(extra: Record<string, unknown> = {}): MCPServerConfig {
  return { name: "fx", config: { command: process.execPath, args: [FIXTURE], ...extra } };
}

function dynamicFixtureEntry(extra: Record<string, unknown> = {}): MCPServerConfig {
  return {
    name: "dynamic",
    config: { command: process.execPath, args: [DYNAMIC_FIXTURE], ...extra },
  };
}

function exposureFixtureEntry(toolCount: number): MCPServerConfig {
  return {
    name: "many",
    config: {
      command: process.execPath,
      args: [EXPOSURE_FIXTURE],
      env: { PENGUIN_TOOL_EXPOSURE_EVAL_TOOL_COUNT: String(toolCount) },
    },
  };
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

interface McpSearchMatch {
  tool_ref: string;
  tool_name: string;
  permission: "r" | "rw";
  input_schema: Record<string, unknown>;
}

interface McpSearchResult {
  catalog_refresh_pending?: boolean;
  matches: McpSearchMatch[];
  note?: string;
}

async function searchCatalog(env: Environment, query: string, limit = 5): Promise<McpSearchResult> {
  const final = finalPayload(await runTool(env, MCP_SEARCH_TOOL_NAME, { query, limit }));
  expect(final.stop_reason).toBe("completed");
  return JSON.parse(final.output ?? "{}") as McpSearchResult;
}

async function searchOne(env: Environment, query: string): Promise<McpSearchMatch> {
  const result = await searchCatalog(env, query, 1);
  expect(result.matches).toHaveLength(1);
  return result.matches[0]!;
}

async function waitForCatalogState(
  env: Environment,
  query: string,
  accept: (result: McpSearchResult) => boolean,
  limit = 5,
): Promise<McpSearchResult> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const result = await searchCatalog(env, query, limit);
    if (accept(result)) return result;
    if (Date.now() >= deadline) {
      throw new Error(`MCP catalog did not reach the expected state for query "${query}"`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function dispatchArguments(match: McpSearchMatch, args: Record<string, unknown>) {
  return {
    tool_ref: match.tool_ref,
    tool_name: match.tool_name,
    arguments: args,
  };
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
    expect(final.stop_reason).toBe("failed");
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
    expect(final.stop_reason).toBe("failed");
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
      expect(final.output).toBe("x".repeat(100) + "\n[output truncated: exceeded 100 chars]");
    } finally {
      env.dispose();
    }
  });

  it("applies the per-server timeoutMs and finalizes as failed", async () => {
    const env = makeEnv({ timeoutMs: 300 });
    try {
      const final = finalPayload(await runTool(env, "mcp__fx__slow", { ms: 60_000 }));
      expect(final.stop_reason).toBe("failed");
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
    await rmEventually(tmp);
  });

  const fakeLLM: LLMInterface = {
    async *streamGenerate(): AsyncGenerator<OmniMessage, LLMOutcome> {
      yield assistantText("done");
      return { status: "completed" };
    },
  };

  function makeSession(env: Environment, written: OmniMessage[], llm = fakeLLM): Session {
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
        llm,
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
    const listTools = vi.spyOn(env, "listTools");
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
      expect(toolsMsg.tools!.map((t) => t.name)).toEqual([
        "mcp__fx__echo",
        "mcp__fx__fail",
        "mcp__fx__pic",
        "mcp__fx__slow",
        "mcp__fx__probe",
        "mcp__fx__spam",
      ]);
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
      // Direct is the compatibility default: discovery/listing happens once at bootstrap.
      expect(listTools).toHaveBeenCalledTimes(1);
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

  it("lazy exposure keeps a fixed tool surface through explicit search and dispatch", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [fixtureEntry()], toolExposure: "lazy" },
    });
    const written: OmniMessage[] = [];
    let request = 0;
    const llm: LLMInterface = {
      async *streamGenerate(parameters): AsyncGenerator<OmniMessage, LLMOutcome> {
        request += 1;
        if (request === 1) {
          yield toolCall({
            name: MCP_SEARCH_TOOL_NAME,
            arguments: JSON.stringify({ query: "echo input text", limit: 1 }),
            toolCallId: "search-1",
          });
        } else if (request === 2) {
          const searchResult = JSON.parse(
            finalPayload(parameters.newMessages).output ?? "{}",
          ) as McpSearchResult;
          expect(searchResult.matches).toHaveLength(1);
          yield toolCall({
            name: MCP_CALL_TOOL_NAME,
            arguments: JSON.stringify(
              dispatchArguments(searchResult.matches[0]!, { text: "model selected" }),
            ),
            toolCallId: "dispatch-1",
          });
        } else {
          expect(finalPayload(parameters.newMessages).output).toBe("echo: model selected");
          yield assistantText("done");
        }
        return { status: "completed" };
      },
    };
    const session = makeSession(env, written, llm);
    try {
      const initial = await env.listTools();
      const signature = JSON.stringify(initial);
      expect(initial.map((tool) => tool.name)).toEqual([MCP_SEARCH_TOOL_NAME, MCP_CALL_TOOL_NAME]);
      expect(env.toolPermission(MCP_SEARCH_TOOL_NAME)).toBe("r");
      expect(env.toolPermission(MCP_CALL_TOOL_NAME)).toBeUndefined();
      expect(env.toolPermission("mcp__fx__echo")).toBeUndefined();
      expect(finalPayload(await runTool(env, "mcp__fx__echo", { text: "too early" })).output).toBe(
        "Unknown tool: mcp__fx__echo",
      );

      const streamed: OmniMessage[] = [];
      for await (const msg of session.run([userText("find an echo tool")], {
        approve: async () => "allow",
      })) {
        streamed.push(msg);
      }

      const toolLists = streamed.filter(
        (msg) => (msg.payload as { type?: string }).type === "tool_list_ready",
      );
      expect(toolLists).toHaveLength(1);
      expect(
        (toolLists[0]!.payload as { tools: { name: string }[] }).tools.map((tool) => tool.name),
      ).toEqual([MCP_SEARCH_TOOL_NAME, MCP_CALL_TOOL_NAME]);
      expect(request).toBe(3);
      expect(JSON.stringify(await env.listTools())).toBe(signature);
    } finally {
      session.dispose();
    }
  });

  it("lazy exposure routes built-in tools through the same fixed gateway", async () => {
    await writeFile(path.join(tmp, "gateway.txt"), "gateway builtin\n", "utf8");
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [
          {
            name: "read_file",
            description: "Read a text file from the workspace.",
            permission: "r",
            parameters: {
              type: "object",
              properties: { file_path: { type: "string" } },
              required: ["file_path"],
              additionalProperties: false,
            },
          },
        ],
        mcpServers: [],
        toolExposure: "lazy",
      },
    });
    try {
      const initial = await env.listTools();
      const signature = JSON.stringify(initial);
      expect(initial.map((tool) => tool.name)).toEqual([MCP_SEARCH_TOOL_NAME, MCP_CALL_TOOL_NAME]);
      expect(
        finalPayload(await runTool(env, "read_file", { file_path: "gateway.txt" })).output,
      ).toBe("Unknown tool: read_file");

      const match = await searchOne(env, "read text file workspace");
      expect(match).toMatchObject({ tool_name: "read_file", permission: "r" });
      const args = dispatchArguments(match, { file_path: "gateway.txt" });
      expect(env.toolPermission(MCP_CALL_TOOL_NAME, JSON.stringify(args))).toBe("r");
      const result = finalPayload(await runTool(env, MCP_CALL_TOOL_NAME, args));
      expect(result.stop_reason).toBe("completed");
      expect(result.output).toContain("gateway builtin");
      expect(JSON.stringify(await env.listTools())).toBe(signature);
    } finally {
      env.dispose();
    }
  });

  it("auto exposure freezes one direct-or-gateway decision from the initial MCP schema size", async () => {
    const builtin = {
      name: "read_file",
      description: "Read a text file from the workspace.",
      permission: "r" as const,
      parameters: {
        type: "object",
        properties: { file_path: { type: "string" } },
        required: ["file_path"],
        additionalProperties: false,
      },
    };
    const compact = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [builtin],
        mcpServers: [fixtureEntry()],
        toolExposure: "auto",
      },
    });
    const large = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [builtin],
        mcpServers: [exposureFixtureEntry(50)],
        toolExposure: "auto",
      },
    });
    const forcedGateway = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [builtin],
        mcpServers: [fixtureEntry()],
        toolExposure: "auto",
        toolExposureThresholdTokens: 0,
      },
    });
    const forcedDirect = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [builtin],
        mcpServers: [exposureFixtureEntry(50)],
        toolExposure: "auto",
        toolExposureThresholdTokens: 1_000_000,
      },
    });
    try {
      const compactNames = (await compact.listTools()).map((tool) => tool.name);
      expect(compactNames).toContain("read_file");
      expect(compactNames).toContain("mcp__fx__echo");
      expect(compactNames).not.toContain(MCP_SEARCH_TOOL_NAME);

      const largeInitial = await large.listTools();
      const largeSignature = JSON.stringify(largeInitial);
      expect(largeInitial.map((tool) => tool.name)).toEqual([
        "read_file",
        MCP_SEARCH_TOOL_NAME,
        MCP_CALL_TOOL_NAME,
      ]);
      const match = await searchOne(large, "create github repository issue");
      expect(match.tool_name).toBe("mcp__many__github_create_issue");
      expect(JSON.stringify(await large.listTools())).toBe(largeSignature);

      expect((await forcedGateway.listTools()).map((tool) => tool.name)).toEqual([
        "read_file",
        MCP_SEARCH_TOOL_NAME,
        MCP_CALL_TOOL_NAME,
      ]);
      const forcedDirectNames = (await forcedDirect.listTools()).map((tool) => tool.name);
      expect(forcedDirectNames).toContain("mcp__many__github_create_issue");
      expect(forcedDirectNames).not.toContain(MCP_SEARCH_TOOL_NAME);
    } finally {
      compact.dispose();
      large.dispose();
      forcedGateway.dispose();
      forcedDirect.dispose();
    }
  });

  it("dispatches versioned search results while preserving schema, permission, and surface", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [fixtureEntry()], toolExposure: "lazy" },
    });
    try {
      const initialSignature = JSON.stringify(await env.listTools());
      const match = await searchOne(env, "echo input text");
      expect(match).toMatchObject({
        tool_name: "mcp__fx__echo",
        permission: "r",
        input_schema: expect.objectContaining({ type: "object" }),
      });
      expect(match.tool_ref).toMatch(/^tr_[a-f0-9]{32}$/);
      const compactSearch =
        finalPayload(await runTool(env, MCP_SEARCH_TOOL_NAME, { query: "echo input text" }))
          .output ?? "";
      expect(compactSearch).not.toContain("\n");
      expect(compactSearch).not.toContain("schema_digest");
      expect(compactSearch).not.toContain("catalog_generation");
      const noMatch = await searchCatalog(env, "quantum zebra orchestration");
      expect(noMatch.matches).toHaveLength(0);
      expect(noMatch.note).toContain("retry once with concise catalog-language capability terms");

      const dispatchArgs = dispatchArguments(match, { text: "again" });
      expect(env.toolPermission(MCP_CALL_TOOL_NAME, JSON.stringify(dispatchArgs))).toBe("r");
      expect(env.toolApprovalTarget(MCP_CALL_TOOL_NAME, JSON.stringify(dispatchArgs))).toEqual({
        name: "mcp__fx__echo",
        permission: "r",
      });
      const final = finalPayload(await runTool(env, MCP_CALL_TOOL_NAME, dispatchArgs));
      expect(final.stop_reason).toBe("completed");
      expect(final.output).toBe("echo: again");

      const invalid = finalPayload(
        await runTool(env, MCP_CALL_TOOL_NAME, { ...dispatchArgs, arguments: {} }),
      );
      expect(invalid.stop_reason).toBe("failed");
      expect(invalid.output).not.toContain("\n");
      expect(JSON.parse(invalid.output ?? "{}")).toMatchObject({
        error: "invalid_tool_arguments",
        retryable: true,
      });

      const mismatched = finalPayload(
        await runTool(env, MCP_CALL_TOOL_NAME, {
          ...dispatchArgs,
          tool_name: "mcp__fx__fail",
        }),
      );
      expect(JSON.parse(mismatched.output ?? "{}")).toMatchObject({
        error: "tool_reference_mismatch",
        retryable: false,
      });
      expect(
        env.toolApprovalTarget(
          MCP_CALL_TOOL_NAME,
          JSON.stringify({ ...dispatchArgs, tool_name: "mcp__fx__fail" }),
        ),
      ).toBeUndefined();

      const unknown = finalPayload(
        await runTool(env, MCP_CALL_TOOL_NAME, {
          ...dispatchArgs,
          tool_ref: "tr_00000000000000000000000000000000",
        }),
      );
      expect(JSON.parse(unknown.output ?? "{}")).toMatchObject({
        error: "unknown_tool_reference",
        retryable: false,
      });
      expect(
        env.toolPermission(
          MCP_CALL_TOOL_NAME,
          JSON.stringify({
            ...dispatchArgs,
            tool_ref: "tr_00000000000000000000000000000000",
          }),
        ),
      ).toBeUndefined();

      const repeated = await searchOne(env, "echo input text");
      expect(repeated.tool_ref).toBe(match.tool_ref);
      const writeMatch = await searchOne(env, "always reports tool error");
      expect(writeMatch).toMatchObject({ tool_name: "mcp__fx__fail", permission: "rw" });
      expect(
        env.toolPermission(MCP_CALL_TOOL_NAME, JSON.stringify(dispatchArguments(writeMatch, {}))),
      ).toBe("rw");

      // The native name is data in lazy mode, so MCP names rejected by provider-native
      // function schemas remain callable through the fixed gateway.
      const dotted = await searchOne(env, "unusable LLM tool name");
      expect(dotted.tool_name).toBe("mcp__fx__dot.name");
      expect(
        finalPayload(await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(dotted, {}))).output,
      ).toBe("never callable");
      expect(JSON.stringify(await env.listTools())).toBe(initialSignature);
    } finally {
      env.dispose();
    }
  });

  it("applies the MCP Server permission override to gateway search, approval, and dispatch", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [],
        mcpServers: [fixtureEntry({ permission: "r" })],
        toolExposure: "lazy",
      },
    });
    try {
      // The fixture's fail tool has no readOnlyHint and would normally be rw. The Server-level
      // override must survive the private binding instead of being lost behind call_tool's rw
      // fallback permission.
      const match = await searchOne(env, "always reports tool error");
      expect(match).toMatchObject({ tool_name: "mcp__fx__fail", permission: "r" });
      const args = dispatchArguments(match, {});
      expect(env.toolPermission(MCP_CALL_TOOL_NAME, JSON.stringify(args))).toBe("r");
      expect(env.toolApprovalTarget(MCP_CALL_TOOL_NAME, JSON.stringify(args))).toEqual({
        name: "mcp__fx__fail",
        permission: "r",
      });

      const final = finalPayload(await runTool(env, MCP_CALL_TOOL_NAME, args));
      expect(final.stop_reason).toBe("failed");
      expect(final.output).toBe("boom");
    } finally {
      env.dispose();
    }
  });

  it("refreshes the private lazy catalog without changing the model tool surface", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [],
        mcpServers: [dynamicFixtureEntry()],
        toolExposure: "lazy",
      },
    });
    try {
      const surface = JSON.stringify(await env.listTools());
      const initialSearch = await searchCatalog(env, "mutable text", 1);
      const initial = initialSearch.matches[0]!;
      const control = await searchOne(env, "changes dynamic fixture catalog");
      expect(initial.tool_name).toBe("mcp__dynamic__mutable");
      expect(
        finalPayload(
          await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(initial, { text: "one" })),
        ).output,
      ).toBe("initial: one");

      // A re-registration with the same contract keeps the reference valid while replacing
      // the private execution binding.
      await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(control, { action: "rebind" }));
      const reboundDeadline = Date.now() + 5_000;
      let reboundOutput = "";
      for (;;) {
        reboundOutput =
          finalPayload(
            await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(initial, { text: "two" })),
          ).output ?? "";
        if (reboundOutput === "rebound: two") break;
        if (Date.now() >= reboundDeadline) throw new Error("MCP tool did not rebind in time");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const rebound = await searchOne(env, "mutable text");
      expect(rebound.tool_ref).toBe(initial.tool_ref);
      expect(reboundOutput).toBe("rebound: two");

      // Permission changes issue a new ref, so a previously read-only approval cannot be
      // reused for a now-mutating contract.
      await runTool(
        env,
        MCP_CALL_TOOL_NAME,
        dispatchArguments(control, { action: "permission_rw" }),
      );
      const writeBinding = (
        await waitForCatalogState(
          env,
          "mutable text",
          (result) => result.matches[0]?.permission === "rw",
          1,
        )
      ).matches[0]!;
      expect(writeBinding).toMatchObject({ permission: "rw" });
      expect(writeBinding.tool_ref).not.toBe(initial.tool_ref);
      const permissionStale = JSON.parse(
        finalPayload(
          await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(initial, { text: "old" })),
        ).output ?? "{}",
      ) as Record<string, unknown>;
      expect(permissionStale).toMatchObject({
        error: "stale_tool_reference",
        stale_reason: "permission_changed",
        replacement: { tool_ref: writeBinding.tool_ref, permission: "rw" },
      });
      expect(
        env.toolPermission(
          MCP_CALL_TOOL_NAME,
          JSON.stringify(dispatchArguments(writeBinding, { text: "approved again" })),
        ),
      ).toBe("rw");

      // An incompatible schema gets a new ref. The old one is a tombstone with the exact
      // replacement contract; it can no longer reach the server under stale validation.
      await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(control, { action: "schema_v2" }));
      const changed = (
        await waitForCatalogState(
          env,
          "mutable count",
          (result) =>
            result.matches.length === 1 && result.matches[0]?.tool_ref !== writeBinding.tool_ref,
          1,
        )
      ).matches[0]!;
      expect(changed.tool_ref).not.toBe(writeBinding.tool_ref);
      expect(
        env.toolPermission(MCP_CALL_TOOL_NAME, JSON.stringify(dispatchArguments(writeBinding, {}))),
      ).toBeUndefined();
      const stale = JSON.parse(
        finalPayload(
          await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(writeBinding, { text: "old" })),
        ).output ?? "{}",
      ) as Record<string, unknown>;
      expect(stale).toMatchObject({
        error: "stale_tool_reference",
        retryable: true,
        stale_reason: "schema_changed",
        replacement: { tool_ref: changed.tool_ref, tool_name: changed.tool_name },
      });
      expect(
        finalPayload(
          await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(changed, { count: 3 })),
        ).output,
      ).toBe("count: 3");

      // Additions are searchable immediately, still behind the same fixed gateways.
      await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(control, { action: "add" }));
      const added = (
        await waitForCatalogState(
          env,
          "added after session starts",
          (result) => result.matches.length === 1,
          1,
        )
      ).matches[0]!;
      expect(
        finalPayload(
          await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(added, { value: "now" })),
        ).output,
      ).toBe("added: now");

      // Removals invalidate the active ref explicitly instead of forwarding a doomed call.
      await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(control, { action: "remove" }));
      await waitForCatalogState(env, "mutable count", (result) => result.matches.length === 0, 1);
      const removed = JSON.parse(
        finalPayload(
          await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(changed, { count: 4 })),
        ).output ?? "{}",
      ) as Record<string, unknown>;
      expect(removed).toMatchObject({
        error: "tool_removed",
        retryable: false,
        stale_reason: "tool_removed",
      });
      const oldest = JSON.parse(
        finalPayload(
          await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(initial, { text: "very old" })),
        ).output ?? "{}",
      ) as Record<string, unknown>;
      expect(oldest).toMatchObject({ error: "tool_removed", stale_reason: "tool_removed" });
      expect(JSON.stringify(await env.listTools())).toBe(surface);
    } finally {
      env.dispose();
    }
  }, 30_000);

  it("bounds list-changed storms and refuses dispatch until the catalog is current", async () => {
    await writeFile(path.join(tmp, "storm-safe.txt"), "healthy\n", "utf8");
    const statsPath = path.join(tmp, "catalog-refresh-stats.json");
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [
          {
            name: "read_file",
            description: "Read a text file from the workspace.",
            permission: "r",
            parameters: {
              type: "object",
              properties: { file_path: { type: "string" } },
              required: ["file_path"],
              additionalProperties: false,
            },
          },
        ],
        mcpServers: [
          dynamicFixtureEntry({
            env: { PENGUIN_DYNAMIC_CATALOG_STATS_FILE: statsPath },
          }),
        ],
        toolExposure: "lazy",
      },
    });
    try {
      await env.listTools();
      const mutable = await searchOne(env, "mutable text");
      const control = await searchOne(env, "changes dynamic fixture catalog");
      const localRead = await searchOne(env, "read workspace text file");
      const baselineStats = JSON.parse(await readFile(statsPath, "utf8")) as {
        listRequestStartedAt: number[];
      };
      await runTool(env, MCP_CALL_TOOL_NAME, dispatchArguments(control, { action: "storm" }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const mutableArgs = dispatchArguments(mutable, { text: "must wait" });
      expect(env.toolPermission(MCP_CALL_TOOL_NAME, JSON.stringify(mutableArgs))).toBeUndefined();

      // Refresh uncertainty is scoped to its source: a healthy built-in catalog entry remains
      // approvable and executable while the unrelated MCP Server is noisy.
      const localArgs = dispatchArguments(localRead, { file_path: "storm-safe.txt" });
      expect(env.toolPermission(MCP_CALL_TOOL_NAME, JSON.stringify(localArgs))).toBe("r");
      const localStartedAt = Date.now();
      expect(finalPayload(await runTool(env, MCP_CALL_TOOL_NAME, localArgs)).output).toContain(
        "healthy",
      );
      expect(Date.now() - localStartedAt).toBeLessThan(1_000);

      const searchStartedAt = Date.now();
      const search = await searchCatalog(env, "mutable text");
      expect(Date.now() - searchStartedAt).toBeLessThan(4_000);
      expect(search.catalog_refresh_pending).toBe(true);
      expect(search.note).toContain("last complete snapshot");

      const dispatchStartedAt = Date.now();
      const dispatch = finalPayload(await runTool(env, MCP_CALL_TOOL_NAME, mutableArgs));
      expect(Date.now() - dispatchStartedAt).toBeLessThan(4_000);
      expect(dispatch.stop_reason).toBe("failed");
      expect(JSON.parse(dispatch.output ?? "{}")).toMatchObject({
        error: "catalog_refresh_pending",
        retryable: true,
      });

      const finalStats = JSON.parse(await readFile(statsPath, "utf8")) as {
        listRequestStartedAt: number[];
      };
      const refreshStarts = finalStats.listRequestStartedAt.slice(
        baselineStats.listRequestStartedAt.length,
      );
      expect(refreshStarts.length).toBeGreaterThanOrEqual(3);
      for (let index = 1; index < refreshStarts.length; index += 1) {
        // Real-process timers and the Windows wall clock can differ by a few milliseconds;
        // this still rejects an unbounded 5ms notification-driven refresh loop.
        expect(refreshStarts[index]! - refreshStarts[index - 1]!).toBeGreaterThanOrEqual(475);
      }
    } finally {
      env.dispose();
    }
  }, 15_000);

  it("keeps permissions conservative after a catalog refresh fails", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [],
        mcpServers: [dynamicFixtureEntry()],
        toolExposure: "lazy",
      },
    });
    try {
      await env.listTools();
      const mutable = await searchOne(env, "mutable text");
      const control = await searchOne(env, "changes dynamic fixture catalog");
      await runTool(
        env,
        MCP_CALL_TOOL_NAME,
        dispatchArguments(control, { action: "fail_refresh" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      const mutableArgs = dispatchArguments(mutable, { text: "must not use stale permission" });
      expect(env.toolPermission(MCP_CALL_TOOL_NAME, JSON.stringify(mutableArgs))).toBeUndefined();
      const final = finalPayload(await runTool(env, MCP_CALL_TOOL_NAME, mutableArgs));
      expect(final.stop_reason).toBe("failed");
      expect(JSON.parse(final.output ?? "{}")).toMatchObject({
        error: "catalog_refresh_pending",
        retryable: true,
      });
      expect(env.toolPermission(MCP_CALL_TOOL_NAME, JSON.stringify(mutableArgs))).toBeUndefined();
    } finally {
      env.dispose();
    }
  }, 10_000);

  it("keeps direct exposure on its compatibility snapshot when the MCP catalog changes", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [dynamicFixtureEntry()] },
    });
    try {
      const initial = await env.listTools();
      const surface = JSON.stringify(initial);
      expect(initial.map((tool) => tool.name)).toEqual([
        "mcp__dynamic__mutable",
        "mcp__dynamic__catalog_control",
      ]);
      expect(
        finalPayload(await runTool(env, "mcp__dynamic__catalog_control", { action: "add" }))
          .stop_reason,
      ).toBe("completed");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(JSON.stringify(await env.listTools())).toBe(surface);
      expect(finalPayload(await runTool(env, "mcp__dynamic__added", { value: "x" })).output).toBe(
        "Unknown tool: mcp__dynamic__added",
      );
    } finally {
      env.dispose();
    }
  });

  it("uses the referenced MCP tool's timeout and output cap through the fixed gateway", async () => {
    const timeoutEnv = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [],
        mcpServers: [fixtureEntry({ timeoutMs: 300 })],
        toolExposure: "lazy",
      },
    });
    try {
      const slow = await searchOne(timeoutEnv, "wait requested milliseconds");
      const timedOut = finalPayload(
        await runTool(timeoutEnv, MCP_CALL_TOOL_NAME, dispatchArguments(slow, { ms: 60_000 })),
      );
      expect(timedOut.stop_reason).toBe("failed");
      expect(timedOut.output).toContain("[tool timeout: exceeded 300ms]");
    } finally {
      timeoutEnv.dispose();
    }

    const cappedEnv = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [],
        mcpServers: [fixtureEntry({ maxOutputLength: 100 })],
        toolExposure: "lazy",
      },
    });
    try {
      const spam = await searchOne(cappedEnv, "returns 500 characters");
      const capped = finalPayload(
        await runTool(cappedEnv, MCP_CALL_TOOL_NAME, dispatchArguments(spam, {})),
      );
      expect(capped.output).toBe("x".repeat(100) + "\n[output truncated: exceeded 100 chars]");
    } finally {
      cappedEnv.dispose();
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
      expect(results[1]).toMatchObject({ server: "broken", transport: "stdio", status: "failed" });
      expect(results[1]!.error).toBeTruthy();
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
