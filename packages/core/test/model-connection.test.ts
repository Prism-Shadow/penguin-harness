/**
 * A row's effective connection and the values its MMSP client is built with, decided from the
 * Project config alone (PRN-021). No catalog data: every group here is a fixture table.
 *
 * Effective connection:
 * - Per field, a row's own base URL / protocol / key wins over its group's table; blank counts
 *   as absent at every level; with neither, the row has none (the client's default).
 * - A group's key follows its endpoint (groupKeyReaches): it reaches a row with no base URL of
 *   its own, or one on the group's origin, and nothing else.
 *
 * The values a client is built with (core decides nothing about the environment):
 * - Given a key on the row, or the group's key that reaches it, it is passed as written.
 * - Given a row with no key, only the base URL and protocol the file resolves to are passed, and
 *   nothing for a field the file leaves empty, wherever the base URL points: what a missing key
 *   means is MMSP's to decide when the client is built (model-client.test.ts).
 * - Given Session creation's explicit pair, it sits above the row, an override base URL counting
 *   as the row's own; a blank one is no override.
 */
import { describe, expect, it } from "vitest";
import {
  effectiveConnection,
  groupKeyReaches,
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
    ).toEqual({ baseUrlSource: "none", clientTypeSource: "none", apiKeySource: "none" });
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

describe("resolveEntryCredential (the file's values, verbatim)", () => {
  const VENDOR_ROW = { provider: "deepseek", model_id: "deepseek-flash" };

  it("a key on the row, or the group's key that reaches it, is passed as written", () => {
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

  it("a keyless row is passed only what the file sets, wherever its base URL points", () => {
    // Nothing set anywhere: nothing passed, so MMSP's routed client applies its own defaults.
    for (const group of [undefined, {}, { baseUrl: "  ", apiKey: "" }]) {
      expect(resolveEntryCredential(VENDOR_ROW, group)).toEqual({});
    }
    // A base URL or a protocol from the file travels as written, and no key is ever added —
    // the vendor's own endpoint, a proxy and a gateway alike, and a group key that does not
    // reach a row on another host.
    const cases: Array<[Parameters<typeof resolveEntryCredential>, object]> = [
      [
        [VENDOR_ROW, { baseUrl: "https://api.deepseek.com" }],
        { baseUrl: "https://api.deepseek.com" },
      ],
      [
        [{ ...VENDOR_ROW, base_url: "https://proxy.example/deepseek" }, {}],
        { baseUrl: "https://proxy.example/deepseek" },
      ],
      [
        [
          { provider: "gw", model_id: "gpt-6" },
          { baseUrl: "https://gw.example/v1", clientType: "openai-chat" },
        ],
        { baseUrl: "https://gw.example/v1", clientType: "openai-chat" },
      ],
      [
        [
          { ...VENDOR_ROW, base_url: "https://other.example/v1" },
          { baseUrl: "https://gw.example/v1", apiKey: "sk-group" },
        ],
        { baseUrl: "https://other.example/v1" },
      ],
      [
        [
          { provider: "openai", model_id: "claude-sonnet-5", client_type: "anthropic-official" },
          { clientType: "openai-official" },
        ],
        { clientType: "anthropic-official" },
      ],
      [
        [
          { provider: "penguin-go", model_id: "gemini-3.8-flash" },
          { baseUrl: "https://relay.example/api/v1", clientType: "mmsp" },
        ],
        { baseUrl: "https://relay.example/api/v1", clientType: "mmsp" },
      ],
    ];
    for (const [args, expected] of cases) {
      expect(resolveEntryCredential(...args)).toEqual(expected);
    }
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
    // An override base URL is the row's own: a group key on another origin does not reach it.
    expect(
      resolveEntryCredential(
        VENDOR_ROW,
        { baseUrl: "https://gw.example/v1", apiKey: "sk-group" },
        { baseUrl: "https://explicit.example/v1" },
      ),
    ).toEqual({ baseUrl: "https://explicit.example/v1" });
  });
});
