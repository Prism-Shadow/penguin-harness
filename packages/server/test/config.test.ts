/**
 * resolveServerConfig PORT parsing tests: both the default (missing) and empty string
 * (the common `PORT=` empty value in `.env`) fall back to 7364 — Number("") === 0 used
 * to make the empty string pass range validation and bind to a random port; explicit
 * "0" is preserved (explicit semantics for a random available port); invalid values
 * throw. This matches the CLI's resolvePort semantics (packages/cli serve).
 */
import { describe, expect, it } from "vitest";
import { resolveServerConfig } from "../src/config.js";

const base = { PENGUIN_HOME: "/tmp/penguin-config-test" };

describe("resolveServerConfig：PORT 解析", () => {
  it("缺省 7364；空串视为未设置（不落到端口 0）", () => {
    expect(resolveServerConfig({ ...base }).port).toBe(7364);
    expect(resolveServerConfig({ ...base, PORT: "" }).port).toBe(7364);
  });

  it('显式数值生效；显式 "0" 保留（绑随机可用端口）', () => {
    expect(resolveServerConfig({ ...base, PORT: "8930" }).port).toBe(8930);
    expect(resolveServerConfig({ ...base, PORT: "0" }).port).toBe(0);
  });

  it("非整数或超界抛错", () => {
    for (const bad of ["abc", "3.14", "-1", "65536"]) {
      expect(() => resolveServerConfig({ ...base, PORT: bad }), bad).toThrow(/非法端口/);
    }
  });
});
