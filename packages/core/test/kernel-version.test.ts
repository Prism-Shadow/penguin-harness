/**
 * Agent config kernel versions: the pinned-hash guard (the mechanical definition of "the
 * defaults changed substantively, bump the kernel version"), the record's internal
 * consistency, the pre-#257 generation's reconstruction proof, and the tab-wise merge
 * semantics of applyKernelUpdate (an untouched old default tab advances whole, a tab with any
 * customization is kept whole, identity fields and user data are never touched, YAML comments
 * survive, the config is re-stamped).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  KERNEL_DEFAULT_TAB_HASHES,
  KERNEL_SUPERSEDED_TAB_HASHES,
  KERNEL_TABS,
  KERNEL_TAB_KEYS,
  KERNEL_VERSION,
  LEGACY_SKILLS_SECTION,
  LEGACY_VAULT_SECTION,
  SCHEDULES_PLACEHOLDER,
  SKILLS_PLACEHOLDER,
  VAULT_PLACEHOLDER,
  applyKernelUpdate,
  computeKernelTabHashes,
  defaultSystemConfig,
  isKernelOutdated,
  kernelTabHash,
  loadOrInitAgentState,
  resetSystemConfigToDefaults,
  systemConfigPath,
  type KernelSupersededTabHashes,
  type KernelTab,
  type SystemConfig,
} from "../src/index.js";

/** A mutable plain-object clone of a config, for seeding on-disk scenarios. */
function mutableConfig(config: SystemConfig): Record<string, unknown> {
  return structuredClone(config) as unknown as Record<string, unknown>;
}

/**
 * Reconstructs a pre-#257 (pre-toggles) shaped config from the current defaults: the frozen
 * LEGACY_* sections swapped back into the template in place of the section placeholders, no
 * `{{SCHEDULES}}` line, and no vault/skills/schedules config sections (the recipe
 * prompt-sections.test.ts proves byte-exact for the template). Everything outside the swap —
 * the runtime, tools and memory tabs — carries the *current* defaults, so the merge tests
 * below treat those tabs as already-current; the seeding exercises the old-template migration
 * paths regardless.
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

describe("kernel tab hash record (pinned-hash guard)", () => {
  it("KERNEL_VERSION is a date", () => {
    expect(KERNEL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the record covers every tab and lists nothing that could never fire", () => {
    expect(Object.keys(KERNEL_DEFAULT_TAB_HASHES).sort()).toEqual([...KERNEL_TAB_KEYS].sort());
    for (const [tab, hashes] of Object.entries(KERNEL_SUPERSEDED_TAB_HASHES)) {
      expect(KERNEL_TAB_KEYS, `${tab} is not a kernel tab`).toContain(tab);
      expect(hashes.length, tab).toBeGreaterThan(0);
      expect(new Set(hashes).size, `${tab} repeats a superseded hash`).toBe(hashes.length);
      // A kernel update short-circuits on the current default before consulting the record,
      // so the current hash sitting in `superseded` would be dead weight.
      expect(hashes, `${tab} lists its own current default`).not.toContain(
        KERNEL_DEFAULT_TAB_HASHES[tab as KernelTab],
      );
    }
  });

  // THE guard: this failing means the built-in defaults changed substantively without a
  // kernel bump (or vice versa). It is the mechanical definition of "substantive change".
  it("the current defaults hash exactly to KERNEL_DEFAULT_TAB_HASHES — advance the kernel when this fails", () => {
    const recomputed = computeKernelTabHashes(defaultSystemConfig());
    const moved = KERNEL_TAB_KEYS.filter(
      (tab) => recomputed[tab] !== KERNEL_DEFAULT_TAB_HASHES[tab],
    );
    expect(
      moved,
      "The built-in default config changed substantively (the listed settings tabs no longer " +
        "hash to KERNEL_DEFAULT_TAB_HASHES). Advance the kernel in " +
        "core/src/state/kernel-history.ts: set KERNEL_VERSION to today's date (several " +
        "changes on the same day may reuse it), then, for each tab listed, append its OLD " +
        "KERNEL_DEFAULT_TAB_HASHES hash to the end of KERNEL_SUPERSEDED_TAB_HASHES[tab] " +
        "(creating the entry if this is its first change; never edit the hashes already " +
        "there, they are frozen) and write the recomputed hash in — take it from " +
        "computeKernelTabHashes(defaultSystemConfig()). Finally note what moved in the " +
        "generation list above KERNEL_DEFAULT_TAB_HASHES.",
    ).toEqual([]);
  });

  // Keeps the oldest recorded generation honest: its pinned hash is the only record of what a
  // pre-#257 `system_config.yaml` actually contains, and nothing else can catch a typo in it.
  // The recipe reads the *current* template, so the proof stands only while `system_prompt`
  // has not drifted since the toggles generation. A change to it moves the prompt tab, fails
  // this test, and the proof must then be re-anchored (or retired) deliberately rather than
  // quietly passing on leftovers.
  it("the pre-toggles prompt tab equals the LEGACY_* reconstruction", () => {
    const reconstructed = preTogglesDefaultConfig();
    expect(kernelTabHash(reconstructed, "prompt")).toBe(KERNEL_SUPERSEDED_TAB_HASHES.prompt?.[0]);
    // The recipe's other half: an era config carries no vault/skills/schedules sections at all,
    // which is why those tabs have no superseded hash — they are materialized on absence.
    for (const tab of ["vault", "skills", "schedules"] as const) {
      expect(kernelTabHash(reconstructed, tab), tab).toBeNull();
    }
  });

  it("no kernel tab owns identity fields, the State version or MCP servers", () => {
    const owned = KERNEL_TAB_KEYS.flatMap((tab) => [...KERNEL_TABS[tab]]);
    for (const excluded of ["name", "description", "version", "kernel_version", "tools"]) {
      expect(owned).not.toContain(excluded);
    }
    // And writing user data into them moves no tab hash, so none of it can be clobbered.
    const defaults = defaultSystemConfig();
    expect(
      computeKernelTabHashes({
        ...defaults,
        name: "n",
        description: "d",
        version: 7,
        tools: { ...defaults.tools, mcpServers: [{ name: "m", config: {} }] },
      }),
    ).toEqual(computeKernelTabHashes(defaults));
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
    expect(result.advanced).toEqual(["prompt", "skills", "vault", "schedules"]);
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

  it("keeps a customized tab whole (reported) while its untouched siblings advance", async () => {
    const config = mutableConfig(preTogglesDefaultConfig());
    config.system_prompt = "MY CUSTOM PROMPT";
    (config.memory as Record<string, unknown>).prompt = "my memory prompt";
    await seedConfig(config);
    const result = await update();
    expect(result.kept).toEqual(["prompt", "memory"]);
    expect(result.advanced).toEqual(["skills", "vault", "schedules"]);
    const written = await readConfig();
    expect(written.system_prompt).toBe("MY CUSTOM PROMPT");
    expect(written.memory?.prompt).toBe("my memory prompt");
    // The rest of the kept tab is kept with it — nothing inside it is rewritten.
    expect(written.memory?.workspace_prompt).toBe(
      preTogglesDefaultConfig().memory?.workspace_prompt,
    );
    expect(written.vault).toEqual(defaultSystemConfig().vault);
    expect(written.kernel_version).toBe(KERNEL_VERSION);
  });

  it("keeps a tab from an unrecorded generation conservatively, missing fields included", async () => {
    const config = mutableConfig(defaultSystemConfig());
    delete config.kernel_version;
    // An ancient compaction wording we cannot reconstruct, with the rest of the section gone:
    // the runtime tab matches no recorded hash, so it is kept exactly as written.
    config.compaction = { mode: "summarize", prompt: "Ancient compaction wording." };
    await seedConfig(config);
    const result = await update();
    expect(result.kept).toEqual(["runtime"]);
    expect(result.advanced).toEqual([]);
    const written = await readConfig();
    expect(written.compaction?.prompt).toBe("Ancient compaction wording.");
    // The tab is kept whole: its absent fields stay absent and keep falling back to the
    // built-in defaults at runtime, rather than being materialized field by field.
    expect(written.compaction?.max_context_length).toBeUndefined();
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
    await update();
    const written = await readConfig();
    expect(written.name).toBe("Custom Name");
    expect(written.description).toBe("Custom description");
    expect(written.version).toBe(7);
    expect(written.tools?.mcpServers).toEqual([
      { name: "custom-mcp", config: { command: "custom-server" } },
    ]);
  });

  it("keeps the whole tools tab once any tool is edited, added or removed", async () => {
    const config = mutableConfig(defaultSystemConfig());
    delete config.kernel_version;
    const tools = config.tools as { builtin: Array<Record<string, unknown>> };
    const readFile = tools.builtin.find((t) => t.name === "read_file")!;
    readFile.description = "my own description";
    tools.builtin = tools.builtin.filter((t) => t.name !== "edit_file");
    tools.builtin.push({ name: "my_tool", description: "user-added", permission: "r" });
    await seedConfig(config);

    const result = await update();
    expect(result.kept).toEqual(["tools"]);
    expect(result.advanced).toEqual([]);

    const written = await readConfig();
    const names = (written.tools?.builtin ?? []).map((t) => t.name);
    expect(names).not.toContain("edit_file"); // a deliberate removal is preserved
    expect(names).toContain("my_tool"); // user-added entries survive
    expect(written.tools?.builtin?.find((t) => t.name === "read_file")?.description).toBe(
      "my own description",
    );
  });

  it("advances a tools tab that matches a superseded default, bringing tools added since", async () => {
    // The path every existing config takes when the default toolset changes: the stored tab is
    // not the current default, but it hash-matches a superseded one, so it is an untouched old
    // default and the whole tab is rewritten — which is also how a tool added by a later
    // kernel reaches the config. Driven through the seam so the test cannot rot when the real
    // record moves on.
    const config = mutableConfig(defaultSystemConfig());
    delete config.kernel_version;
    const tools = config.tools as { builtin: Array<Record<string, unknown>> };
    tools.builtin = tools.builtin.slice(0, -1); // an old default, missing a tool added since
    const supersededTabs: KernelSupersededTabHashes = { tools: [kernelTabHash(config, "tools")!] };
    await seedConfig(config);

    const result = await applyKernelUpdate(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, {
      supersededTabs,
    });
    expect(result.advanced).toEqual(["tools"]);
    expect(result.kept).toEqual([]);
    const written = await readConfig();
    expect(written.tools?.builtin).toEqual(defaultSystemConfig().tools?.builtin);
    expect(written.kernel_version).toBe(KERNEL_VERSION);
  });

  it("materializes the whole default toolset when tools.builtin is missing", async () => {
    const config = mutableConfig(defaultSystemConfig());
    delete config.kernel_version;
    delete config.tools;
    await seedConfig(config);
    const result = await update();
    expect(result.advanced).toEqual(["tools"]);
    expect((await readConfig()).tools?.builtin).toEqual(defaultSystemConfig().tools?.builtin);
  });

  it("tolerates dangling/invalid section keys (a hand-edited `tools:` with no value parses as null)", async () => {
    await loadOrInitAgentState({ root });
    await fs.writeFile(
      configPath(),
      // `tools` is a dangling key: the whole tab reads absent and must be materialized instead
      // of crashing setIn. `model: 3` leaves the runtime tab present but matching nothing, so
      // that tab is kept exactly as the user left it.
      "system_prompt: custom\nmodel: 3\ntools:\n",
      "utf8",
    );
    const result = await update();
    expect(result.kept).toEqual(["prompt", "runtime"]);
    expect(result.advanced).toEqual(["tools", "skills", "memory", "vault", "schedules"]);
    const defaults = defaultSystemConfig();
    const written = await readConfig();
    expect(written.tools?.builtin).toEqual(defaults.tools?.builtin);
    expect(written.memory).toEqual(defaults.memory);
    expect(written.system_prompt).toBe("custom");
    expect(written.model as unknown).toBe(3);
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
    // max_turns 5 is a customization (no generation ever defaulted to 5) — its tab is kept.
    expect(result.kept).toEqual(["runtime"]);
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
