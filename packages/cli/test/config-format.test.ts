/**
 * Unit tests for `config model list` rendering: provider and model_id are separate
 * columns (stored fields as-is, with the default model marked `*` before the provider
 * column; the request column was removed along with concatenated storage); vision is the
 * entry's own annotation, supported when absent; api_key is masked inline; fully empty
 * columns are omitted automatically; the connection columns show what the model is used with,
 * read from the file alone, marking a group value `(provider)` and an environment key `(env)`.
 * The groups block above the models shows what each `[providers.<id>]` table stores.
 */
import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "@prismshadow/penguin-core";
import { formatGroupRows, formatModelRows } from "../src/commands/config.js";

describe("formatModelRows", () => {
  const cfg: ProjectConfig = {
    default_model: { provider: "anthropic", model_id: "claude-sonnet-4-6" },
    models: [
      {
        provider: "anthropic",
        model_id: "claude-sonnet-4-6",
        context_window: 1000000,
        pricing: { unit: "usd_per_mtok", cache_read: 0.3, cache_write: 3.75, output: 15 },
      },
      {
        provider: "custom",
        model_id: "my-proxy-model",
        client_type: "openai",
        vision: false,
        api_key: "sk-test-abcd-1234",
      },
    ],
  };

  it("provider and model_id shown as two columns, the default model marked with *", () => {
    const lines = formatModelRows(cfg);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\* anthropic\s+claude-sonnet-4-6\s+vision=Y/);
    expect(lines[0]).toContain("price=0.3/3.75/15");
    // The request column was removed; no <provider>/<id> concatenation appears anymore.
    expect(lines[0]).not.toContain("request=");
    expect(lines[0]).not.toContain("anthropic/claude-sonnet-4-6");
  });

  it("vision follows the entry's annotation (explicit false shown as -); inline api_key displayed masked", () => {
    const lines = formatModelRows(cfg);
    expect(lines[1]).toMatch(/^ {2}custom\s+my-proxy-model\s+vision=-/);
    expect(lines[1]).toContain("client_type=openai");
    expect(lines[1]).toContain("api_key=****1234");
    expect(lines[1]).not.toContain("sk-test-abcd-1234");
  });

  it("a row with no vision annotation reads as supported, whatever the catalog says about it", () => {
    // The catalog marks deepseek-v4-pro text-only; the file is what counts, and a new
    // Project's file says so with `vision = false` on the row.
    const [bare, marked] = formatModelRows({
      models: [
        { provider: "deepseek", model_id: "deepseek-v4-pro" },
        { provider: "deepseek", model_id: "deepseek-v4-pro-copy", vision: false },
      ],
    });
    expect(bare).toContain("vision=Y");
    expect(marked).toContain("vision=-");
  });

  it("two providers sharing a model_id each get their own row; the default marker lands only on the exact pair match", () => {
    const lines = formatModelRows({
      default_model: { provider: "deepseek", model_id: "m1" },
      models: [
        { provider: "deepseek", model_id: "m1" },
        { provider: "siliconflow", model_id: "m1" },
      ],
    });
    expect(lines[0]).toMatch(/^\* deepseek\s+m1\s+vision=Y/);
    expect(lines[1]).toMatch(/^ {2}siliconflow\s+m1\s+vision=Y/);
  });

  it('unannotated vision defaults to "supported" and shows Y; fully empty columns are omitted', () => {
    const lines = formatModelRows({
      models: [{ provider: "custom", model_id: "m1" }],
    });
    expect(lines[0]).toBe("  custom  m1  vision=Y  api_key=-");
  });
});

describe("formatModelRows: the connection a model is used with", () => {
  const row = { provider: "deepseek", model_id: "deepseek-flash" };
  const env = { DEEPSEEK_API_KEY: "sk-env-deepseek-7777" };

  it("a keyless model the environment covers shows that key, marked (env)", () => {
    const [line] = formatModelRows({ models: [row] }, env);
    expect(line).toContain("api_key=****7777 (env)");
    expect(line).not.toContain("sk-env-deepseek-7777");
  });

  it("a group key wins over the environment, marked (provider); a model's own key wins over both", () => {
    const providers = { deepseek: { api_key: "sk-group-deepseek-8888" } };
    const [followed, own] = formatModelRows(
      {
        providers,
        models: [
          row,
          { provider: "deepseek", model_id: "deepseek-v4-pro", api_key: "sk-own-9999-9999" },
        ],
      },
      env,
    );
    expect(followed).toContain("api_key=****8888 (provider)");
    expect(own).toMatch(/api_key=\*{4}9999$/);
  });

  it("a group base URL pointing at a proxy is the model's endpoint, and the environment no longer covers it", () => {
    const [line] = formatModelRows(
      { providers: { deepseek: { base_url: "https://proxy.example/v1" } }, models: [row] },
      env,
    );
    expect(line).toContain("base_url=https://proxy.example/v1 (provider)");
    expect(line).toContain("api_key=-");
  });

  it("a gateway row with no group table shows no endpoint or protocol: the catalog fills nothing in", () => {
    const [line] = formatModelRows({
      models: [{ provider: "openrouter", model_id: "openrouter/free" }],
    });
    expect(line).not.toContain("base_url=");
    expect(line).not.toContain("client_type=");
  });

  it("the group key reaches a model on the group's origin, and not one whose own base URL is elsewhere", () => {
    const [samePath, sameOrigin, elsewhere] = formatModelRows({
      providers: {
        "opencode-go": {
          base_url: "https://opencode.ai/zen/go/v1",
          api_key: "oc-group-key-5555",
        },
      },
      models: [
        { provider: "opencode-go", model_id: "glm-5.3", client_type: "openai-chat" },
        {
          provider: "opencode-go",
          model_id: "claude-sonnet-4.6",
          client_type: "ant-messages",
          base_url: "https://opencode.ai/zen/go",
        },
        {
          provider: "opencode-go",
          model_id: "kimi-k3",
          client_type: "openai-chat",
          base_url: "https://proxy.example/v1",
        },
      ],
    });
    expect(samePath).toContain("api_key=****5555 (provider)");
    expect(sameOrigin).toContain("api_key=****5555 (provider)");
    expect(sameOrigin).toMatch(/base_url=https:\/\/opencode\.ai\/zen\/go$/);
    expect(elsewhere).toContain("api_key=-");
  });
});

describe("formatGroupRows", () => {
  it("lists each group's stored base URL, protocol and masked key, - where the group stores none", () => {
    const lines = formatGroupRows({
      providers: {
        openrouter: {
          base_url: "https://openrouter.ai/api/v1",
          client_type: "openai-responses",
          api_key: "sk-or-group-aaaa",
        },
        vllm: { client_type: "openai-chat-vllm-adapter" },
      },
      models: [],
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^openrouter\s+base_url=https:\/\/openrouter\.ai\/api\/v1\s+client_type=openai-responses\s+api_key=\*{4}aaaa$/,
    );
    expect(lines[0]).not.toContain("sk-or-group-aaaa");
    expect(lines[1]).toMatch(
      /^vllm\s+base_url=-\s+client_type=openai-chat-vllm-adapter\s+api_key=-$/,
    );
  });

  it("prints nothing for a file with no group tables", () => {
    expect(formatGroupRows({ models: [] })).toEqual([]);
    expect(formatGroupRows({ providers: {}, models: [] })).toEqual([]);
  });
});
