/**
 * The Agent-level hook switch — `hooks.enabled` in `system_config.yaml`. Absent means on, and
 * `false` leaves a new Session with no hooks at all while the packages stay installed. The
 * manifest loader is tolerant of a stray `enabled` key (a package exported while the switch
 * was per-package): it loads, and nothing reads the field.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  createAgent,
  hooksDir,
  installHook,
  listInstalledHooks,
  systemConfigPath,
} from "../src/index.js";
import type { HookManifest, SystemConfig } from "../src/index.js";
import { stubProviderKeys } from "./provider-keys.js";

let tmpRoot: string;
let prevHome: string | undefined;
let restoreKeys: () => void;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-harness-hooks-"));
  process.env.PENGUIN_HOME = tmpRoot;
  restoreKeys = stubProviderKeys();
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  restoreKeys();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const MANIFEST: HookManifest = {
  name: "expander",
  description: "Answers at the user_prompt point.",
  version: "2026.09.02.1",
  stop: [],
  pre_tool_use: [],
  user_prompt: [{ command: "expand.mjs", timeout: 5 }],
};
const FILES = {
  "expand.mjs": 'process.stdout.write(JSON.stringify({ context: "expanded" }));\n',
};
const ids = [DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID] as const;

/** Writes the Agent's `hooks.enabled` (a Session reads the config on disk, not a snapshot). */
async function setHooksEnabled(enabled: boolean): Promise<void> {
  const file = systemConfigPath(tmpRoot, ...ids);
  const cfg = parseYaml(await fs.readFile(file, "utf8")) as SystemConfig;
  cfg.hooks = { enabled };
  await fs.writeFile(file, stringifyYaml(cfg), "utf8");
}

describe("installed hook packages", () => {
  it("loads a manifest carrying a stray enabled field and ignores it", async () => {
    await createAgent();
    await installHook(tmpRoot, ...ids, MANIFEST, FILES);
    // Written by hand: the installer never emits the field, but a package exported while the
    // switch was per-package still carries it, and such a directory must keep loading.
    const file = path.join(hooksDir(tmpRoot, ...ids), "expander", "hooks.json");
    await fs.writeFile(file, `${JSON.stringify({ ...MANIFEST, enabled: false }, null, 2)}\n`);

    const listed = await listInstalledHooks(tmpRoot, ...ids);
    expect(listed.map((h) => h.name)).toContain("expander");
  });
});

describe("the Agent-level hook switch", () => {
  it("gives a new Session no hooks while it is off, and the packages back once it is on", async () => {
    const agent = await createAgent();
    await installHook(tmpRoot, ...ids, MANIFEST, FILES);
    const ws = path.join(tmpRoot, "ws");
    await fs.mkdir(ws, { recursive: true });

    // Absent section: hooks are on.
    const on = await agent.createSession({ workspaceDir: ws });
    try {
      expect(await on.runUserPromptHook("expander", "hi")).toEqual({ context: "expanded" });
    } finally {
      on.dispose();
    }

    await setHooksEnabled(false);
    const off = await agent.createSession({ workspaceDir: ws });
    try {
      // Off reads to a Session exactly like nothing installed: no such hook.
      expect(await off.runUserPromptHook("expander", "hi")).toBeNull();
    } finally {
      off.dispose();
    }
    // The package itself is untouched.
    expect((await listInstalledHooks(tmpRoot, ...ids)).map((h) => h.name)).toContain("expander");

    await setHooksEnabled(true);
    const again = await agent.createSession({ workspaceDir: ws });
    try {
      expect(await again.runUserPromptHook("expander", "hi")).toEqual({ context: "expanded" });
    } finally {
      again.dispose();
    }
  });
});

/**
 * A hooks.json that parses but is not shaped like a HookManifest must not reach
 * `sessionHooks` (it maps the hook points without further checks): the reader rejects the
 * package as "not a hook package", the same way an unparseable one is rejected.
 */
describe("a hooks.json that parses but is not shaped like a manifest", () => {
  /** Writes `hooks/<name>/hooks.json` by hand (the installer never emits a broken one). */
  async function parkPackage(name: string, manifest: Record<string, unknown>): Promise<void> {
    const dir = path.join(hooksDir(tmpRoot, ...ids), name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "hooks.json"), JSON.stringify(manifest), "utf8");
  }

  it("skips a package whose hook point is not an array, and healthy packages beside it", async () => {
    await createAgent();
    await installHook(tmpRoot, ...ids, MANIFEST, FILES);
    await parkPackage("broken", {
      name: "broken",
      description: "x",
      version: "2026.09.02.1",
      stop: 0,
      pre_tool_use: [],
      user_prompt: [],
    });

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let listed: string[];
    let warnings: string;
    try {
      listed = (await listInstalledHooks(tmpRoot, ...ids)).map((h) => h.name);
      warnings = stderr.mock.calls.map((args) => String(args[0])).join("");
    } finally {
      stderr.mockRestore();
    }
    expect(listed).toContain("expander");
    expect(listed).not.toContain("broken");
    expect(warnings).toContain("broken");
  });

  it("skips a package whose hook entry has no usable command or timeout", async () => {
    await createAgent();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await parkPackage("no-command", {
        name: "no-command",
        description: "x",
        version: "2026.09.02.1",
        stop: [{ timeout: 5 }],
        pre_tool_use: [],
        user_prompt: [],
      });
      await parkPackage("empty-command", {
        name: "empty-command",
        description: "x",
        version: "2026.09.02.1",
        stop: [{ command: "" }],
        pre_tool_use: [],
        user_prompt: [],
      });
      await parkPackage("bad-timeout", {
        name: "bad-timeout",
        description: "x",
        version: "2026.09.02.1",
        stop: [{ command: "run.mjs", timeout: 0 }],
        pre_tool_use: [],
        user_prompt: [],
      });
      expect((await listInstalledHooks(tmpRoot, ...ids)).map((h) => h.name)).toEqual(["goal"]);
    } finally {
      stderr.mockRestore();
    }
  });

  it("defaults missing hook points to empty arrays", async () => {
    await createAgent();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await parkPackage("sparse", { name: "sparse", description: "x", version: "2026.09.02.1" });
      const sparse = (await listInstalledHooks(tmpRoot, ...ids)).find((h) => h.name === "sparse");
      expect(sparse?.stop).toEqual([]);
      expect(sparse?.pre_tool_use).toEqual([]);
      expect(sparse?.user_prompt).toEqual([]);
    } finally {
      stderr.mockRestore();
    }
  });

  it("does not brick session creation, and healthy hooks still run", async () => {
    const agent = await createAgent();
    await installHook(tmpRoot, ...ids, MANIFEST, FILES);
    await parkPackage("broken", {
      name: "broken",
      description: "x",
      version: "2026.09.02.1",
      stop: 0,
      pre_tool_use: [],
      user_prompt: [],
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ws = path.join(tmpRoot, "ws-shape");
    try {
      await fs.mkdir(ws, { recursive: true });
      const session = await agent.createSession({ workspaceDir: ws });
      try {
        expect(await session.runUserPromptHook("expander", "hi")).toEqual({ context: "expanded" });
      } finally {
        session.dispose();
      }
    } finally {
      stderr.mockRestore();
    }
  });
});
