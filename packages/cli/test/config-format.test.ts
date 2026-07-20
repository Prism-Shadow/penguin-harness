/**
 * Unit tests for `config model list` rendering: provider and model_id are separate
 * columns (stored fields as-is, with the default model marked `*` before the provider
 * column; the request column was removed along with concatenated storage); vision falls
 * back to the catalog matched by the (provider, model_id) pair; api_key is masked
 * inline; fully empty columns are omitted automatically.
 */
import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "@prismshadow/penguin-core";
import { formatModelRows } from "../src/commands/config.js";

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

  it("provider and model_id shown as two columns; preset model vision resolved by catalog pair match, default model marked with *", () => {
    const lines = formatModelRows(cfg);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\* anthropic\s+claude-sonnet-4-6\s+vision=Y/);
    expect(lines[0]).toContain("price=0.3/3.75/15");
    // The request column was removed; no <provider>/<id> concatenation appears anymore.
    expect(lines[0]).not.toContain("request=");
    expect(lines[0]).not.toContain("anthropic/claude-sonnet-4-6");
  });

  it("custom model vision follows its annotation (explicit false shown as -); inline api_key displayed masked", () => {
    const lines = formatModelRows(cfg);
    expect(lines[1]).toMatch(/^ {2}custom\s+my-proxy-model\s+vision=-/);
    expect(lines[1]).toContain("client_type=openai");
    expect(lines[1]).toContain("api_key=****1234");
    expect(lines[1]).not.toContain("sk-test-abcd-1234");
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
