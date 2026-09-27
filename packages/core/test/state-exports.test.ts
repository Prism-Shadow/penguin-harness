/**
 * The state module's export surface, pinned at the two points the audit found unwritten.
 *
 * `agentStateVersion` is the module's version normalizer and no test named it: its non-number
 * branch was reached only indirectly, through `resetSystemConfigToDefaults`, and its missing /
 * non-integer / below-1 branches by nothing at all — while two server services read `version`
 * off disk as `number | undefined` and hand every shape of it to this function.
 *
 * `applyKernelUpdate` is named by `kernel-version.test.ts`, which pins the tab-wise merge itself,
 * but nothing pinned the upgrade path's promise to the *rest* of the Agent State: an Agent State
 * written by an older build loads, its version normalizes, and its memory and vault are still
 * there afterwards. That half runs end to end here, on a pre-toggles-shaped config (the oldest
 * generation the record can still reconstruct) with a vault entry, a memory index, a memory
 * topic and a hand-written `AGENTS.md` beside it.
 */
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  KERNEL_VERSION,
  LEGACY_SKILLS_SECTION,
  LEGACY_VAULT_SECTION,
  MEMORY_INDEX_FILENAME,
  SCHEDULES_PLACEHOLDER,
  SKILLS_PLACEHOLDER,
  VAULT_PLACEHOLDER,
  agentStateVersion,
  agentVaultPath,
  agentsMdPath,
  applyKernelUpdate,
  defaultSystemConfig,
  loadAgentState,
  loadAgentVault,
  resetSystemConfigToDefaults,
  setVaultEntry,
  systemConfigPath,
  userMemoryDir,
} from "../src/index.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-state-exports-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const configPath = (): string => systemConfigPath(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);

describe("agentStateVersion (no test named it before this one)", () => {
  it("keeps a natural number and normalizes every other shape to 1", () => {
    expect(agentStateVersion({ version: 1 })).toBe(1);
    expect(agentStateVersion({ version: 7 })).toBe(7);
    // The shapes its two server readers actually hand it (`parsed.version as number | undefined`
    // from YAML, and the same field off a JSON request body): a missing key, below 1, a
    // non-integer, NaN, and a hand-edited string — all of which must read as 1, never as
    // themselves and never as a throw.
    expect(agentStateVersion({})).toBe(1);
    expect(agentStateVersion({ version: undefined })).toBe(1);
    expect(agentStateVersion({ version: 0 })).toBe(1);
    expect(agentStateVersion({ version: -3 })).toBe(1);
    expect(agentStateVersion({ version: 2.5 })).toBe(1);
    expect(agentStateVersion({ version: Number.NaN })).toBe(1);
    expect(agentStateVersion({ version: Number.POSITIVE_INFINITY })).toBe(1);
    expect(agentStateVersion({ version: "7" as unknown as number })).toBe(1);
    expect(agentStateVersion({ version: null as unknown as number })).toBe(1);
  });
});

describe("resetSystemConfigToDefaults normalizes the version it writes (agent-state.ts:288-321)", () => {
  it("writes 1 for a missing, zero and fractional version, keeps a valid one, and lands it on disk", async () => {
    await loadAgentState({ init: {}, root });
    // Both halves of the contract in one loop: an out-of-range field normalizes, a valid counter
    // (the value the override exists for) survives the wipe — 1 alone would also come out of the
    // default object the reset spreads, so the valid line is what pins the override itself.
    for (const [versionLine, expected] of [
      ["", 1],
      ["version: 0\n", 1],
      ["version: 2.5\n", 1],
      ["version: 7\n", 7],
    ] as const) {
      await fs.writeFile(configPath(), `system_prompt: old\n${versionLine}`, "utf8");
      const written = await resetSystemConfigToDefaults(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
      expect(written.version, JSON.stringify(versionLine)).toBe(expected);
      // Read back through the loader a Session uses, not off the returned object alone.
      expect((await loadAgentState({ root })).systemConfig.version).toBe(expected);
    }
  });
});

describe("an Agent State written by an older build upgrades without losing its memory and vault", () => {
  /**
   * The `system_prompt` template the toggles generation (`2026-08-11`) shipped, frozen
   * byte-exact — the oldest shape `kernel-history.ts` can still reconstruct, and the same
   * fixture `kernel-version.test.ts` ages its configs with. Never edit it.
   */
  const TOGGLES_GENERATION_SYSTEM_PROMPT = readFileSync(
    fileURLToPath(new URL("./fixtures/toggles-generation-system-prompt.txt", import.meta.url)),
    "utf8",
  );

  /**
   * Ages `default_agent`'s config into that generation's shape: no kernel stamp, the legacy
   * Vault/Skills sections swapped back in place of the placeholders, no `{{SCHEDULES}}` line,
   * and no `version` at all (a config predating the optimization counter).
   */
  async function ageConfig(): Promise<void> {
    const config = parseYaml(await fs.readFile(configPath(), "utf8")) as Record<string, unknown>;
    delete config.kernel_version;
    delete config.vault;
    delete config.skills;
    delete config.schedules;
    delete config.version;
    config.system_prompt = TOGGLES_GENERATION_SYSTEM_PROMPT.split(VAULT_PLACEHOLDER)
      .join(LEGACY_VAULT_SECTION)
      .split(SKILLS_PLACEHOLDER)
      .join(LEGACY_SKILLS_SECTION)
      .split(`${SCHEDULES_PLACEHOLDER}\n\n`)
      .join("");
    await fs.writeFile(configPath(), stringifyYaml(config), "utf8");
  }

  it("loads it, reads its absent version as 1, and leaves memory and vault byte-identical", async () => {
    await loadAgentState({ init: {}, root });
    await ageConfig();
    // The user's own data beside the config: a vault entry, a memory index with one topic, and
    // an `AGENTS.md` the user wrote. None of it belongs to a kernel tab.
    await setVaultEntry(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "OLD_KEY", "sk-old-value");
    const indexFile = path.join(
      userMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      MEMORY_INDEX_FILENAME,
    );
    const topicFile = path.join(path.dirname(indexFile), "old-topic.md");
    await fs.writeFile(indexFile, "- [old-topic](old-topic.md) — survived the upgrade\n", "utf8");
    await fs.writeFile(topicFile, "the body\n", "utf8");
    await fs.writeFile(agentsMdPath(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), "my own rules\n");
    const vaultFile = agentVaultPath(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    const vaultBytes = await fs.readFile(vaultFile, "utf8");
    const indexBytes = await fs.readFile(indexFile, "utf8");

    const result = await applyKernelUpdate(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    // A real rewrite of the config, not a no-op: the four pre-toggles tabs advance and the
    // stamp is written, so the survival assertions below are not vacuous.
    expect(result.advanced).toEqual(["prompt", "skills", "vault", "schedules"]);
    expect(result.kept).toEqual([]);
    expect(result.kernelVersion).toBe(KERNEL_VERSION);

    // What a Session does next: load the Agent State as it is on disk.
    const state = await loadAgentState({ root });
    expect(state.systemConfig.kernel_version).toBe(KERNEL_VERSION);
    expect(state.systemConfig.system_prompt).toBe(defaultSystemConfig().system_prompt);
    expect(state.agentsMd).toBe("my own rules\n");
    // The counter predates the file, so the loader reads it as absent — and the normalizer every
    // reader of it goes through answers 1, which is what makes such a State usable at all.
    expect(state.systemConfig.version).toBeUndefined();
    expect(agentStateVersion(state.systemConfig)).toBe(1);

    // Memory and vault are untouched, byte for byte.
    expect(await loadAgentVault(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).toEqual({
      OLD_KEY: "sk-old-value",
    });
    expect(await fs.readFile(vaultFile, "utf8")).toBe(vaultBytes);
    expect(await fs.readFile(indexFile, "utf8")).toBe(indexBytes);
    expect(await fs.readFile(topicFile, "utf8")).toBe("the body\n");

    // A second pass finds nothing to do and keeps the user's data as it stands.
    expect(await applyKernelUpdate(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).toEqual({
      advanced: [],
      kept: [],
      kernelVersion: KERNEL_VERSION,
    });
    expect(await loadAgentVault(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).toEqual({
      OLD_KEY: "sk-old-value",
    });
    expect(await fs.readFile(indexFile, "utf8")).toBe(indexBytes);
  });
});
