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
  it("desktop mode without a pinned value generates a fully random seed password", () => {
    const a = resolveServerConfig({ ...base, PENGUIN_DESKTOP_TOKEN: "tok" }).seedAdminPassword;
    const b = resolveServerConfig({ ...base, PENGUIN_DESKTOP_TOKEN: "tok" }).seedAdminPassword;
    expect(a).not.toBeNull();
    // base64url of 24 random bytes: far beyond the printable penguin-<4 digits> space.
    expect(a!.length).toBeGreaterThanOrEqual(24);
    expect(a).not.toMatch(/^penguin-\d{4}$/);
    expect(a).not.toBe(b);
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

  it("outside desktop mode the unpinned value stays null (random penguin-<4 digits> at seed time)", () => {
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
