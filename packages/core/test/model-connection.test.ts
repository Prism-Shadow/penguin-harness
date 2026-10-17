/**
 * A row's effective connection and the credential its MMSP client is built with, decided from
 * the Project config alone (PRN-021). No catalog data: every group here is a fixture table.
 *
 * Effective connection:
 * - Per field, a row's own base URL / protocol wins over its group's table; blank counts as
 *   absent at every level; with neither, the row has none (the client's default).
 * - A group's key follows its endpoint (groupKeyReaches): it reaches a row with no base URL of
 *   its own, or one on the group's origin, and nothing else.
 *
 * Credential (no environment is ever read here: the resolver takes none):
 * - Given a key on the row, or the group's key that reaches it, it is used as written.
 * - Given no base URL on the row or its group, a keyless row is handed nothing, whatever it
 *   pins: the routed client reads its own variable pair.
 * - Given a base URL on the row or on the group — the vendor's own included — a keyless row is
 *   refused before any client exists, with one message that says "API key" (what hosts classify
 *   a missing credential by), names the URL, and names the `*_API_KEY` / `*_BASE_URL` pair only
 *   when the row's protocol is pinned (a Bedrock region included).
 * - Given an mmsp row with a base URL and no key (an open MMSP server, the Penguin Go relay),
 *   it goes out keyless.
 * - Given Session creation's explicit pair, it sits above the row, an override base URL counting
 *   as the row's own; a blank one is no override.
 * - Given no key, the endpoint listing of a base URL is refused before any client exists,
 *   except on an open MMSP server, which is listed keyless on the wire (list-endpoint-models
 *   holds the no-base-URL case).
 * - Given the installed MMSP, every client type the table names constructs (the gemini-official
 *   alias included), and a name the table lacks is one MMSP refuses too.
 */
import { describe, expect, it, vi } from "vitest";
import { AutoLLMClient } from "@prismshadow/mmsp";
import { listEndpointModels } from "../src/llm/list-models.js";
import {
  MMSP_CLIENTS,
  ModelCredentialError,
  effectiveConnection,
  groupKeyReaches,
  keylessEndpoint,
  providerConnectionShape,
  resolveEntryCredential,
  sameEndpoint,
} from "../src/state/index.js";

describe("effectiveConnection (a row follows its group's table, then nothing)", () => {
  const ROW = { provider: "gw", modelId: "m-1" };
  const GROUP = { baseUrl: "https://group.example/v1", clientType: "openai-responses" };

  it.each([
    [
      "the row's own value wins",
      { baseUrl: "https://row.example/v1", clientType: "ant-messages" },
      GROUP,
      "https://row.example/v1",
      "ant-messages",
      "model",
    ],
    [
      "the group's wins where the row has none",
      {},
      GROUP,
      GROUP.baseUrl,
      GROUP.clientType,
      "provider",
    ],
    ["nothing is used where neither has one", {}, undefined, undefined, undefined, "none"],
    [
      "nothing is used where both are blank",
      { baseUrl: " ", clientType: "" },
      { baseUrl: "", clientType: "  " },
      undefined,
      undefined,
      "none",
    ],
  ] as const)("base URL and protocol: %s", (_, row, group, baseUrl, clientType, source) => {
    const effective = effectiveConnection({ ...ROW, ...row }, group);
    expect(effective.baseUrl).toBe(baseUrl);
    expect(effective.clientType).toBe(clientType);
    expect([effective.baseUrlSource, effective.clientTypeSource]).toEqual([source, source]);
  });

  it("a group table covers a row that stores nothing, and the deprecated protocol spelling converges", () => {
    expect(
      effectiveConnection({ provider: "my-ollama", modelId: "qwen-local" }, undefined),
    ).toEqual({ baseUrlSource: "none", clientTypeSource: "none", apiKeySource: "env" });
    const group = providerConnectionShape({
      base_url: "http://127.0.0.1:11434/v1",
      client_type: "openai",
    });
    expect(effectiveConnection({ provider: "my-ollama", modelId: "qwen-local" }, group)).toEqual({
      baseUrl: "http://127.0.0.1:11434/v1",
      baseUrlSource: "provider",
      clientType: "openai-chat",
      clientTypeSource: "provider",
      apiKeySource: "none",
    });
    expect(providerConnectionShape(undefined)).toBeUndefined();
  });

  it.each([
    [
      "a row on another host than the group",
      "https://api.example.com",
      "http://127.0.0.1:11434/v1",
      false,
    ],
    [
      "a row with its own base URL, the group with none",
      "https://api.example.com",
      undefined,
      false,
    ],
    [
      "a row with no base URL of its own, the group on a relay",
      undefined,
      "https://relay.example/api/v1",
      true,
    ],
    ["a row with no base URL of its own, the group on none either", undefined, undefined, true],
    [
      "a blank base URL of its own, the group on a gateway",
      "  ",
      "https://gw.example/api/v1",
      true,
    ],
    [
      "another path on the group's host",
      "https://gw.example/zen/go",
      "https://gw.example/zen/go/v1",
      true,
    ],
    [
      "host case and the scheme's default port are the same origin",
      "https://GW.example:443/zen/go",
      "https://gw.example/zen/go/v1",
      true,
    ],
    ["the same host on another port", "http://gpu-box:8001/v1", "http://gpu-box:8000/v1", false],
    [
      "the same host on another scheme",
      "http://gw.example/api/v1",
      "https://gw.example/api/v1",
      false,
    ],
    ["a base URL that does not parse", "not a url", "not a url", false],
  ] as const)("groupKeyReaches: %s", (_, row, group, reaches) => {
    expect(groupKeyReaches(row, group)).toBe(reaches);
    // effectiveConnection applies it: the group's key is the row's only where it reaches.
    const effective = effectiveConnection(
      { provider: "x", modelId: "m", baseUrl: row },
      { baseUrl: group, apiKey: "sk-group" },
    );
    expect(effective.apiKey).toBe(reaches ? "sk-group" : undefined);
    expect(effective.apiKeySource).not.toBe("model");
  });

  it("sameEndpoint ignores case in the host and trailing slashes, and nothing else", () => {
    expect(sameEndpoint("https://API.Example.com/v1/", "https://api.example.com/v1")).toBe(true);
    expect(sameEndpoint("https://api.example.com/v1", "https://api.example.com/v2")).toBe(false);
    expect(sameEndpoint("https://api.example.com/v1", "https://api.example.com")).toBe(false);
    expect(sameEndpoint("http://host:8000/v1", "http://host:8001/v1")).toBe(false);
    expect(sameEndpoint("not a url", "not a url")).toBe(false);
    // The cases that make this a security check: a string-prefix "simplification" would pass
    // each of them.
    const own = "https://api.example.com/v1";
    expect(sameEndpoint(own, "https://api.example.com.evil.example/v1")).toBe(false);
    expect(sameEndpoint(own, "https://api.example.com@evil.example/v1")).toBe(false);
    expect(sameEndpoint(own, "http://api.example.com/v1")).toBe(false);
  });
});

describe("resolveEntryCredential (PRN-021: the environment only where no base URL is set)", () => {
  const VENDOR_ROW = { provider: "deepseek", model_id: "deepseek-flash" };

  /** The ModelCredentialError a resolution throws, or a failure when it resolves. */
  function refusal(...args: Parameters<typeof resolveEntryCredential>): ModelCredentialError {
    try {
      resolveEntryCredential(...args);
    } catch (err) {
      expect(err).toBeInstanceOf(ModelCredentialError);
      return err as ModelCredentialError;
    }
    throw new Error("expected a refusal");
  }

  it("a key on the row, or the group's key that reaches it, is used as written", () => {
    const group = { apiKey: "sk-group" };
    expect(resolveEntryCredential(VENDOR_ROW, group)).toEqual({ apiKey: "sk-group" });
    expect(resolveEntryCredential({ ...VENDOR_ROW, api_key: "sk-row" }, group)).toEqual({
      apiKey: "sk-row",
    });
    // A gateway's rows run on the group's key, endpoint and protocol.
    expect(
      resolveEntryCredential(
        { provider: "gw", model_id: "glm-5.3" },
        { baseUrl: "https://gw.example/v1", clientType: "openai-chat", apiKey: "gw-key" },
      ),
    ).toEqual({ apiKey: "gw-key", baseUrl: "https://gw.example/v1", clientType: "openai-chat" });
  });

  it("with no base URL on the row or its group, a keyless row is handed nothing, so the routed client reads its own pair", () => {
    for (const group of [undefined, {}, { baseUrl: "  ", apiKey: "" }]) {
      expect(resolveEntryCredential(VENDOR_ROW, group)).toEqual({});
    }
    // A protocol on the row or the group travels with it, and no key is ever added: a row
    // pinned to another vendor's client goes to that vendor's endpoint with that vendor's
    // variable, both read by the client itself.
    expect(resolveEntryCredential(VENDOR_ROW, { clientType: "deepseek-official" })).toEqual({
      clientType: "deepseek-official",
    });
    expect(
      resolveEntryCredential(
        { provider: "openai", model_id: "claude-sonnet-5", client_type: "anthropic-official" },
        { clientType: "openai-official" },
      ),
    ).toEqual({ clientType: "anthropic-official" });
    // A custom or self-hosted protocol row with no base URL anywhere is no exception.
    expect(
      resolveEntryCredential(
        { provider: "custom", model_id: "qwen-local", client_type: "openai-chat" },
        undefined,
      ),
    ).toEqual({ clientType: "openai-chat" });
  });

  it("a keyless row sent to a base URL from the file is refused, the vendor's own endpoint included", () => {
    const cases: Array<[string, Parameters<typeof resolveEntryCredential>]> = [
      ["the vendor's own URL on the group", [VENDOR_ROW, { baseUrl: "https://api.deepseek.com" }]],
      [
        "the vendor's own URL on the row",
        [{ ...VENDOR_ROW, base_url: "https://api.deepseek.com" }, undefined],
      ],
      ["a proxy on the row", [{ ...VENDOR_ROW, base_url: "https://proxy.example/deepseek" }, {}]],
      [
        "a gateway group",
        [
          { provider: "gw", model_id: "gpt-6" },
          { baseUrl: "https://gw.example/v1", clientType: "openai-chat" },
        ],
      ],
      [
        "a group key that does not reach a row on another host",
        [
          { ...VENDOR_ROW, base_url: "https://other.example/v1" },
          { baseUrl: "https://gw.example/v1", apiKey: "sk-group" },
        ],
      ],
      [
        "an override base URL, which is the row's own",
        [VENDOR_ROW, undefined, { baseUrl: "https://api.deepseek.com" }],
      ],
    ];
    for (const [name, args] of cases) {
      const err = refusal(...args);
      expect(err.message, name).toMatch(
        /^Model \S+ has no API key\. It is sent to https?:\/\/\S+, so no environment variable is used for it: set the API key on the model entry or its group/,
      );
    }
  });

  it("the refusal names the variable pair only for a pinned protocol, and stops at the config fix otherwise", () => {
    const pinned = refusal(
      { provider: "zhipu", model_id: "glm-5.3", client_type: "zai-official" },
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    );
    expect(pinned.message).toContain(
      "or clear the base URL and set ZAI_API_KEY (and ZAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4 if that endpoint is not the client's default) in the server environment.",
    );
    // A Bedrock region is a base URL like any other: the tail names ANTHROPIC_BASE_URL with it.
    const bedrock = refusal(
      {
        provider: "anthropic",
        model_id: "claude-sonnet-5",
        base_url: "bedrock://us-east-1",
        client_type: "anthropic-official",
      },
      undefined,
    );
    expect(bedrock.message).toContain("ANTHROPIC_BASE_URL=bedrock://us-east-1");
    // With no pinned protocol (or one MMSP does not have), core cannot name the variable.
    for (const clientType of [undefined, "not-a-client"]) {
      const unnamed = refusal(VENDOR_ROW, { baseUrl: "https://api.deepseek.com", clientType });
      expect(unnamed.message).toMatch(/set the API key on the model entry or its group\.$/);
      expect(unnamed.message).not.toContain("_API_KEY");
    }
  });

  it("a Penguin Go-shaped row goes out keyless on its relay unless the config has a key", () => {
    const relay = { baseUrl: "https://relay.example/api/v1", clientType: "mmsp" };
    const row = { provider: "penguin-go", model_id: "gemini-3.8-flash" };
    expect(resolveEntryCredential(row, relay)).toEqual(relay);
    expect(resolveEntryCredential(row, { ...relay, apiKey: "pg-config" })).toEqual({
      ...relay,
      apiKey: "pg-config",
    });
    expect(keylessEndpoint("mmsp", relay.baseUrl)).toBe(true);
    // The open-server exception is the mmsp client's alone, and needs a base URL.
    expect(keylessEndpoint("openai-chat", relay.baseUrl)).toBe(false);
    expect(keylessEndpoint("mmsp", undefined)).toBe(false);
    expect(() => resolveEntryCredential(row, { ...relay, clientType: "openai-chat" })).toThrow(
      ModelCredentialError,
    );
  });

  it("Session creation's explicit pair sits above the row; a blank one is no override", () => {
    const row = {
      provider: "custom",
      model_id: "my-model",
      client_type: "openai-chat",
      base_url: "https://row.example/v1",
      api_key: "sk-row",
    };
    expect(
      resolveEntryCredential(row, undefined, {
        apiKey: "sk-explicit",
        baseUrl: "https://explicit.example/v1",
      }),
    ).toEqual({
      apiKey: "sk-explicit",
      baseUrl: "https://explicit.example/v1",
      clientType: "openai-chat",
    });
    expect(resolveEntryCredential(row, undefined, { apiKey: "", baseUrl: " " })).toEqual({
      apiKey: "sk-row",
      baseUrl: "https://row.example/v1",
      clientType: "openai-chat",
    });
  });
});

describe("listEndpointModels credential gate (the add-group import)", () => {
  it("refuses a keyless listing before any client exists, the vendor's own endpoint included", async () => {
    for (const [clientType, baseUrl] of [
      ["openai-chat", "https://gw.example.com/v1"],
      ["ant-messages", "http://127.0.0.1:8000"],
      ["openai-chat", "https://api.openai.com/v1"],
    ] as const) {
      await expect(listEndpointModels({ clientType, baseUrl })).rejects.toThrow(
        /enter the endpoint's API key/,
      );
    }
  });

  it("lists an open MMSP server with no key on the wire", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ object: "list", data: [{ id: "qwen3.8" }, { id: "gpt-5.5" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("MMSP_API_KEY", "sk-mmsp-env");
    try {
      const models = await listEndpointModels({
        clientType: "mmsp",
        baseUrl: "http://127.0.0.1:25752/v1",
      });
      expect(models).toEqual(["qwen3.8", "gpt-5.5"]);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://127.0.0.1:25752/v1/models");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

describe("MMSP_CLIENTS (core's mirror of MMSP's client types)", () => {
  it("every client type the table names is one the installed MMSP builds, and a name it lacks MMSP refuses", () => {
    // When an MMSP upgrade drops an alias, its row fails here and goes (see
    // changelog/0.2.15/2026-10-10-backward-compatibility.md).
    for (const clientType of Object.keys(MMSP_CLIENTS)) {
      expect(
        () =>
          new AutoLLMClient({
            model: "probe-model",
            clientType,
            apiKey: "sk-probe",
            baseUrl: "https://example.invalid/v1",
          }),
        clientType,
      ).not.toThrow();
    }
    expect(Object.hasOwn(MMSP_CLIENTS, "gemini-3.8")).toBe(false);
    expect(
      () => new AutoLLMClient({ model: "probe-model", clientType: "gemini-3.8", apiKey: "sk" }),
    ).toThrow(/Unknown client type/);
  });
});
