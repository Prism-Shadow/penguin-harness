/**
 * resolveServerConfig: how the server reads its environment.
 *
 * - An empty PORT (the common `PORT=` line in `.env`) reads as unset, never as port 0; an
 *   explicit value takes effect and an explicit "0" is kept (bind a random free port); a
 *   non-integer or out-of-range value throws. This matches the CLI's resolvePort.
 * - PENGUIN_SEED_ADMIN_PASSWORD: unset, empty or blank leaves the seed unpinned (null, so the
 *   seed generates its own); a value is kept trimmed; desktop mode changes neither.
 * - PENGUIN_CLI_ENTRY: a value is kept trimmed; a blank one falls through to the checkout
 *   lookup like an unset one.
 * - PENGUIN_GO_ORIGIN accepts a loopback HTTP origin for integration work and refuses anything
 *   that is not a bare origin, or plaintext HTTP to another host.
 * - MODELSCOPE_BRIDGE_URL may carry a path prefix but refuses plaintext HTTP, credentials, a
 *   query and a fragment.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveServerConfig } from "../src/config.js";

const base = { PENGUIN_HOME: "/tmp/penguin-config-test" };

describe("resolveServerConfig: PORT parsing", () => {
  it("reads an empty PORT as unset, not as port 0", () => {
    const unset = resolveServerConfig({ ...base }).port;
    expect(unset).not.toBe(0);
    expect(resolveServerConfig({ ...base, PORT: "" }).port).toBe(unset);
  });

  it('takes an explicit value, and keeps "0" (binds a random available port)', () => {
    expect(resolveServerConfig({ ...base, PORT: "8930" }).port).toBe(8930);
    expect(resolveServerConfig({ ...base, PORT: "0" }).port).toBe(0);
  });

  it("throws on a non-integer or out-of-range value", () => {
    for (const bad of ["abc", "3.14", "-1", "65536"]) {
      expect(() => resolveServerConfig({ ...base, PORT: bad }), bad).toThrow(/Invalid port/);
    }
  });
});

describe("resolveServerConfig: seed password", () => {
  it("leaves the seed unpinned when unset, empty or blank, and keeps a value trimmed", () => {
    expect(resolveServerConfig({ ...base }).seedAdminPassword).toBeNull();
    for (const blank of ["", "  "]) {
      expect(
        resolveServerConfig({ ...base, PENGUIN_SEED_ADMIN_PASSWORD: blank }).seedAdminPassword,
      ).toBeNull();
    }
    expect(
      resolveServerConfig({ ...base, PENGUIN_SEED_ADMIN_PASSWORD: " penguin-9999 " })
        .seedAdminPassword,
    ).toBe("penguin-9999");
  });

  it("desktop mode leaves the seed unpinned, and an explicit value still wins there", () => {
    // Nothing pins it: the password the seed generates on its own is already unguessable, so
    // supplying one here would just be a second way to say the same thing.
    const desktop = { ...base, PENGUIN_DESKTOP_TOKEN: "tok" };
    expect(resolveServerConfig(desktop).seedAdminPassword).toBeNull();
    expect(
      resolveServerConfig({ ...desktop, PENGUIN_SEED_ADMIN_PASSWORD: "penguin-2026" })
        .seedAdminPassword,
    ).toBe("penguin-2026");
  });
});

describe("resolveServerConfig: PENGUIN_CLI_ENTRY parsing", () => {
  it("keeps a value trimmed — it is what the <root>/bin/penguin shim execs", () => {
    expect(
      resolveServerConfig({ ...base, PENGUIN_CLI_ENTRY: " /opt/penguin/dist/penguin.js " })
        .cliEntry,
    ).toBe("/opt/penguin/dist/penguin.js");
  });

  it("falls through to the checkout lookup on a blank value, like unset", () => {
    // What the lookup finds depends on whether this checkout has built its CLI, so the
    // claim here is only that a blank value is not treated as an entry (see cli-shim.test.ts
    // for checkoutCliEntry itself).
    const blank = resolveServerConfig({ ...base, PENGUIN_CLI_ENTRY: "   " }).cliEntry;
    expect(blank).toBe(resolveServerConfig({ ...base }).cliEntry);
    expect(blank === null || blank?.endsWith(`${path.sep}penguin.js`)).toBe(true);
  });
});

describe("resolveServerConfig: PENGUIN_GO_ORIGIN parsing", () => {
  it("accepts a loopback HTTP origin for integration work, trimmed", () => {
    expect(
      resolveServerConfig({ ...base, PENGUIN_GO_ORIGIN: " http://127.0.0.1:3000 " })
        .penguinGoOrigin,
    ).toBe("http://127.0.0.1:3000");
  });

  it("refuses anything but a bare origin, and plaintext HTTP to another host", () => {
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
  it("allows a path prefix, trimmed of its surrounding space and trailing slash", () => {
    expect(
      resolveServerConfig({
        ...base,
        MODELSCOPE_BRIDGE_URL: " https://go.penguin.ooo/modelscope/ ",
      }).modelscopeBridgeUrl,
    ).toBe("https://go.penguin.ooo/modelscope");
  });

  it("refuses plaintext HTTP, credentials, a query and a fragment", () => {
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
