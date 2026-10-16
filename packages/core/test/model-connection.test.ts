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
 * Credential:
 * - Given a key on the row, or the group's key that reaches it, it is used as written, and the
 *   environment is never read.
 * - Given an official group with no base URL, a keyless row is handed nothing: the routed
 *   client reads its own variable pair, whether or not the variable is set.
 * - Given an official group with a base URL, a keyless row gets the variable the group's
 *   protocol reads passed explicitly, when its own protocol reads the same one; unset is refused,
 *   naming the variable; a group with no protocol to name one is refused, naming the fix.
 * - Given an official group with a base URL, a row pinned to a client that reads another
 *   vendor's variable is refused, telling the user to set the key on the row, and that vendor's
 *   variable is never read — let alone sent to the group's endpoint.
 * - Given an official group, a row that names its own base URL is refused, never lent the
 *   environment — even when that base URL is the vendor's own.
 * - Given a group that is not official, a keyless row is refused whatever vendor variables are
 *   set, and the message says "API key" (what hosts classify a missing credential by).
 * - Given an mmsp row with a base URL and no key (an open MMSP server, the Penguin Go relay),
 *   it goes out keyless; a relay variable in the environment is never read.
 * - Given a keyless Bedrock row, the refusal names the way out.
 * - Given Session creation's explicit pair, it sits above the row; a blank one is no override.
 * - Given no key, the endpoint listing is refused before any client exists, except on an open
 *   MMSP server, which is listed keyless on the wire.
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
  environmentKeyRoute,
  groupKeyReaches,
  keylessEndpoint,
  providerConnectionShape,
  resolveEntryCredential,
  sameEndpoint,
} from "../src/state/index.js";

const VENDOR_ENV = {
  OPENAI_API_KEY: "sk-openai-env",
  ANTHROPIC_API_KEY: "sk-anthropic-env",
  GEMINI_API_KEY: "sk-gemini-env",
  DEEPSEEK_API_KEY: "sk-deepseek-env",
  ZAI_API_KEY: "sk-zai-env",
  PENGUIN_GO_API_KEY: "pg-env",
};

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
    ).toEqual({ baseUrlSource: "none", clientTypeSource: "none", apiKeySource: "none" });
    const group = providerConnectionShape({
      base_url: "http://127.0.0.1:11434/v1",
      client_type: "openai",
      official: false,
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
    expect(
      effectiveConnection(
        { provider: "x", modelId: "m", baseUrl: row },
        { baseUrl: group, apiKey: "sk-group" },
      ).apiKeySource,
    ).toBe(reaches ? "provider" : "none");
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

describe("resolveEntryCredential (PRN-021: the environment follows the group's official flag)", () => {
  const VENDOR_ROW = { provider: "deepseek", model_id: "deepseek-flash" };
  const OFFICIAL = { official: true };

  it("a key on the row, or the group's key that reaches it, is used as written", () => {
    const group = { ...OFFICIAL, apiKey: "sk-group" };
    expect(resolveEntryCredential(VENDOR_ROW, group, {}, VENDOR_ENV)).toEqual({
      apiKey: "sk-group",
    });
    expect(
      resolveEntryCredential({ ...VENDOR_ROW, api_key: "sk-row" }, group, {}, VENDOR_ENV),
    ).toEqual({ apiKey: "sk-row" });
    // A gateway's rows run on the group's key, endpoint and protocol.
    expect(
      resolveEntryCredential(
        { provider: "gw", model_id: "glm-5.3" },
        { baseUrl: "https://gw.example/v1", clientType: "openai-chat", apiKey: "gw-key" },
        {},
        VENDOR_ENV,
      ),
    ).toEqual({ apiKey: "gw-key", baseUrl: "https://gw.example/v1", clientType: "openai-chat" });
  });

  it("an official group with no base URL hands a keyless row nothing, so the routed client reads its own pair", () => {
    expect(resolveEntryCredential(VENDOR_ROW, OFFICIAL, {}, VENDOR_ENV)).toEqual({});
    // The variable being unset is the client's business: still handed nothing (a Bedrock
    // ANTHROPIC_BASE_URL with no ANTHROPIC_API_KEY stays valid).
    expect(resolveEntryCredential(VENDOR_ROW, OFFICIAL, {}, {})).toEqual({});
    // A protocol on the row or the group travels with it.
    expect(
      resolveEntryCredential(VENDOR_ROW, { ...OFFICIAL, clientType: "deepseek-official" }, {}, {}),
    ).toEqual({ clientType: "deepseek-official" });
  });

  it("an official group with a base URL passes its protocol's variable explicitly, to a row whose protocol reads the same one", () => {
    const zai = {
      official: true,
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      clientType: "zai-official",
    };
    const row = { provider: "zhipu", model_id: "glm-5.3" };
    expect(resolveEntryCredential(row, zai, {}, VENDOR_ENV)).toEqual({
      apiKey: "sk-zai-env",
      baseUrl: zai.baseUrl,
      clientType: "zai-official",
    });
    // A row pinned to another client that reads the group's variable still gets it.
    const openai = {
      official: true,
      baseUrl: "https://api.openai.com/v1",
      clientType: "openai-official",
    };
    expect(
      resolveEntryCredential(
        { provider: "openai", model_id: "gpt-6", client_type: "openai-chat" },
        openai,
        {},
        VENDOR_ENV,
      ),
    ).toEqual({ apiKey: "sk-openai-env", baseUrl: openai.baseUrl, clientType: "openai-chat" });
    // Unset: refused, naming the variable, before any client exists.
    expect(() => resolveEntryCredential(row, zai, {}, { OPENAI_API_KEY: "x" })).toThrow(
      /has no API key.*ZAI_API_KEY/,
    );
    // No group protocol to name one, or one MMSP does not have: refused, naming the fix — even
    // for a row whose own protocol would name one.
    for (const clientType of [undefined, "not-a-client"]) {
      for (const own of [undefined, "zai-official"]) {
        expect(() =>
          resolveEntryCredential(
            { ...row, client_type: own },
            { ...zai, clientType },
            {},
            VENDOR_ENV,
          ),
        ).toThrow(/has no API key.*set the group's protocol/);
      }
    }
  });

  it("a row pinned to another vendor's client in an official group with a base URL is refused, and that vendor's key is never read", () => {
    // An official OpenAI group on OpenAI's endpoint, holding a row pinned to Anthropic's client.
    const openai = {
      official: true,
      baseUrl: "https://api.openai.com/v1",
      clientType: "openai-official",
    };
    const row = {
      provider: "openai",
      model_id: "claude-sonnet-5",
      client_type: "anthropic-official",
    };
    const read: string[] = [];
    const env = new Proxy(VENDOR_ENV as Record<string, string | undefined>, {
      get(target, key) {
        if (typeof key === "string") read.push(key);
        return target[key as string];
      },
    });
    let refusal: unknown;
    try {
      resolveEntryCredential(row, openai, {}, env);
    } catch (err) {
      refusal = err;
    }
    expect(refusal).toBeInstanceOf(ModelCredentialError);
    expect((refusal as Error).message).toMatch(
      /has no API key.*anthropic-official.*set the API key on the model entry/,
    );
    expect((refusal as Error).message).not.toContain(VENDOR_ENV.ANTHROPIC_API_KEY);
    expect(read).not.toContain("ANTHROPIC_API_KEY");
    expect(environmentKeyRoute({ clientType: "anthropic-official" }, openai)).toEqual({
      kind: "foreign",
      clientType: "anthropic-official",
    });
    // A protocol MMSP does not have reads no variable of the group's either.
    expect(() =>
      resolveEntryCredential({ ...row, client_type: "not-a-client" }, openai, {}, VENDOR_ENV),
    ).toThrow(/set the API key on the model entry/);
    // With no base URL, the pinned client goes to its own vendor's endpoint with its own
    // variable, read by the client itself: nothing is handed over, nothing is refused.
    expect(resolveEntryCredential(row, { official: true }, {}, env)).toEqual({
      clientType: "anthropic-official",
    });
    expect(read).not.toContain("ANTHROPIC_API_KEY");
  });

  it("a row that names its own base URL gets no environment key, even in an official group and on the vendor's own endpoint", () => {
    for (const baseUrl of ["https://api.deepseek.com", "https://proxy.example/deepseek"]) {
      const row = { ...VENDOR_ROW, base_url: baseUrl };
      expect(() => resolveEntryCredential(row, OFFICIAL, {}, VENDOR_ENV), baseUrl).toThrow(
        /has no API key.*names a base URL of its own/,
      );
      // An explicit override base URL is the row's own too.
      expect(
        () => resolveEntryCredential(VENDOR_ROW, OFFICIAL, { baseUrl }, VENDOR_ENV),
        baseUrl,
      ).toThrow(ModelCredentialError);
    }
    expect(
      environmentKeyRoute({ baseUrl: "https://api.deepseek.com" }, { official: true }),
    ).toBeUndefined();
  });

  it("a keyless row of a group that is not official is refused, whatever vendor variables are set", () => {
    for (const group of [
      undefined,
      { official: false },
      { baseUrl: "https://gw.example/v1", clientType: "openai-chat" },
      // The vendor's own endpoint does not make a group official: the flag does.
      { baseUrl: "https://api.openai.com/v1", clientType: "openai-chat" },
      { baseUrl: "https://gw.example/v1", clientType: "openai-chat", apiKey: "  " },
    ]) {
      expect(() =>
        resolveEntryCredential({ provider: "gw", model_id: "gpt-6" }, group, {}, VENDOR_ENV),
      ).toThrow(/has no API key.*not marked official/);
    }
  });

  it("a Penguin Go-shaped row goes out keyless on its relay unless the config has a key, and the relay variable is never read", () => {
    const relay = { baseUrl: "https://relay.example/api/v1", clientType: "mmsp" };
    const row = { provider: "penguin-go", model_id: "gemini-3.8-flash" };
    expect(resolveEntryCredential(row, relay, {}, VENDOR_ENV)).toEqual(relay);
    expect(resolveEntryCredential(row, { ...relay, apiKey: "pg-config" }, {}, VENDOR_ENV)).toEqual({
      ...relay,
      apiKey: "pg-config",
    });
    expect(keylessEndpoint("mmsp", relay.baseUrl)).toBe(true);
    // The open-server exception is the mmsp client's alone, and needs a base URL.
    expect(keylessEndpoint("openai-chat", relay.baseUrl)).toBe(false);
    expect(keylessEndpoint("mmsp", undefined)).toBe(false);
    expect(() =>
      resolveEntryCredential(row, { ...relay, clientType: "openai-chat" }, {}, VENDOR_ENV),
    ).toThrow(ModelCredentialError);
  });

  it("refuses a keyless Bedrock row with a message that names the way out", () => {
    expect(() =>
      resolveEntryCredential(
        { provider: "anthropic", model_id: "claude-sonnet-5", base_url: "bedrock://us-east-1" },
        { official: true },
        {},
        { ANTHROPIC_API_KEY: "sk-ant" },
      ),
    ).toThrow(/Bedrock endpoint.*ANTHROPIC_BASE_URL=bedrock:\/\/us-east-1/);
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
      resolveEntryCredential(
        row,
        undefined,
        { apiKey: "sk-explicit", baseUrl: "https://explicit.example/v1" },
        {},
      ),
    ).toEqual({
      apiKey: "sk-explicit",
      baseUrl: "https://explicit.example/v1",
      clientType: "openai-chat",
    });
    expect(resolveEntryCredential(row, undefined, { apiKey: "", baseUrl: " " }, {})).toEqual({
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
