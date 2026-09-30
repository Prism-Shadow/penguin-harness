/**
 * listEndpointModels: the thin AgentHub wrapper — routes by the given client type,
 * resolves the credential itself (the environment lends a key only to the vendor's own
 * endpoint and refuses the listing otherwise, before any client exists), forwards the base
 * URL only when present, and returns the listing verbatim (order preserved, no dedup:
 * presentation policy belongs to callers).
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

  it("lends the protocol's environment key to the vendor's own endpoint (no base URL = the vendor default)", async () => {
    captured.options.length = 0;
    await listEndpointModels({
      clientType: "ant-messages",
      env: { ANTHROPIC_API_KEY: " sk-env-1 " },
    });
    expect(captured.options).toEqual([
      { model: "ant-messages", clientType: "ant-messages", apiKey: "sk-env-1" },
    ]);
  });

  it("refuses a keyless listing of a foreign endpoint before a client exists, whatever the environment holds", async () => {
    captured.options.length = 0;
    await expect(
      listEndpointModels({
        clientType: "openai-chat",
        baseUrl: "https://gw.example/v1",
        env: { OPENAI_API_KEY: "sk-env-2" },
      }),
    ).rejects.toMatchObject({
      name: "ModelCredentialError",
      message: expect.stringContaining("enter the endpoint's API key"),
    });
    expect(captured.options).toEqual([]);
  });

  it("names the unset variable when the vendor's own endpoint has no key to lend", async () => {
    captured.options.length = 0;
    await expect(listEndpointModels({ clientType: "ant-messages", env: {} })).rejects.toMatchObject(
      {
        name: "ModelCredentialError",
        message: expect.stringContaining("ANTHROPIC_API_KEY is not set"),
      },
    );
    expect(captured.options).toEqual([]);
  });

  it("propagates AgentHub errors unchanged (callers collapse them into their outcome shape)", async () => {
    captured.fail = Object.assign(new Error("listing models is not supported"), {
      name: "UnsupportedOperationError",
    });
    try {
      await expect(
        listEndpointModels({ clientType: "claude-5", apiKey: "sk-list-3" }),
      ).rejects.toMatchObject({ name: "UnsupportedOperationError" });
    } finally {
      captured.fail = undefined;
    }
  });
});
