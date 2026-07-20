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

describe("resolveServerConfig: PORT parsing", () => {
  it("defaults to 7364; empty string treated as unset (does not fall to port 0)", () => {
    expect(resolveServerConfig({ ...base }).port).toBe(7364);
    expect(resolveServerConfig({ ...base, PORT: "" }).port).toBe(7364);
  });

  it('explicit value takes effect; "0" is preserved (binds a random available port)', () => {
    expect(resolveServerConfig({ ...base, PORT: "8930" }).port).toBe(8930);
    expect(resolveServerConfig({ ...base, PORT: "0" }).port).toBe(0);
  });

  it("non-integer or out-of-range values throw", () => {
    for (const bad of ["abc", "3.14", "-1", "65536"]) {
      expect(() => resolveServerConfig({ ...base, PORT: bad }), bad).toThrow(/Invalid port/);
    }
  });
});
