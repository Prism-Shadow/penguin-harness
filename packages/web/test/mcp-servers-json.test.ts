import { describe, expect, it } from "vitest";
import { formatMcpServersJson, parseMcpServersJson } from "../src/features/agents/mcp-servers-json";

describe("parseMcpServersJson", () => {
  it("treats whitespace-only text as an empty list", () => {
    expect(parseMcpServersJson("")).toEqual({ ok: true, servers: [] });
    expect(parseMcpServersJson("  \n ")).toEqual({ ok: true, servers: [] });
  });

  it("round-trips entries through format + parse, keeping unknown config keys", () => {
    const servers = [
      { name: "fs", config: { command: "npx", args: ["-y", "pkg"], custom: { deep: true } } },
      { name: "web", config: { transport: "http", url: "https://x/mcp" } },
    ];
    const parsed = parseMcpServersJson(formatMcpServersJson(servers));
    expect(parsed).toEqual({ ok: true, servers });
  });

  it("reports JSON syntax errors", () => {
    const res = parseMcpServersJson("[{");
    expect(res.ok).toBe(false);
  });

  it.each([
    ["non-array top level", `{"name":"a"}`, /top level must be an array/],
    ["non-object entry", `[1]`, /entry 1 must be an object/],
    ["missing name", `[{"config":{}}]`, /"name" must be a non-empty string/],
    ["blank name", `[{"name":"  ","config":{}}]`, /"name" must be a non-empty string/],
    ["missing config", `[{"name":"a"}]`, /"config" must be an object/],
    ["array config", `[{"name":"a","config":[]}]`, /"config" must be an object/],
  ])("rejects %s", (_label, text, pattern) => {
    const res = parseMcpServersJson(text);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(pattern);
  });

  it("points at the offending entry by 1-based position", () => {
    const res = parseMcpServersJson(`[{"name":"a","config":{}},{"name":""}]`);
    expect(res).toEqual({
      ok: false,
      error: 'entry 2: "name" must be a non-empty string',
    });
  });
});
