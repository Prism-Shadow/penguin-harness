/**
 * The Agent-level hook switch — `hooks.enabled` in `system_config.yaml`. Absent means on, and
 * `false` leaves a new Session with no hooks at all while the packages stay installed. The
 * manifest loader is tolerant of a stray `enabled` key (a package exported while the switch
 * was per-package): it loads, and nothing reads the field.
 *
 * A package is any directory carrying a manifest, so one written by hand loads too: what it
 * leaves out reads as empty, and what it gets wrong is dropped entry by entry.
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
  predatesEveryPromptHooks,
  systemConfigPath,
  userPromptTrigger,
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

describe("a hook package written by hand", () => {
  /** Writes `hooks/<name>/hooks.json` as given, plus the scripts beside it. */
  async function writePackage(
    name: string,
    manifest: unknown,
    files: Record<string, string> = {},
  ): Promise<void> {
    const dir = path.join(hooksDir(tmpRoot, ...ids), name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "hooks.json"), JSON.stringify(manifest));
    for (const [rel, text] of Object.entries(files)) await fs.writeFile(path.join(dir, rel), text);
  }

  it("loads with only the hook point it uses, the rest reading as empty", async () => {
    await createAgent();
    await writePackage(
      "append-time",
      { name: "append-time", user_prompt: [{ command: "time.mjs", timeout: 10 }] },
      { "time.mjs": FILES["expand.mjs"] },
    );

    const [hook] = await listInstalledHooks(tmpRoot, ...ids);
    expect(hook).toMatchObject({
      name: "append-time",
      description: "",
      version: "",
      stop: [],
      pre_tool_use: [],
      user_prompt: [{ command: "time.mjs", timeout: 10 }],
    });
  });

  it("drops the entries it cannot run and keeps the ones it can", async () => {
    await createAgent();
    await writePackage("mixed", {
      description: 7,
      version: "2026.09.29.1",
      stop: "stop.mjs",
      pre_tool_use: [{ command: 5 }, "guard.mjs", null, { timeout: 3 }],
      user_prompt: [
        { command: "../outside.mjs" },
        { command: "/etc/passwd" },
        { command: "ok.mjs", timeout: -1, trigger: "sometimes" },
        { command: "flow/start.mjs", timeout: 5, trigger: "host" },
      ],
    });
    // Not a JSON object: not a package.
    await writePackage("a-list", [{ command: "x.mjs" }]);

    const listed = await listInstalledHooks(tmpRoot, ...ids);
    expect(listed.map((h) => h.name)).not.toContain("a-list");
    const mixed = listed.find((h) => h.name === "mixed");
    expect(mixed).toMatchObject({ description: "", version: "2026.09.29.1" });
    expect(mixed?.stop).toEqual([]);
    expect(mixed?.pre_tool_use).toEqual([]);
    expect(mixed?.user_prompt).toEqual([
      { command: "ok.mjs" },
      { command: "flow/start.mjs", timeout: 5, trigger: "host" },
    ]);
  });

  it("gives a Session a hook that runs on every Prompt, not one a host starts by name", async () => {
    const agent = await createAgent();
    await writePackage(
      "append-time",
      { user_prompt: [{ command: "time.mjs" }] },
      { "time.mjs": FILES["expand.mjs"] },
    );
    const ws = path.join(tmpRoot, "ws");
    await fs.mkdir(ws, { recursive: true });

    const session = await agent.createSession({ workspaceDir: ws });
    try {
      expect(await session.runUserPromptHook("append-time", "hi")).toBeNull();
    } finally {
      session.dispose();
    }
  });
});

describe("when a user_prompt command runs", () => {
  it("is what the command says, and every Prompt when it says nothing", () => {
    expect(userPromptTrigger("2026.09.29.1", { command: "a.mjs" })).toBe("prompt");
    expect(userPromptTrigger("2026.09.29.1", { command: "a.mjs", trigger: "host" })).toBe("host");
    // A package written by hand carries no version, or one of its own making.
    expect(userPromptTrigger("", { command: "a.mjs" })).toBe("prompt");
    expect(userPromptTrigger("1.0.0", { command: "a.mjs" })).toBe("prompt");
  });

  it("stays by-name for a manifest from before the point ran on every Prompt", () => {
    expect(userPromptTrigger("2026.09.01.1", { command: "start.mjs" })).toBe("host");
    expect(userPromptTrigger("2026-09-01.1", { command: "start.mjs" })).toBe("host");
    expect(userPromptTrigger("2026.09.01.1", { command: "a.mjs", trigger: "prompt" })).toBe(
      "prompt",
    );
    expect(predatesEveryPromptHooks("2026.09.28.9")).toBe(true);
    expect(predatesEveryPromptHooks("2026.09.29.1")).toBe(false);
    expect(predatesEveryPromptHooks("")).toBe(false);
  });
});

describe("a package from before user_prompt hooks ran on every Prompt", () => {
  it("is still reached by name, and named once in the log however many Sessions read it", async () => {
    const agent = await createAgent();
    await installHook(tmpRoot, ...ids, MANIFEST, FILES);
    const ws = path.join(tmpRoot, "ws");
    await fs.mkdir(ws, { recursive: true });
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      for (let i = 0; i < 2; i++) {
        const session = await agent.createSession({ workspaceDir: ws });
        try {
          expect(await session.runUserPromptHook("expander", "hi")).toEqual({
            context: "expanded",
          });
        } finally {
          session.dispose();
        }
      }
    } finally {
      stderr.mockRestore();
    }
    const dir = path.join(hooksDir(tmpRoot, ...ids), "expander");
    const reminders = lines.filter((line) => line.startsWith("[hooks]") && line.includes(dir));
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toContain("expander 2026.09.02.1");
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
