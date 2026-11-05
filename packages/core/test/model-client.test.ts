/**
 * Where core builds an MMSP client (llm/model-client.ts), against the real AutoLLMClient: what is
 * under test is what MMSP's clients do with the values core hands them, so nothing fakes the
 * MMSP boundary; only `fetch` is stubbed, and the environment is set per test (PRN-021: the
 * environment-key rule is MMSP's, and core keeps no copy of it).
 *
 * - Given a model with no key and a base URL other than its client's default endpoint, building
 *   its client fails before any request with a ModelCredentialError that says "API key" (what
 *   hosts classify a missing credential by) and names the model, the URL and the client's
 *   variables, whatever the environment holds.
 * - Given no key and the client's own default endpoint, or no base URL, the client is built and
 *   reads its variable: a listing of the default endpoint goes out with the environment's key.
 * - Given no key and another base URL, an endpoint listing is refused before any request, with
 *   the listing's own message.
 * - Given the mmsp client with a base URL and no key, the open MMSP server is listed keyless,
 *   even with MMSP_API_KEY set.
 * - Given any other construction failure, it passes through unchanged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerativeModel } from "../src/llm/generative-model.js";
import { listEndpointModels } from "../src/llm/list-models.js";
import { ModelCredentialError } from "../src/llm/model-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A `fetch` that answers every request with a one-model listing, recording what it was sent. */
function stubListingFetch() {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    Response.json({ object: "list", data: [{ id: "m-1" }] }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The error building a model's client throws, or undefined when it builds. */
function buildError(config: { modelId: string; baseUrl?: string; clientType?: string }) {
  try {
    new GenerativeModel({ ...config, tools: [] });
    return undefined;
  } catch (err) {
    return err;
  }
}

describe("building a model's client: MMSP decides what a missing key means", () => {
  it("a keyless model sent to another base URL is refused at construction, in the Project config's terms", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-deepseek-env");
    for (const baseUrl of ["https://gw.example/v1", "https://proxy.example/deepseek"]) {
      const err = buildError({ modelId: "deepseek-flash", baseUrl });
      expect(err, baseUrl).toBeInstanceOf(ModelCredentialError);
      const message = (err as Error).message;
      expect(message).toMatch(/API key/);
      for (const part of ["deepseek-flash", baseUrl, "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"]) {
        expect(message, part).toContain(part);
      }
    }
    // A pinned protocol names its own client's variables.
    const pinned = buildError({
      modelId: "glm-5.3",
      clientType: "openai-chat",
      baseUrl: "https://gw.example/v1",
    });
    expect(pinned).toBeInstanceOf(ModelCredentialError);
    expect((pinned as Error).message).toContain("OPENAI_API_KEY");
  });

  it("a keyless model on its client's default endpoint, or with no base URL, is built", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-deepseek-env");
    for (const baseUrl of [undefined, "https://api.deepseek.com", "https://API.deepseek.com/"]) {
      expect(buildError({ modelId: "deepseek-flash", baseUrl }), String(baseUrl)).toBeUndefined();
    }
  });

  it("any other construction failure passes through unchanged", () => {
    const err = buildError({ modelId: "m", clientType: "not-a-client" });
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ModelCredentialError);
    expect((err as Error).message).toMatch(/Unknown client type/);
  });
});

describe("listEndpointModels on the wire: the key and base URL go to MMSP as given", () => {
  it("a keyless listing of the client's default endpoint goes out with the environment's key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-env");
    const fetchMock = stubListingFetch();
    const models = await listEndpointModels({
      clientType: "openai-chat",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(models).toEqual(["m-1"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/models");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-openai-env");
  });

  it("a keyless listing of another base URL is refused before any request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-env");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-anthropic-env");
    const fetchMock = stubListingFetch();
    for (const [clientType, baseUrl] of [
      ["openai-chat", "https://gw.example.com/v1"],
      ["ant-messages", "http://127.0.0.1:8000"],
    ] as const) {
      const err = await listEndpointModels({ clientType, baseUrl }).catch((e: unknown) => e);
      expect(err, baseUrl).toBeInstanceOf(ModelCredentialError);
      expect((err as Error).message).toBe(
        `No API key for ${baseUrl}: enter the endpoint's API key.`,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an open MMSP server is listed with no key on the wire", async () => {
    vi.stubEnv("MMSP_API_KEY", "sk-mmsp-env");
    const fetchMock = stubListingFetch();
    const models = await listEndpointModels({
      clientType: "mmsp",
      baseUrl: "http://127.0.0.1:25752/v1",
    });
    expect(models).toEqual(["m-1"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:25752/v1/models");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });
});
