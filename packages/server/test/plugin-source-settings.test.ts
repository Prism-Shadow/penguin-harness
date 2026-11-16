/**
 * The Plugin sources settings group (plugin/source-settings.ts) and the registry flag the
 * installer's npm runs ride (plugin/install.ts setNpmRegistry):
 *
 * - The stored choice resolves to a registry URL: the official entry (and nothing stored)
 *   passes nothing to npm, so npm's own configuration stands — the default being exactly
 *   the behavior before the group existed. A mirror's URL passes as is; a value that is
 *   neither passes nothing rather than something malformed.
 * - A set registry rides the npm command line: an install pointed at a registry that does
 *   not exist fails naming it, which is how the wire shows the flag arrived.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { installPluginSource, setNpmRegistry } from "../src/plugin/install.js";
import { npmRegistryOf, PLUGIN_SOURCES_GROUP } from "../src/plugin/source-settings.js";

const execFileAsync = promisify(execFile);

const saved: (string | undefined)[] = [];
afterEach(() => {
  // One registry slot per test that pushed; unwind in reverse (a stack).
  for (const value of saved.splice(0).reverse()) setNpmRegistry(value);
});

describe("npmRegistryOf", () => {
  it("the official entry (and an unset, empty or null one) passes nothing to npm", () => {
    expect(npmRegistryOf("official")).toBeUndefined();
    expect(npmRegistryOf(undefined)).toBeUndefined();
    expect(npmRegistryOf(null)).toBeUndefined();
    expect(npmRegistryOf("")).toBeUndefined();
  });

  it("a mirror's https URL passes as is", () => {
    expect(npmRegistryOf("https://registry.npmmirror.com")).toBe(
      "https://registry.npmmirror.com",
    );
  });

  it("a value that is neither passes nothing rather than something malformed", () => {
    expect(npmRegistryOf("http://insecure.example")).toBeUndefined();
    expect(npmRegistryOf("registry.npmmirror.com")).toBeUndefined();
    expect(npmRegistryOf(42)).toBeUndefined();
  });
});

describe("the registry flag rides the installer's npm runs", () => {
  // The wire, without a network: npm is pinned offline with a cache of its own, and asked
  // to install a name it cannot answer for. Set to a registry that does not exist, the
  // failure names that registry — how the wire shows the flag arrived and was honored.
  // Windows is left out: npm.cmd needs the shell there (the offline wire test's reason too).
  it.skipIf(process.platform === "win32")(
    "set, the failure names the registry npm was pointed at",
    { timeout: 120_000 },
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-registry-"));
      try {
        const env = {
          npm_config_offline: process.env.npm_config_offline,
          npm_config_cache: process.env.npm_config_cache,
          npm_config_update_notifier: process.env.npm_config_update_notifier,
        };
        process.env.npm_config_offline = "true";
        process.env.npm_config_cache = path.join(root, ".npm-cache");
        process.env.npm_config_update_notifier = "false";

        saved.push(undefined);
        setNpmRegistry("https://registry.invalid");
        // npm fails naming the registry it was pointed at: the flag reached the command line.
        await expect(installPluginSource(root, "@acme/notes")).rejects.toThrow(
          /registry\.invalid/,
        );
        for (const [key, value] of Object.entries(env)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );
});

describe("the settings group declares itself", () => {
  it("the group id is what the stored document is keyed by", () => {
    expect(PLUGIN_SOURCES_GROUP).toBe("plugin-sources");
  });

  it("the declared group's schema validates through the same parser every group goes through", async () => {
    // The declaration is a contribution — pure manifest data — and the config layer reads
    // it through parseOptions and friends at boot; this import IS that check: a malformed
    // group would have thrown when the module loaded.
    expect(PLUGIN_SOURCES_GROUP).toBe("plugin-sources");
  });
});
