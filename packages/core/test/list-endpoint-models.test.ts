/**
 * listEndpointModels: the thin MMSP wrapper — routes by the given client type, passes the key
 * and the base URL exactly as its caller gives them (nothing for an absent one), names
 * PenguinHarness and its version in the User-Agent, and returns the listing verbatim (order
 * preserved, no dedup: presentation policy belongs to callers). What a missing key means is
 * MMSP's (model-client.test.ts holds it on the wire).
 *
 * - Given a key and a base URL, the client is routed by the client type and the listing comes
 *   back verbatim.
 * - Given no key, the client is built with no key at all, with the base URL when there is one.
 * - Given MMSP throws, the error propagates unchanged.
 */
import { describe, expect, it, vi } from "vitest";
import { VERSION } from "../src/index.js";

const defaultHeaders = { "User-Agent": `penguinharness/${VERSION}` };

const captured = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  listing: ["gpt-a", "gpt-b", "gpt-a"],
  fail: undefined as Error | undefined,
}));

vi.mock("@prismshadow/mmsp", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@prismshadow/mmsp")>();
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
        defaultHeaders,
      },
    ]);
  });

  it("with no key, builds the client with no key at all, and the base URL when there is one", async () => {
    captured.options.length = 0;
    for (const baseUrl of [undefined, "  ", "https://relay.example/api/v1"]) {
      await listEndpointModels({ clientType: "mmsp", ...(baseUrl ? { baseUrl } : {}) });
    }
    expect(captured.options).toEqual([
      { model: "mmsp", clientType: "mmsp", defaultHeaders },
      { model: "mmsp", clientType: "mmsp", defaultHeaders },
      {
        model: "mmsp",
        clientType: "mmsp",
        baseUrl: "https://relay.example/api/v1",
        defaultHeaders,
      },
    ]);
  });

  it("propagates MMSP errors unchanged (callers collapse them into their outcome shape)", async () => {
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
