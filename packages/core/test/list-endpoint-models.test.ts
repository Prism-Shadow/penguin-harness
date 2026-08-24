/**
 * listEndpointModels: the thin AgentHub wrapper — routes by the given client type,
 * forwards credential/base URL only when present, and returns the listing verbatim
 * (order preserved, no dedup: presentation policy belongs to callers).
 */
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  listing: ["gpt-a", "gpt-b", "gpt-a"],
  fail: undefined as Error | undefined,
}));

vi.mock("@prismshadow/agenthub", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@prismshadow/agenthub")>();
  class FakeAutoLLMClient {
    constructor(options: Record<string, unknown>) {
      captured.options.push(options);
    }
    async listModels(): Promise<string[]> {
      if (captured.fail) throw captured.fail;
      return captured.listing;
    }
  }
  return { ...mod, AutoLLMClient: FakeAutoLLMClient };
});

const { listEndpointModels } = await import("../src/llm/list-models.js");

describe("listEndpointModels", () => {
  it("routes by the client type (model doubles as the routing key) and returns the listing verbatim", async () => {
    captured.options.length = 0;
    const models = await listEndpointModels({
      clientType: "openai-chat",
      apiKey: "sk-list-1",
      baseUrl: "https://gw.example/v1",
    });
    expect(models).toEqual(["gpt-a", "gpt-b", "gpt-a"]);
    expect(captured.options).toEqual([
      {
        model: "openai-chat",
        clientType: "openai-chat",
        apiKey: "sk-list-1",
        baseUrl: "https://gw.example/v1",
      },
    ]);
  });

  it("omits absent credential and base URL so the SDK's environment fallback applies", async () => {
    captured.options.length = 0;
    await listEndpointModels({ clientType: "ant-messages" });
    expect(captured.options).toEqual([{ model: "ant-messages", clientType: "ant-messages" }]);
  });

  it("propagates AgentHub errors unchanged (callers collapse them into their outcome shape)", async () => {
    captured.fail = Object.assign(new Error("listing models is not supported"), {
      name: "UnsupportedOperationError",
    });
    try {
      await expect(listEndpointModels({ clientType: "claude-5" })).rejects.toMatchObject({
        name: "UnsupportedOperationError",
      });
    } finally {
      captured.fail = undefined;
    }
  });
});
