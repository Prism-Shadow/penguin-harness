/**
 * GenerativeModel's attribution headers: what reaches MMSP's client as `defaultHeaders`. Which
 * headers an endpoint gets is App attribution's rule (app-attribution.test.ts); these scenarios
 * prove the model sends them, and keeps OpenCode's conversation id fixed per instance.
 *
 * - Given a model built for a Session on OpenCode, its client sends the Session's id beside the
 *   User-Agent that names PenguinHarness and its version.
 * - Given two models built outside any Session (the connectivity test, the vision probe), each
 *   sends a fresh id of its own — never nothing, and never one value shared between instances.
 * - Given an endpoint that reads no attribution header, or no base URL, only the User-Agent.
 * - Given a rotated credential, which rebuilds the client, the instance's id is kept.
 */
import { describe, expect, it, vi } from "vitest";
import { VERSION } from "../src/index.js";

const captured = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

vi.mock("@prismshadow/mmsp", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@prismshadow/mmsp")>();
  class FakeAutoLLMClient {
    constructor(options: Record<string, unknown>) {
      captured.options.push(options);
    }
    getHistory(): unknown[] {
      return [];
    }
  }
  return { ...mod, AutoLLMClient: FakeAutoLLMClient };
});

const { GenerativeModel } = await import("../src/llm/generative-model.js");

const OPENCODE_GO = "https://opencode.ai/zen/go/v1";

/** The `defaultHeaders` of the client the last constructed model built. */
function lastHeaders(): Record<string, string> | undefined {
  return captured.options.at(-1)?.defaultHeaders as Record<string, string> | undefined;
}

const build = (over: { baseUrl?: string; sessionId?: string }) =>
  new GenerativeModel({
    modelId: "glm-5.3",
    apiKey: "sk-test",
    clientType: "openai-chat",
    tools: [],
    ...over,
  });

describe("GenerativeModel attribution headers", () => {
  it("names a Session's requests after the Session", () => {
    build({ baseUrl: OPENCODE_GO, sessionId: "session-2026-09-30-10-00-00-abcd1234" });
    expect(lastHeaders()).toEqual({
      "User-Agent": `penguinharness/${VERSION}`,
      "x-opencode-session": "session-2026-09-30-10-00-00-abcd1234",
    });
  });

  it("gives a request outside any Session an id of its own, different per instance", () => {
    build({ baseUrl: OPENCODE_GO });
    const first = lastHeaders()?.["x-opencode-session"];
    build({ baseUrl: OPENCODE_GO });
    const second = lastHeaders()?.["x-opencode-session"];
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });

  it("sends only the User-Agent to an endpoint that reads no attribution header", () => {
    build({ baseUrl: "https://api.deepseek.com" });
    expect(lastHeaders()).toEqual({ "User-Agent": `penguinharness/${VERSION}` });
    build({});
    expect(lastHeaders()).toEqual({ "User-Agent": `penguinharness/${VERSION}` });
  });

  it("keeps the id when a rotated credential rebuilds the client", async () => {
    const keys = ["sk-rotated"];
    const model = new GenerativeModel({
      modelId: "glm-5.3",
      apiKey: "sk-first",
      resolveApiKey: async () => keys[0],
      clientType: "openai-chat",
      baseUrl: OPENCODE_GO,
      tools: [],
    });
    const before = lastHeaders()?.["x-opencode-session"];
    await (model as unknown as { refreshApiKey(): Promise<void> }).refreshApiKey();
    expect(captured.options.at(-1)?.apiKey).toBe("sk-rotated");
    expect(lastHeaders()?.["x-opencode-session"]).toBe(before);
  });
});
