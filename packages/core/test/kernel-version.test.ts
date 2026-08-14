/**
 * Agent config kernel versions: the pinned-hash guard (the mechanical definition of "the
 * defaults changed substantively, bump the kernel version"), the seeded pre-#257 generation's
 * reconstruction proof, and the smart-merge semantics of applyKernelUpdate (untouched old
 * defaults advance, customizations and unknown generations are kept, identity fields and
 * user data are never touched, YAML comments survive, the config is re-stamped).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  KERNEL_HASH_HISTORY,
  KERNEL_VERSION,
  LEGACY_SKILLS_SECTION,
  LEGACY_VAULT_SECTION,
  SCHEDULES_PLACEHOLDER,
  SKILLS_PLACEHOLDER,
  VAULT_PLACEHOLDER,
  applyKernelUpdate,
  computeKernelHashes,
  defaultSystemConfig,
  isKernelOutdated,
  kernelLeafEntries,
  loadOrInitAgentState,
  resetSystemConfigToDefaults,
  systemConfigPath,
  type SystemConfig,
} from "../src/index.js";

/** The two seeded generations (see KERNEL_HASH_HISTORY's doc comment). */
const PRE_TOGGLES_GENERATION = "2026-08-10";
const TOGGLES_GENERATION = "2026-08-11";

/** A mutable plain-object clone of a config, for seeding on-disk scenarios. */
function mutableConfig(config: SystemConfig): Record<string, unknown> {
  return structuredClone(config) as unknown as Record<string, unknown>;
}

/**
 * Reconstructs the pre-#257 (pre-toggles) default config from the current one: the frozen
 * LEGACY_* sections swapped back into the template in place of the section placeholders, no
 * `{{SCHEDULES}}` line, and no vault/skills/schedules config sections — exactly what a
 * `system_config.yaml` of that era carries (the same recipe prompt-sections.test.ts proves
 * byte-exact for the template).
 */
function preTogglesDefaultConfig(): SystemConfig {
  const current = defaultSystemConfig();
  const {
    vault: _vault,
    skills: _skills,
    schedules: _schedules,
    kernel_version: _stamp,
    ...rest
  } = current;
  return {
    ...rest,
    system_prompt: current.system_prompt
      .split(VAULT_PLACEHOLDER)
      .join(LEGACY_VAULT_SECTION)
      .split(SKILLS_PLACEHOLDER)
      .join(LEGACY_SKILLS_SECTION)
      .split(`${SCHEDULES_PLACEHOLDER}\n\n`)
      .join(""),
  };
}

describe("kernel hash history (pinned-hash guard)", () => {
  it("KERNEL_VERSION is a date and the newest history key", () => {
    expect(KERNEL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const keys = Object.keys(KERNEL_HASH_HISTORY);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const key of keys) expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([...keys].sort().at(-1)).toBe(KERNEL_VERSION);
  });

  // THE guard: this failing means the built-in defaults changed substantively without a
  // kernel bump (or vice versa). It is the mechanical definition of "substantive change".
  it("the current defaults hash exactly to the latest history entry — bump KERNEL_VERSION when this fails", () => {
    const recomputed = computeKernelHashes(defaultSystemConfig());
    const pinned = KERNEL_HASH_HISTORY[KERNEL_VERSION] ?? {};
    const paths = new Set([...Object.keys(recomputed), ...Object.keys(pinned)]);
    const mismatches = [...paths].filter((p) => recomputed[p] !== pinned[p]).sort();
    expect(
      mismatches,
      "The built-in default config changed substantively (the listed leaf paths no longer " +
        "hash to the latest KERNEL_HASH_HISTORY entry). Advance the kernel: set " +
        "KERNEL_VERSION in core/src/state/kernel-history.ts to today's date and append a new " +
        "history entry with the recomputed hashes (computeKernelHashes(defaultSystemConfig())). " +
        "Several changes on the same day may revise that day's entry in place instead; never " +
        "edit an older generation's entry — those are frozen.",
    ).toEqual([]);
  });

  // Anchored to the first shipped generation: the reconstruction recipe reads the *current*
  // defaults, so it only reproduces the pre-toggles era while the current generation is
  // still the toggles one. Once the defaults evolve past it this proof self-retires — the
  // pinned hashes remain the frozen source of truth on their own.
  it.runIf(KERNEL_VERSION === TOGGLES_GENERATION)(
    "the pre-toggles generation's pinned hashes equal the LEGACY_* reconstruction",
    () => {
      expect(computeKernelHashes(preTogglesDefaultConfig())).toEqual(
        KERNEL_HASH_HISTORY[PRE_TOGGLES_GENERATION],
      );
    },
  );

  it("excludes identity fields and mcpServers from the managed leaves", () => {
    const paths = kernelLeafEntries({
      ...defaultSystemConfig(),
      name: "n",
      description: "d",
      tools: { builtin: [], mcpServers: [{ name: "m", config: {} }] },
    }).map((leaf) => leaf.path);
    for (const excluded of ["name", "description", "version", "kernel_version"]) {
      expect(paths).not.toContain(excluded);
    }
    expect(paths.some((p) => p.startsWith("tools.mcpServers"))).toBe(false);
  });
});

describe("isKernelOutdated", () => {
  it("missing stamp = outdated; older date = outdated; current and newer are not", () => {
    expect(isKernelOutdated(null)).toBe(true);
    expect(isKernelOutdated(undefined)).toBe(true);
    expect(isKernelOutdated("2026-01-01")).toBe(true);
    expect(isKernelOutdated(KERNEL_VERSION)).toBe(false);
    expect(isKernelOutdated("2999-12-31")).toBe(false);
  });
});

describe("applyKernelUpdate", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-kernel-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const configPath = () => systemConfigPath(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);

  /** Creates the default agent, then rewrites its config file with the given object. */
  async function seedConfig(config: Record<string, unknown>): Promise<void> {
    await loadOrInitAgentState({ root });
    await fs.writeFile(configPath(), stringifyYaml(config), "utf8");
  }

  async function readConfig(): Promise<SystemConfig> {
    return parseYaml(await fs.readFile(configPath(), "utf8")) as SystemConfig;
  }

  const update = () => applyKernelUpdate(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);

  it("throws for a nonexistent agent (never initializes one)", async () => {
    await expect(applyKernelUpdate(root, DEFAULT_PROJECT_ID, "ghost_agent")).rejects.toThrow(
      /not found/,
    );
  });

  it("is a stamped no-op on a freshly created config", async () => {
    await loadOrInitAgentState({ root });
    const before = await readConfig();
    const result = await update();
    expect(result).toEqual({ advanced: [], kept: [], kernelVersion: KERNEL_VERSION });
    expect(await readConfig()).toEqual(before);
  });

  it("advances an untouched pre-toggles config wholesale: template migrated, sections materialized, stamp written", async () => {
    await seedConfig(mutableConfig(preTogglesDefaultConfig()));
    const result = await update();
    expect(result.kept).toEqual([]);
    expect(result.advanced).toEqual([
      "system_prompt",
      "vault.enabled",
      "vault.prompt",
      "skills.enabled",
      "skills.prompt",
      "schedules.enabled",
      "schedules.prompt",
    ]);
    const defaults = defaultSystemConfig();
    const written = await readConfig();
    expect(written.system_prompt).toBe(defaults.system_prompt);
    expect(written.vault).toEqual(defaults.vault);
    expect(written.skills).toEqual(defaults.skills);
    expect(written.schedules).toEqual(defaults.schedules);
    expect(written.kernel_version).toBe(KERNEL_VERSION);
    // A second run finds everything current: fully idempotent.
    expect(await update()).toEqual({ advanced: [], kept: [], kernelVersion: KERNEL_VERSION });
  });

  it("keeps customized fields (reported) while still stamping", async () => {
    const config = mutableConfig(preTogglesDefaultConfig());
    config.system_prompt = "MY CUSTOM PROMPT";
    (config.memory as Record<string, unknown>).prompt = "my memory prompt";
    await seedConfig(config);
    const result = await update();
    expect(result.kept).toEqual(["system_prompt", "memory.prompt"]);
    const written = await readConfig();
    expect(written.system_prompt).toBe("MY CUSTOM PROMPT");
    expect(written.memory?.prompt).toBe("my memory prompt");
    // Untouched siblings of a kept leaf still advance independently.
    expect(written.vault).toEqual(defaultSystemConfig().vault);
    expect(written.kernel_version).toBe(KERNEL_VERSION);
  });

  it("keeps values from unknown (unseeded) generations conservatively", async () => {
    const config = mutableConfig(defaultSystemConfig());
    delete config.kernel_version;
    // An ancient default wording we cannot reconstruct: it matches no recorded hash.
    config.compaction = { mode: "summarize", prompt: "Ancient compaction wording." };
    await seedConfig(config);
    const result = await update();
    expect(result.kept).toContain("compaction.prompt");
    // The section's *missing* leaves are materialized to the defaults alongside.
    expect(result.advanced).toContain("compaction.max_context_length");
    const written = await readConfig();
    expect(written.compaction?.prompt).toBe("Ancient compaction wording.");
    expect(written.compaction?.max_context_length).toBe(128000);
  });

  it("never touches name, description, version or mcpServers", async () => {
    const config = mutableConfig(preTogglesDefaultConfig());
    config.name = "Custom Name";
    config.description = "Custom description";
    config.version = 7;
    (config.tools as Record<string, unknown>).mcpServers = [
      { name: "custom-mcp", config: { command: "custom-server" } },
    ];
    await seedConfig(config);
    const result = await update();
    expect(result.advanced).not.toContain("name");
    expect(result.kept).not.toContain("name");
    const written = await readConfig();
    expect(written.name).toBe("Custom Name");
    expect(written.description).toBe("Custom description");
    expect(written.version).toBe(7);
    expect(written.tools?.mcpServers).toEqual([
      { name: "custom-mcp", config: { command: "custom-server" } },
    ]);
  });

  it("merges tools.builtin per tool name: the edited one is kept, user-added entries survive, removals stay removed", async () => {
    const config = mutableConfig(defaultSystemConfig());
    delete config.kernel_version;
    const tools = config.tools as { builtin: Array<Record<string, unknown>> };
    // Customize one default tool, remove another, append a user-defined one.
    const readFile = tools.builtin.find((t) => t.name === "read_file")!;
    readFile.description = "my own description";
    tools.builtin = tools.builtin.filter((t) => t.name !== "edit_file");
    tools.builtin.push({ name: "my_tool", description: "user-added", permission: "r" });
    await seedConfig(config);

    const result = await update();
    expect(result.kept).toEqual(["tools.builtin.read_file", "tools.builtin.edit_file"]);
    expect(result.advanced).toEqual([]);

    const written = await readConfig();
    const names = (written.tools?.builtin ?? []).map((t) => t.name);
    expect(names).not.toContain("edit_file"); // a deliberate removal is preserved
    expect(names).toContain("my_tool"); // user-added entries survive, unreported
    const writtenReadFile = written.tools?.builtin?.find((t) => t.name === "read_file");
    expect(writtenReadFile?.description).toBe("my own description");
    // The untouched rest still equals the defaults.
    const writtenExec = written.tools?.builtin?.find((t) => t.name === "exec_command");
    expect(writtenExec).toEqual(
      defaultSystemConfig().tools?.builtin?.find((t) => t.name === "exec_command"),
    );
  });

  it("materializes the whole default toolset when tools.builtin is missing", async () => {
    const config = mutableConfig(defaultSystemConfig());
    delete config.kernel_version;
    delete config.tools;
    await seedConfig(config);
    const result = await update();
    const defaults = defaultSystemConfig();
    expect(result.advanced).toEqual(
      (defaults.tools?.builtin ?? []).map((t) => `tools.builtin.${t.name}`),
    );
    expect((await readConfig()).tools?.builtin).toEqual(defaults.tools?.builtin);
  });

  it("appends a tool only when it is new in the latest generation (history seam)", async () => {
    const defaults = defaultSystemConfig();
    const current = computeKernelHashes(defaults);
    // A fabricated older generation that already knew read_file but never edit_file: a
    // present array missing read_file is then a deliberate removal (kept), while the same
    // absence of edit_file means the config simply predates the tool (appended).
    const history = {
      "2000-01-01": { "tools.builtin.read_file": current["tools.builtin.read_file"]! },
      [KERNEL_VERSION]: current,
    };
    const config = mutableConfig(defaults);
    delete config.kernel_version;
    const tools = config.tools as { builtin: Array<Record<string, unknown>> };
    tools.builtin = tools.builtin.filter((t) => t.name !== "read_file" && t.name !== "edit_file");
    await seedConfig(config);

    const result = await applyKernelUpdate(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, {
      history,
    });
    expect(result.kept).toContain("tools.builtin.read_file");
    expect(result.advanced).toContain("tools.builtin.edit_file");
    const names = ((await readConfig()).tools?.builtin ?? []).map((t) => t.name);
    expect(names).not.toContain("read_file");
    expect(names).toContain("edit_file");
  });

  it("tolerates dangling/invalid section keys (a hand-edited `tools:` with no value parses as null)", async () => {
    await loadOrInitAgentState({ root });
    await fs.writeFile(
      configPath(),
      // model is an invalid scalar, tools a dangling key: both sections read as missing and
      // must be materialized to the defaults instead of crashing setIn.
      "system_prompt: custom\nmodel: 3\ntools:\n",
      "utf8",
    );
    const result = await update();
    expect(result.kept).toEqual(["system_prompt"]);
    const defaults = defaultSystemConfig();
    const written = await readConfig();
    expect(written.model).toEqual(defaults.model);
    expect(written.tools?.builtin).toEqual(defaults.tools?.builtin);
    expect(written.system_prompt).toBe("custom");
    expect(written.kernel_version).toBe(KERNEL_VERSION);
  });

  it("preserves YAML comments on untouched content", async () => {
    await loadOrInitAgentState({ root });
    const raw = await fs.readFile(configPath(), "utf8");
    await fs.writeFile(
      configPath(),
      `# my precious comment\n${raw.replace("max_turns: -1", "max_turns: 5")}`,
      "utf8",
    );
    const result = await update();
    // max_turns 5 is a customization (no generation ever defaulted to 5) — kept.
    expect(result.kept).toEqual(["max_turns"]);
    const after = await fs.readFile(configPath(), "utf8");
    expect(after).toContain("# my precious comment");
    expect((await readConfig()).max_turns).toBe(5);
  });
});

describe("kernel stamping on the materialization paths", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-kernel-stamp-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("a newly created agent is stamped with the current kernel version", async () => {
    const state = await loadOrInitAgentState({ root });
    expect(state.systemConfig.kernel_version).toBe(KERNEL_VERSION);
  });

  it("restore-defaults re-stamps a config that predates the mechanism", async () => {
    await loadOrInitAgentState({ root });
    const configPath = systemConfigPath(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    await fs.writeFile(configPath, "system_prompt: old\nversion: 3\n", "utf8");
    const written = await resetSystemConfigToDefaults(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(written.kernel_version).toBe(KERNEL_VERSION);
    expect(written.version).toBe(3);
  });
});
