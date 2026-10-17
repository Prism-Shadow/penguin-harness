/**
 * listEndpointModels: the thin MMSP wrapper — routes by the given client type, takes the key
 * from its caller alone and applies a Session's credential rule (PRN-021), forwards the base
 * URL only when present, names PenguinHarness and its version in the User-Agent, and returns
 * the listing verbatim (order preserved, no dedup: presentation policy belongs to callers).
 *
 * - Given a key and a base URL, the client is routed by the client type and the listing comes
 *   back verbatim.
 * - Given no key and a base URL, the listing is refused before any client exists, whatever the
 *   environment holds: the wrapped SDK would otherwise read the protocol's variable and send it
 *   to the typed URL.
 * - Given no key and no base URL, the client is built with nothing, so it reads its own pair —
 *   key and endpoint — as a Session's would.
 * - Given no key on the mmsp client with a base URL, the open MMSP server is listed keyless.
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

  it("refuses a keyless listing of a base URL before a client exists, the vendor's own included", async () => {
    captured.options.length = 0;
    for (const baseUrl of ["https://gw.example/v1", "https://api.openai.com/v1"]) {
      await expect(
        listEndpointModels({ clientType: "openai-chat", baseUrl }),
      ).rejects.toMatchObject({
        name: "ModelCredentialError",
        message: expect.stringContaining("enter the endpoint's API key"),
      });
    }
    expect(captured.options).toEqual([]);
  });

  it("with no key and no base URL, builds the client with nothing, so it reads its own pair", async () => {
    captured.options.length = 0;
    for (const baseUrl of [undefined, "  "]) {
      await listEndpointModels({ clientType: "openai-chat", ...(baseUrl ? { baseUrl } : {}) });
    }
    expect(captured.options).toEqual([
      { model: "openai-chat", clientType: "openai-chat", apiKey: undefined, defaultHeaders },
      { model: "openai-chat", clientType: "openai-chat", apiKey: undefined, defaultHeaders },
    ]);
  });

  it("lists an open MMSP server with no key, as the mmsp client calls it", async () => {
    captured.options.length = 0;
    await listEndpointModels({ clientType: "mmsp", baseUrl: "https://relay.example/api/v1" });
    expect(captured.options).toEqual([
      {
        model: "mmsp",
        clientType: "mmsp",
        apiKey: undefined,
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
