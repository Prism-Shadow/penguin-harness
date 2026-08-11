import { describe, expect, it, vi } from "vitest";
import { Environment } from "../src/environment/environment.js";
import {
  DEFAULT_SEARXNG_ENDPOINT,
  MAX_SEARXNG_RESPONSE_BYTES,
  WEB_SEARCH_NAME,
  buildSearxngSearchUrl,
  createWebSearchTool,
} from "../src/environment/tools/web-search.js";
import type { ToolResult } from "../src/environment/tools/types.js";
import { toolCall } from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type { ToolDefinitionConfig, WebSearchFetch, WebSearchService } from "../src/interfaces.js";

const definition: ToolDefinitionConfig = {
  name: WEB_SEARCH_NAME,
  description: "search the web",
  parameters: {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "number" } },
    required: ["query"],
  },
  permission: "r",
  timeoutMs: 30000,
  maxOutputLength: 16000,
};

async function run(
  args: Record<string, unknown>,
  service: WebSearchService,
  signal?: AbortSignal,
): Promise<{ result: ToolResult | void; text: string }> {
  const tool = createWebSearchTool(definition, service);
  const gen = tool.execute(args, {
    workspaceDir: "/tmp",
    toolCallId: "search-1",
    ...(signal ? { signal } : {}),
  });
  const messages: OmniMessage[] = [];
  let result: ToolResult | void;
  for (;;) {
    const step = await gen.next();
    if (step.done) {
      result = step.value;
      break;
    }
    messages.push(step.value);
  }
  return {
    result,
    text: messages.map((message) => (message.payload as { output?: string }).output ?? "").join(""),
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

describe("web_search (native SearXNG provider)", () => {
  it("builds the fixed JSON search route without exposing an arbitrary URL argument", () => {
    const url = buildSearxngSearchUrl("https://search.example.test/searx/", {
      query: "penguin agent",
      language: "en",
      safesearch: 2,
      timeRange: "month",
    });
    expect(url.origin + url.pathname).toBe("https://search.example.test/searx/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "penguin agent",
      format: "json",
      categories: "general",
      safesearch: "2",
      language: "en",
      time_range: "month",
    });
    expect(() =>
      buildSearxngSearchUrl("file:///etc/passwd", { query: "x", safesearch: 1 }),
    ).toThrow("http or https");
    expect(() =>
      buildSearxngSearchUrl("https://user:secret@example.test", {
        query: "x",
        safesearch: 1,
      }),
    ).toThrow("must not contain credentials");
  });

  it("normalizes, deduplicates, limits, and labels results as untrusted external content", async () => {
    const fetcher = vi.fn<WebSearchFetch>(async () =>
      jsonResponse({
        results: [
          {
            title: "  First   result ",
            url: "https://example.com/a",
            content: " A useful   snippet. ",
            publishedDate: "2026-08-11",
          },
          { title: "duplicate", url: "https://example.com/a", content: "ignored" },
          { title: "unsafe", url: "file:///tmp/no", content: "ignored" },
          { title: "Second", url: "https://example.org/b", description: "fallback field" },
          { title: "Third", url: "https://example.net/c" },
        ],
      }),
    );
    const { result, text } = await run(
      {
        query: " latest penguin news ",
        limit: 2,
        language: "en",
        safesearch: 0,
        time_range: "day",
      },
      { endpoint: "https://search.example.test", fetch: fetcher },
    );

    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain('Web search results for "latest penguin news" (SearXNG, 2)');
    expect(text).toContain("untrusted content");
    expect(text).toContain("[1] First result");
    expect(text).toContain("URL: https://example.com/a");
    expect(text).toContain("Snippet: A useful snippet.");
    expect(text).toContain("Published: 2026-08-11");
    expect(text).toContain("[2] Second");
    expect(text).not.toContain("Third");

    const [input, init] = fetcher.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("latest penguin news");
    expect(url.searchParams.get("format")).toBe("json");
    expect(init?.redirect).toBe("error");
  });

  it("uses the Agent vault endpoint through Environment with read-only permission", async () => {
    const fetcher = vi.fn<WebSearchFetch>(async () => jsonResponse({ results: [] }));
    const environment = new Environment({
      workspaceDir: "/tmp",
      toolConfig: { customTools: [definition], mcpServers: [] },
      vault: { SEARXNG_ENDPOINT: "https://vault-search.example.test/base" },
      services: { webSearch: { fetch: fetcher } },
    });
    expect((await environment.listTools()).map((tool) => tool.name)).toEqual([WEB_SEARCH_NAME]);
    expect(environment.toolPermission(WEB_SEARCH_NAME)).toBe("r");

    const output: OmniMessage[] = [];
    for await (const message of environment.executeTool({
      toolCall: toolCall({
        name: WEB_SEARCH_NAME,
        arguments: '{"query":"nothing"}',
        toolCallId: "s1",
      }),
    })) {
      output.push(message);
    }
    expect(String(fetcher.mock.calls[0]![0])).toContain("vault-search.example.test/base/search");
    expect(
      output.some((message) =>
        ((message.payload as { output?: string }).output ?? "").includes("No web search results"),
      ),
    ).toBe(true);
  });

  it("falls back to the local SearXNG endpoint", async () => {
    const fetcher = vi.fn<WebSearchFetch>(async () => jsonResponse({ results: [] }));
    await run({ query: "x" }, { fetch: fetcher });
    expect(String(fetcher.mock.calls[0]![0])).toContain(`${DEFAULT_SEARXNG_ENDPOINT}/search`);
  });

  it.each([
    [{}, 'Missing or empty required argument "query"'],
    [{ query: "x", limit: 0 }, 'Invalid "limit"'],
    [{ query: "x", safesearch: 3 }, 'Invalid "safesearch"'],
    [{ query: "x", language: "../../bad" }, 'Invalid "language"'],
    [{ query: "x", time_range: "week" }, 'Invalid "time_range"'],
  ])("rejects invalid arguments without issuing a request: %j", async (args, expected) => {
    const fetcher = vi.fn<WebSearchFetch>();
    const { result, text } = await run(args, { fetch: fetcher });
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain(expected);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports HTTP/JSON/schema failures with actionable SearXNG diagnostics", async () => {
    const forbidden = await run(
      { query: "x" },
      { fetch: async () => new Response("forbidden", { status: 403 }) },
    );
    expect(forbidden.result?.stopReason).toBe("failed");
    expect(forbidden.text).toContain("HTTP 403");
    expect(forbidden.text).toContain("search.formats");

    const malformed = await run(
      { query: "x" },
      { fetch: async () => new Response("not-json", { status: 200 }) },
    );
    expect(malformed.text).toContain("invalid JSON");

    const wrongShape = await run({ query: "x" }, { fetch: async () => jsonResponse({ data: [] }) });
    expect(wrongShape.text).toContain("without a results array");
  });

  it("bounds response bytes and converges interruption to aborted", async () => {
    const oversized = await run(
      { query: "x" },
      {
        fetch: async () =>
          new Response("{}", {
            headers: { "content-length": String(MAX_SEARXNG_RESPONSE_BYTES + 1) },
          }),
      },
    );
    expect(oversized.result?.stopReason).toBe("failed");
    expect(oversized.text).toContain("response exceeds");

    const controller = new AbortController();
    controller.abort();
    const aborted = await run(
      { query: "x" },
      {
        fetch: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
          return jsonResponse({ results: [] });
        },
      },
      controller.signal,
    );
    expect(aborted.result?.stopReason).toBe("aborted");
    expect(aborted.text).toBe("");
  });
});
