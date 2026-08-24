/**
 * Agent config kernel versions: the pinned-hash guard (the mechanical definition of "the
 * defaults changed substantively, bump the kernel version"), the record's internal
 * consistency, the proof that the flat record decides exactly as the retired generation-keyed
 * table did, the seeded pre-#257 generation's reconstruction proof, and the smart-merge
 * semantics of applyKernelUpdate (untouched old defaults advance, customizations and unknown
 * generations are kept, identity fields and user data are never touched, YAML comments
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
  KERNEL_HISTORY,
  KERNEL_VERSION,
  LEGACY_SKILLS_SECTION,
  LEGACY_VAULT_SECTION,
  SCHEDULES_PLACEHOLDER,
  SKILLS_PLACEHOLDER,
  VAULT_PLACEHOLDER,
  applyKernelUpdate,
  computeKernelHashes,
  defaultSystemConfig,
  hashKernelValue,
  isKernelOutdated,
  isSupersededDefault,
  kernelLeafEntries,
  loadOrInitAgentState,
  resetSystemConfigToDefaults,
  systemConfigPath,
  type KernelHistory,
  type SystemConfig,
} from "../src/index.js";
import { LEGACY_KERNEL_HASH_HISTORY } from "./fixtures/legacy-kernel-hash-history.js";

/** The two oldest recorded generations (see KERNEL_HISTORY's doc comment). */
const PRE_TOGGLES_GENERATION = "2026-08-10";
const TOGGLES_GENERATION = "2026-08-11";

/** A mutable plain-object clone of a config, for seeding on-disk scenarios. */
function mutableConfig(config: SystemConfig): Record<string, unknown> {
  return structuredClone(config) as unknown as Record<string, unknown>;
}

/**
 * Reconstructs a pre-#257 (pre-toggles) shaped config from the current defaults: the frozen
 * LEGACY_* sections swapped back into the template in place of the section placeholders, no
 * `{{SCHEDULES}}` line, and no vault/skills/schedules config sections (the recipe
 * prompt-sections.test.ts proves byte-exact for the template). Leaves outside the swap — the
 * tool entries — carry the *current* defaults, so the smart-merge tests below treat them as
 * already-current; the seeding exercises the old-template migration paths regardless. The
 * reconstruction proof below therefore speaks only for the leaves whose default has not
 * drifted since the toggles generation (see there).
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

describe("kernel hash record (pinned-hash guard)", () => {
  it("KERNEL_VERSION is a date, and the record is anchored to it", () => {
    expect(KERNEL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The record describes this kernel: `addedIn` calls a leaf "new" by comparing to it.
    expect(KERNEL_HISTORY.version).toBe(KERNEL_VERSION);
    for (const [path, version] of Object.entries(KERNEL_HISTORY.addedIn)) {
      expect(version, path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(version <= KERNEL_VERSION, `${path} added in the future`).toBe(true);
    }
  });

  it("the record has no orphans and no entries that could never fire", () => {
    const leaves = Object.keys(KERNEL_HISTORY.current);
    expect(leaves.length).toBeGreaterThan(0);
    for (const path of [
      ...Object.keys(KERNEL_HISTORY.superseded),
      ...Object.keys(KERNEL_HISTORY.addedIn),
    ]) {
      // A leaf that left the defaults must leave the record with it.
      expect(leaves, `${path} is not a current leaf`).toContain(path);
    }
    for (const [path, hashes] of Object.entries(KERNEL_HISTORY.superseded)) {
      expect(hashes.length, path).toBeGreaterThan(0);
      expect(new Set(hashes).size, `${path} repeats a superseded hash`).toBe(hashes.length);
      // kernel-update.ts short-circuits on the current default before consulting the record,
      // so the current hash sitting in `superseded` would be dead weight.
      expect(hashes, `${path} lists its own current default`).not.toContain(
        KERNEL_HISTORY.current[path],
      );
    }
  });

  // THE guard: this failing means the built-in defaults changed substantively without a
  // kernel bump (or vice versa). It is the mechanical definition of "substantive change".
  it("the current defaults hash exactly to KERNEL_HISTORY.current — advance the kernel when this fails", () => {
    const recomputed = computeKernelHashes(defaultSystemConfig());
    const pinned = KERNEL_HISTORY.current;
    const added = Object.keys(recomputed)
      .filter((p) => pinned[p] === undefined)
      .sort();
    const changed = Object.keys(recomputed)
      .filter((p) => pinned[p] !== undefined && pinned[p] !== recomputed[p])
      .sort();
    const removed = Object.keys(pinned)
      .filter((p) => recomputed[p] === undefined)
      .sort();
    expect(
      { added, changed, removed },
      "The built-in default config changed substantively. Advance the kernel in " +
        "core/src/state/kernel-history.ts: set KERNEL_VERSION to today's date (several " +
        "changes on the same day may reuse it), then, with the hashes from " +
        "computeKernelHashes(defaultSystemConfig()) — for each `changed` leaf, append its " +
        "OLD KERNEL_HISTORY.current hash to KERNEL_HISTORY.superseded[leaf] (never edit the " +
        "hashes already there, they are frozen) and write the new hash into `current`; for " +
        "each `added` leaf, put its hash in `current` and add addedIn[leaf] = KERNEL_VERSION " +
        "(that entry is what makes an existing config receive a brand-new default tool); for " +
        "each `removed` leaf, delete it from `current`, `superseded` and `addedIn`. Then note " +
        "what changed in the generation list above KERNEL_HISTORY.",
    ).toEqual({ added: [], changed: [], removed: [] });
  });

  // Keeps the oldest recorded generation honest: its pinned hashes are the only record of what
  // a pre-#257 `system_config.yaml` actually contains, and nothing else can catch a typo in
  // them. The recipe reads the *current* defaults, so it can only speak for leaves whose
  // default has not drifted since the toggles generation — chiefly `system_prompt`, the leaf
  // the LEGACY_* swap is actually about. Retirement is therefore per leaf and automatic: a
  // generation that changes some other leaf (e.g. run_subagent's thinking_level in
  // "2026-08-18") drops just that leaf and leaves the proof standing.
  it("the pre-toggles generation's pinned hashes equal the LEGACY_* reconstruction", () => {
    const preToggles = LEGACY_KERNEL_HASH_HISTORY[PRE_TOGGLES_GENERATION]!;
    const toggles = LEGACY_KERNEL_HASH_HISTORY[TOGGLES_GENERATION]!;
    const current = computeKernelHashes(defaultSystemConfig());
    const reconstructed = computeKernelHashes(preTogglesDefaultConfig());
    const reconstructible = Object.keys(preToggles).filter((p) => current[p] === toggles[p]);
    // If the template itself ever moves, this proof has nothing left to say and must be
    // re-anchored (or retired) deliberately rather than quietly passing on leftovers.
    expect(reconstructible).toContain("system_prompt");
    expect(Object.fromEntries(reconstructible.map((p) => [p, reconstructed[p]]))).toEqual(
      Object.fromEntries(reconstructible.map((p) => [p, preToggles[p]])),
    );
    // The recipe's other half: an era config carries no vault/skills/schedules sections at all.
    expect(Object.keys(reconstructed).filter((p) => /^(vault|skills|schedules)\./.test(p))).toEqual(
      [],
    );
  });

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

/**
 * The flat record replaced a generation-keyed snapshot of every leaf hash. This proves the
 * replacement is a pure change of representation: for every `(leaf, hash)` pair the retired
 * table ever recorded, the kernel update reaches the same verdict as before. It is not a
 * one-time check — a later kernel that changes a default without recording the superseded
 * hash makes it fail, which is exactly the mistake the flat shape invites.
 */
describe("kernel record equivalence with the retired generation table", () => {
  type Verdict = "already-current" | "advance" | "keep";
  const generations = Object.values(LEGACY_KERNEL_HASH_HISTORY);
  const currentHashes = computeKernelHashes(defaultSystemConfig());

  /** applyKernelUpdate's verdict as the retired table produced it (historicalHashes lookup). */
  const legacyVerdict = (path: string, storedHash: string): Verdict =>
    storedHash === currentHashes[path]
      ? "already-current" // the `storedHash === defaultHash` short-circuit, before any lookup
      : generations.some((generation) => generation[path] === storedHash)
        ? "advance"
        : "keep";

  /** The same verdict from the flat record. */
  const recordVerdict = (path: string, storedHash: string): Verdict =>
    storedHash === currentHashes[path]
      ? "already-current"
      : isSupersededDefault(path, storedHash)
        ? "advance"
        : "keep";

  it("reaches the same verdict for every (leaf, hash) the retired table recorded", () => {
    const pairs = generations.flatMap((generation) =>
      Object.entries(generation).map(([path, hash]) => ({ path, hash })),
    );
    expect(pairs).toHaveLength(158);
    expect(new Set(pairs.map((pair) => `${pair.path}|${pair.hash}`)).size).toBe(37);
    const disagreements = pairs
      .filter(({ path, hash }) => legacyVerdict(path, hash) !== recordVerdict(path, hash))
      .map(({ path, hash }) => ({
        path,
        hash,
        legacy: legacyVerdict(path, hash),
        record: recordVerdict(path, hash),
      }));
    expect(disagreements).toEqual([]);
    // The proof would be vacuous if nothing ever advanced: 8 hashes over 6 leaves do.
    const advancing = pairs.filter(({ path, hash }) => recordVerdict(path, hash) === "advance");
    expect(new Set(advancing.map((pair) => `${pair.path}|${pair.hash}`)).size).toBe(8);
    expect(new Set(advancing.map((pair) => pair.path)).size).toBe(6);
  });

  it("carries exactly the superseded hashes of that era, oldest first — none dropped, none invented", () => {
    for (const path of new Set(generations.flatMap((generation) => Object.keys(generation)))) {
      const everRecorded: string[] = [];
      for (const generation of generations) {
        const hash = generation[path];
        if (hash !== undefined && !everRecorded.includes(hash)) everRecorded.push(hash);
      }
      const expected = everRecorded.filter((hash) => hash !== currentHashes[path]);
      // Later kernels append hashes this frozen fixture cannot speak for; ignore those.
      const recorded = (KERNEL_HISTORY.superseded[path] ?? []).filter((hash) =>
        everRecorded.includes(hash),
      );
      expect(recorded, path).toEqual(expected);
    }
  });

  it("dates each leaf's arrival where the retired table first recorded it", () => {
    const versions = Object.keys(LEGACY_KERNEL_HASH_HISTORY).sort();
    const oldest = versions[0]!;
    for (const path of new Set(generations.flatMap((generation) => Object.keys(generation)))) {
      const firstSeen = versions.find((version) => LEGACY_KERNEL_HASH_HISTORY[version]![path]);
      // Leaves already present in the oldest recorded generation predate the record.
      expect(KERNEL_HISTORY.addedIn[path], path).toBe(firstSeen === oldest ? undefined : firstSeen);
    }
    // And the one decision addedIn drives lines up with the retired newInLatestGeneration.
    const newInLatest = new Set(
      [...new Set(generations.flatMap((generation) => Object.keys(generation)))].filter((path) =>
        Object.entries(LEGACY_KERNEL_HASH_HISTORY).every(
          ([version, hashes]) => version === versions.at(-1) || hashes[path] === undefined,
        ),
      ),
    );
    expect(newInLatest).toEqual(
      new Set(["tools.builtin.kill_command", "tools.builtin.kill_subagent"]),
    );
    for (const path of newInLatest) expect(KERNEL_HISTORY.addedIn[path], path).toBe(KERNEL_VERSION);
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

  it("keeps values from unrecorded generations conservatively", async () => {
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
    expect(written.compaction?.max_context_length).toBe(256000);
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

  it("advances a stored tool entry that matches a superseded default's hash", async () => {
    // The path every existing config takes when a tool's default schema changes (the first
    // such bump is run_subagent's thinking_level, "2026-08-18"): the stored entry is not the
    // current default, but it hash-matches a superseded one, so it is an untouched old
    // default and must be replaced — not kept as if the user had edited it. Driven through
    // the history seam so the test cannot rot when the real record moves on.
    const defaults = defaultSystemConfig();
    const current = computeKernelHashes(defaults);
    const currentEntry = defaults.tools?.builtin?.find((t) => t.name === "run_subagent");
    const oldEntry = { ...currentEntry!, description: "the previous generation's wording" };
    const history: KernelHistory = {
      version: KERNEL_VERSION,
      current,
      superseded: { "tools.builtin.run_subagent": [hashKernelValue(oldEntry)] },
      addedIn: {},
    };
    const config = mutableConfig(defaults);
    config.kernel_version = "2000-01-01";
    const tools = config.tools as { builtin: Array<Record<string, unknown>> };
    tools.builtin = tools.builtin.map((t) =>
      t.name === "run_subagent" ? (oldEntry as unknown as Record<string, unknown>) : t,
    );
    await seedConfig(config);

    const result = await applyKernelUpdate(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, {
      history,
    });
    expect(result.advanced).toEqual(["tools.builtin.run_subagent"]);
    expect(result.kept).toEqual([]);
    const written = await readConfig();
    expect(written.tools?.builtin?.find((t) => t.name === "run_subagent")).toEqual(currentEntry);
    expect(written.kernel_version).toBe(KERNEL_VERSION);
  });

  it("appends the tools the current kernel added to a config that predates them (real record)", async () => {
    // The other half of the same rule, driven by the shipped KERNEL_HISTORY rather than the
    // seam: a config written before the current kernel carries a tools array without the
    // tools that kernel introduced, and must receive them — while a tool it dropped on
    // purpose stays dropped. KERNEL_HISTORY.addedIn is the only thing that tells them apart.
    const defaults = defaultSystemConfig();
    const addedNow = Object.entries(KERNEL_HISTORY.addedIn)
      .filter(([path, version]) => version === KERNEL_VERSION && path.startsWith("tools.builtin."))
      .map(([path]) => path.slice("tools.builtin.".length));
    expect(addedNow.length).toBeGreaterThan(0);
    const config = mutableConfig(defaults);
    delete config.kernel_version;
    const tools = config.tools as { builtin: Array<Record<string, unknown>> };
    tools.builtin = tools.builtin.filter(
      (t) => !addedNow.includes(t.name as string) && t.name !== "write_file",
    );
    await seedConfig(config);

    const result = await update();
    expect(result.advanced).toEqual(addedNow.map((name) => `tools.builtin.${name}`));
    expect(result.kept).toEqual(["tools.builtin.write_file"]);
    const names = ((await readConfig()).tools?.builtin ?? []).map((t) => t.name);
    for (const name of addedNow) expect(names).toContain(name);
    expect(names).not.toContain("write_file");
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

  it("appends a tool only when it is new in the current kernel (history seam)", async () => {
    const defaults = defaultSystemConfig();
    const current = computeKernelHashes(defaults);
    // A fabricated record in which edit_file — and only edit_file — arrived with the current
    // kernel: a present array missing read_file is then a deliberate removal (kept), while
    // the same absence of edit_file means the config simply predates the tool (appended).
    const history: KernelHistory = {
      version: KERNEL_VERSION,
      current,
      superseded: {},
      addedIn: { "tools.builtin.edit_file": KERNEL_VERSION },
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
