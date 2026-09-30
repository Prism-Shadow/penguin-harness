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
import path from "node:path";
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

describe("resolveServerConfig: PENGUIN_CLI_ENTRY parsing", () => {
  it("a value is kept trimmed — it is what the <root>/bin/penguin shim execs", () => {
    expect(
      resolveServerConfig({ ...base, PENGUIN_CLI_ENTRY: " /opt/penguin/dist/penguin.js " })
        .cliEntry,
    ).toBe("/opt/penguin/dist/penguin.js");
  });

  it("empty/whitespace falls through to the checkout lookup, like unset", () => {
    // What the lookup finds depends on whether this checkout has built its CLI, so the
    // claim here is only that a blank value is not treated as an entry (see cli-shim.test.ts
    // for checkoutCliEntry itself).
    const blank = resolveServerConfig({ ...base, PENGUIN_CLI_ENTRY: "   " }).cliEntry;
    expect(blank).toBe(resolveServerConfig({ ...base }).cliEntry);
    expect(blank === null || blank?.endsWith(`${path.sep}penguin.js`)).toBe(true);
  });
});

describe("resolveServerConfig: PENGUIN_GO_ORIGIN parsing", () => {
  it("defaults to the production HTTPS origin and accepts loopback HTTP for integration", () => {
    expect(resolveServerConfig({ ...base }).penguinGoOrigin).toBe("https://token.penguin.ooo");
    expect(
      resolveServerConfig({ ...base, PENGUIN_GO_ORIGIN: " http://127.0.0.1:3000 " })
        .penguinGoOrigin,
    ).toBe("http://127.0.0.1:3000");
  });

  it("rejects non-origin input and non-loopback plaintext HTTP", () => {
    for (const bad of [
      "http://token.penguin.ooo",
      "https://token.penguin.ooo/path",
      "https://user:pass@token.penguin.ooo",
      "https://token.penguin.ooo?next=x",
    ]) {
      expect(() => resolveServerConfig({ ...base, PENGUIN_GO_ORIGIN: bad }), bad).toThrow(
        /Invalid PENGUIN_GO_ORIGIN/,
      );
    }
  });
});

describe("resolveServerConfig: MODELSCOPE_BRIDGE_URL parsing", () => {
  it("defaults to the production bridge URL", () => {
    expect(resolveServerConfig({ ...base }).modelscopeBridgeUrl).toBe(
      "https://go.penguin.ooo/modelscope",
    );
  });

  it("allows a path prefix but rejects plaintext HTTP, credentials, query and fragment", () => {
    expect(
      resolveServerConfig({
        ...base,
        MODELSCOPE_BRIDGE_URL: " https://go.penguin.ooo/modelscope/ ",
      }).modelscopeBridgeUrl,
    ).toBe("https://go.penguin.ooo/modelscope");

    for (const bad of [
      "http://go.penguin.ooo/modelscope",
      "https://user:pass@go.penguin.ooo/modelscope",
      "https://go.penguin.ooo/modelscope?next=x",
      "https://go.penguin.ooo/modelscope#token",
    ]) {
      expect(() => resolveServerConfig({ ...base, MODELSCOPE_BRIDGE_URL: bad }), bad).toThrow(
        /Invalid MODELSCOPE_BRIDGE_URL/,
      );
    }
  });
});
