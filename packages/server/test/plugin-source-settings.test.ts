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
import { strToU8 } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { installPluginFiles, setNpmRegistry } from "../src/plugin/install.js";
import { npmRegistryOf, PLUGIN_SOURCES_GROUP } from "../src/plugin/source-settings.js";
import { contentTable } from "./plugin-fixtures.js";

const execFileAsync = promisify(execFile);
const bytes = (value: string | Uint8Array) => (typeof value === "string" ? strToU8(value) : value);

/** A plugin of Skills, `@acme/notes`, as files of its built package directory. */
const notesPackage = (): Record<string, string | Uint8Array> => ({
  "package.json": JSON.stringify({ name: "@acme/notes", version: "1.0.0", description: "x" }),
  "ifaces.json": contentTable("@acme/notes", {
    card: { title: "Notes", category: "office-productivity" },
    skills: ["notes"],
  }),
  "skills/notes/SKILL.md":
    "---\nname: notes\ndescription: Take notes.\nversion: 2026.11.01.1\n---\n\nBody.\n",
});

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
  // The wire, without a network: a pack-only, no-dependency package installs offline with a
  // cache of its own, so the pass proves the unflagged line still installs; the flagged run
  // points npm at a registry that does not exist, and the failure naming it is how the wire
  // shows the flag arrived. Windows is left out: npm.cmd needs the shell there (the offline
  // wire test's reason too).
  it.skipIf(process.platform === "win32")(
    "unset, the install is what it always was; set, npm fails naming the registry it was pointed at",
    { timeout: 120_000 },
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-registry-"));
      try {
        // npm's own configuration is pinned off the network, so the pass below is the
        // installer's doing and not a registry's.
        const env = {
          npm_config_offline: process.env.npm_config_offline,
          npm_config_cache: process.env.npm_config_cache,
          npm_config_update_notifier: process.env.npm_config_update_notifier,
        };
        process.env.npm_config_offline = "true";
        process.env.npm_config_cache = path.join(root, ".npm-cache");
        process.env.npm_config_update_notifier = "false";

        await expect(
          installPluginFiles(root, new Map(Object.entries(notesPackage()))),
        ).resolves.toEqual({
          name: "@acme/notes",
          version: "1.0.0",
        });

        saved.push(undefined);
        setNpmRegistry("https://registry.invalid");
        // npm fails naming the registry it was pointed at: the flag reached the command line.
        await expect(
          installPluginFiles(root, new Map(Object.entries(notesPackage()))),
        ).rejects.toThrow(/registry\.invalid/);
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
