/**
 * The platform's generated interface table (`src/ifaces.json`, which `pnpm test` regenerates
 * first) holds the platform's own modules and interfaces, and no shipped plugin's.
 *
 * - Given the browser suites import the browser-automation plugin's sources
 *   (test/builtin-browser/plugin.ts), the table carries none of that plugin's modules or
 *   interfaces. The loader folds a plugin's table into the host's with the host's entry winning,
 *   so a copy here would stand in for the plugin's own — a newer copy installed under
 *   `<root>/plugins` would be checked against this stale one.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import table from "../src/ifaces.json" with { type: "json" };

interface Table {
  ifaces: Record<string, unknown>;
  modules: Record<string, unknown>;
}

const plugin = JSON.parse(
  readFileSync(new URL("../../../plugins/browser-automation/ifaces.json", import.meta.url), "utf8"),
) as Table;

describe("the platform's interface table", () => {
  it("carries none of a shipped plugin's modules or interfaces, though its tests import one", () => {
    const host = table as unknown as Table;
    expect(Object.keys(plugin.modules).length).toBeGreaterThan(0);
    expect(Object.keys(plugin.modules).filter((name) => name in host.modules)).toEqual([]);
    expect(Object.keys(host.ifaces).filter((key) => key.startsWith("@penguinharness/"))).toEqual(
      [],
    );
  });
});
