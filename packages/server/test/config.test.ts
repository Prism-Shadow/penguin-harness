/**
 * resolveServerConfig parsing tests.
 *
 * PORT: both the default (missing) and empty string (the common `PORT=` empty value in
 * `.env`) fall back to 7364 — Number("") === 0 used to make the empty string pass range
 * validation and bind to a random port; explicit "0" is preserved (explicit semantics
 * for a random available port); invalid values throw. This matches the CLI's
 * resolvePort semantics (packages/cli serve).
 * PENGUIN_SEED_ADMIN_PASSWORD: unset/empty/whitespace → null (random seed password).
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

describe("resolveServerConfig: desktop-mode seed password", () => {
  it("desktop mode leaves the seed unpinned, exactly like every other mode", () => {
    // Nothing pins it: the password the seed generates on its own is already unguessable, so
    // supplying one here would just be a second way to say the same thing.
    expect(
      resolveServerConfig({ ...base, PENGUIN_DESKTOP_TOKEN: "tok" }).seedAdminPassword,
    ).toBeNull();
  });

  it("an explicit PENGUIN_SEED_ADMIN_PASSWORD still wins in desktop mode", () => {
    expect(
      resolveServerConfig({
        ...base,
        PENGUIN_DESKTOP_TOKEN: "tok",
        PENGUIN_SEED_ADMIN_PASSWORD: "penguin-2026",
      }).seedAdminPassword,
    ).toBe("penguin-2026");
  });

  it("outside desktop mode the unpinned value stays null (the seed generates one)", () => {
    expect(resolveServerConfig({ ...base }).seedAdminPassword).toBeNull();
  });
});

describe("resolveServerConfig: PENGUIN_SEED_ADMIN_PASSWORD parsing", () => {
  it("unset/empty/whitespace → null; a value is kept trimmed", () => {
    expect(resolveServerConfig({ ...base }).seedAdminPassword).toBeNull();
    expect(
      resolveServerConfig({ ...base, PENGUIN_SEED_ADMIN_PASSWORD: "" }).seedAdminPassword,
    ).toBeNull();
    expect(
      resolveServerConfig({ ...base, PENGUIN_SEED_ADMIN_PASSWORD: "  " }).seedAdminPassword,
    ).toBeNull();
    expect(
      resolveServerConfig({ ...base, PENGUIN_SEED_ADMIN_PASSWORD: " penguin-9999 " })
        .seedAdminPassword,
    ).toBe("penguin-9999");
  });
});

describe("resolveServerConfig: PENGUIN_PINNED_AGENT", () => {
  it("parses <projectId>/<agentId>; unset or empty is an ordinary multi-agent server", () => {
    expect(resolveServerConfig({ ...base }).pinnedAgent).toBeNull();
    expect(resolveServerConfig({ ...base, PENGUIN_PINNED_AGENT: "  " }).pinnedAgent).toBeNull();
    expect(
      resolveServerConfig({ ...base, PENGUIN_PINNED_AGENT: "default_project/researcher" })
        .pinnedAgent,
    ).toEqual({ projectId: "default_project", agentId: "researcher" });
  });

  it("throws on anything that is not exactly two ids, rather than starting unpinned", () => {
    // Both halves are spliced into filesystem paths, so a traversal attempt is a hard failure —
    // and so is a value with the wrong shape: silently serving every agent is the opposite of
    // what the operator asked for.
    for (const bad of ["bad", "a/b/c", "../x/y", "a/", "/b", "a b/c"]) {
      expect(() => resolveServerConfig({ ...base, PENGUIN_PINNED_AGENT: bad }), bad).toThrow(
        /Invalid PENGUIN_PINNED_AGENT/,
      );
    }
  });
});
