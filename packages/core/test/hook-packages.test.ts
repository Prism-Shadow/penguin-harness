/**
 * The switch on installed hook packages — `enabled` in hooks.json. An absent field means
 * enabled (hookPackageEnabled), setHookEnabled writes `false` and removes it again, a
 * reinstall keeps a switched-off package off, and a Session built on the Agent leaves a
 * switched-off package out (its user_prompt hook is not found) while an enabled one answers.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  createAgent,
  hookPackageEnabled,
  hooksDir,
  installHook,
  listInstalledHooks,
  setHookEnabled,
} from "../src/index.js";
import type { HookManifest } from "../src/index.js";
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
  name: "switchable",
  description: "Answers at the user_prompt point.",
  version: "2026-09-02.1",
  stop: [],
  pre_tool_use: [],
  user_prompt: [{ command: "expand.mjs", timeout: 5 }],
};
const FILES = {
  "expand.mjs": 'process.stdout.write(JSON.stringify({ context: "expanded" }));\n',
};
const ids = [DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID] as const;
const manifestFile = (): string => path.join(hooksDir(tmpRoot, ...ids), "switchable", "hooks.json");
const readManifest = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(manifestFile(), "utf8")) as Record<string, unknown>;

describe("hookPackageEnabled", () => {
  it("reads only an explicit false as off", () => {
    expect(hookPackageEnabled({})).toBe(true);
    expect(hookPackageEnabled({ enabled: true })).toBe(true);
    expect(hookPackageEnabled({ enabled: false })).toBe(false);
  });
});

describe("setHookEnabled", () => {
  it("writes enabled: false, keeps it across a reinstall, and removes it again", async () => {
    await createAgent();
    await installHook(tmpRoot, ...ids, MANIFEST, FILES);
    expect("enabled" in (await readManifest())).toBe(false);

    await setHookEnabled(tmpRoot, ...ids, "switchable", false);
    expect(await readManifest()).toMatchObject({ name: "switchable", enabled: false });
    // Still listed: switched off is not uninstalled (the default Agent's preinstalled packages sit beside it).
    const listed = await listInstalledHooks(tmpRoot, ...ids);
    expect(hookPackageEnabled(listed.find((h) => h.name === "switchable")!)).toBe(false);

    // A reinstall (a library update) replaces the content and keeps the switch.
    await installHook(tmpRoot, ...ids, { ...MANIFEST, version: "2026-09-02.2" }, FILES);
    expect(await readManifest()).toMatchObject({ version: "2026-09-02.2", enabled: false });

    await setHookEnabled(tmpRoot, ...ids, "switchable", true);
    expect("enabled" in (await readManifest())).toBe(false);

    await expect(setHookEnabled(tmpRoot, ...ids, "absent", true)).rejects.toThrow(/not installed/);
  });
});

describe("Session hooks and the switch", () => {
  it("leaves a switched-off package out of a new Session and consults it again once switched on", async () => {
    const agent = await createAgent();
    await installHook(tmpRoot, ...ids, MANIFEST, FILES);
    const ws = path.join(tmpRoot, "ws");
    await fs.mkdir(ws, { recursive: true });

    const on = await agent.createSession({ workspaceDir: ws });
    try {
      expect(await on.runUserPromptHook("switchable", "hi")).toEqual({ context: "expanded" });
    } finally {
      on.dispose();
    }

    await setHookEnabled(tmpRoot, ...ids, "switchable", false);
    const off = await agent.createSession({ workspaceDir: ws });
    try {
      // Switched off reads to a Session exactly like not installed: no such hook.
      expect(await off.runUserPromptHook("switchable", "hi")).toBeNull();
    } finally {
      off.dispose();
    }

    await setHookEnabled(tmpRoot, ...ids, "switchable", true);
    const again = await agent.createSession({ workspaceDir: ws });
    try {
      expect(await again.runUserPromptHook("switchable", "hi")).toEqual({ context: "expanded" });
    } finally {
      again.dispose();
    }
  });
});
