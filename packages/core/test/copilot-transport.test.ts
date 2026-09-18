import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoLLMClient } from "@prismshadow/agenthub";
import { listEndpointModels } from "../src/llm/list-models.js";
import { GenerativeModel } from "../src/llm/generative-model.js";
import { userText, toolCallOutput } from "../src/omnimessage/index.js";
import { providerClientType, resolveModelEnv } from "../src/state/model-catalog.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Copilot AgentHub boundary", () => {
  it.each(["/chat/completions", "/responses"])(
    "streams native tools through %s and marks continuation as agent initiated",
    async (endpoint) => {
      let call = 0;
      const fetcher = vi.fn<typeof fetch>(async (url) => {
        if (String(url).endsWith("/models"))
          return Response.json({
            data: [
              {
                id: "supported",
                supported_endpoints: [endpoint],
                capabilities: { type: "chat", supports: { tool_calls: true } },
              },
            ],
          });
        expect(String(url)).toBe("https://api.githubcopilot.com" + endpoint);
        const first = call++ === 0;
        if (endpoint === "/responses") {
          const events: Record<string, unknown>[] = first
            ? [
                {
                  type: "response.output_item.added",
                  item: {
                    id: "fc_test",
                    type: "function_call",
                    call_id: "call_test",
                    name: "ping",
                  },
                },
                { type: "response.function_call_arguments.delta", item_id: "fc_test", delta: "{}" },
                { type: "response.function_call_arguments.done", item_id: "fc_test" },
              ]
            : [{ type: "response.output_text.delta", delta: "Done" }];
          events.push({
            type: "response.completed",
            response: { status: "completed", usage: { input_tokens: 10, output_tokens: 5 } },
          });
          return new Response(
            events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join("") +
              "data: [DONE]\n\n",
            {
              headers: { "content-type": "text/event-stream" },
            },
          );
        }
        const chunk = {
          id: "chatcmpl-test",
          object: "chat.completion.chunk",
          model: "supported",
          created: 1,
          choices: [
            {
              index: 0,
              delta: first
                ? {
                    role: "assistant",
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_test",
                        type: "function",
                        function: { name: "ping", arguments: "{}" },
                      },
                    ],
                  }
                : { role: "assistant", content: "Done" },
              finish_reason: first ? "tool_calls" : "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
        return new Response("data: " + JSON.stringify(chunk) + "\n\ndata: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      });
      vi.stubGlobal("fetch", fetcher);
      const model = new GenerativeModel({
        modelId: "supported",
        clientType: "github-copilot",
        apiKey: "gho_test",
        tools: [{ name: "ping", description: "Return a test result" }],
      });
      const stream = model.streamGenerate({ newMessages: [userText("Call ping")] });
      let toolId = "";
      let next = await stream.next();
      while (!next.done) {
        if ("type" in next.value.payload && next.value.payload.type === "tool_call")
          toolId = next.value.payload.tool_call_id;
        next = await stream.next();
      }
      expect(next.value.status).toBe("completed");
      expect(toolId).not.toBe("");
      const continuation = model.streamGenerate({
        newMessages: [toolCallOutput({ output: "pong", toolCallId: toolId })],
      });
      let result = await continuation.next();
      while (!result.done) result = await continuation.next();
      expect(result.value.status).toBe("completed");
      const requests = fetcher.mock.calls.filter(([url]) => !String(url).endsWith("/models"));
      expect(requests.map(([, init]) => new Headers(init?.headers).get("x-initiator"))).toEqual([
        "user",
        "agent",
      ]);
      expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/models"))).toHaveLength(1);
      const body = JSON.parse(String(requests[1]![1]?.body));
      if (endpoint === "/responses") {
        expect(body.input.at(-1)).toMatchObject({ type: "function_call_output", output: "pong" });
        expect(body.store).toBe(false);
        expect(body.messages).toBeUndefined();
      } else {
        expect(body.messages.at(-1)).toMatchObject({ role: "tool", content: "pong" });
      }
    },
  );
  it("isolates routing and credentials from vendor environment variables", () => {
    vi.stubEnv("OPENAI_API_KEY", "unrelated-key");
    vi.stubEnv("GITHUB_COPILOT_API_KEY", "");
    expect(providerClientType("github-copilot")).toBe("github-copilot");
    expect(resolveModelEnv("gpt-5.6", "github-copilot")?.envKey).toBe("GITHUB_COPILOT_API_KEY");
    expect(() => new AutoLLMClient({ model: "gpt-5.6", clientType: "github-copilot" })).toThrow(
      "Connect",
    );
    expect(
      () =>
        new AutoLLMClient({
          model: "gpt-5.6",
          clientType: "github-copilot",
          apiKey: "token",
          baseUrl: "https://other.example",
        }),
    ).toThrow("requires");
  });

  it("discovers tool-capable Chat and Responses models with authenticated attribution", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [
          {
            id: "supported",
            supported_endpoints: ["/chat/completions"],
            capabilities: { supports: { tool_calls: true } },
          },
          {
            id: "responses-only",
            supported_endpoints: ["/responses"],
            capabilities: { supports: { tool_calls: true } },
          },
          { id: "no-tools", supported_endpoints: ["/chat/completions"] },
          { id: "legacy-chat", capabilities: { type: "chat", supports: { tool_calls: true } } },
          {
            id: "legacy-embedding",
            capabilities: { type: "embeddings", supports: { tool_calls: true } },
          },
          { id: "legacy-unknown", capabilities: { supports: { tool_calls: true } } },
          {
            id: "explicitly-empty",
            supported_endpoints: [],
            capabilities: { type: "chat", supports: { tool_calls: true } },
          },
          {
            id: "legacy-no-tools",
            capabilities: { type: "chat", supports: { tool_calls: false } },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await listEndpointModels({ clientType: "github-copilot", apiKey: "gho_test" })).toEqual([
      "supported",
      "responses-only",
      "legacy-chat",
    ]);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://api.githubcopilot.com/models");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer gho_test");
    expect(headers.get("user-agent")).toBe("PenguinHarness");
    expect(headers.get("copilot-integration-id")).toBe("agentic-workflows");
    expect(init?.redirect).toBe("error");
  });

  it("lets Penguin classify a rejected request without hidden SDK retries", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { message: "Account access rejected", type: "authentication_error" } },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const model = new GenerativeModel({
      modelId: "supported",
      clientType: "github-copilot",
      apiKey: "gho_test",
      tools: [],
    });
    const stream = model.streamGenerate({ newMessages: [userText("Hello")] });
    let result = await stream.next();
    while (!result.done) result = await stream.next();
    expect(result.value.status).toBe("fatal");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
