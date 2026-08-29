/**
 * The Vault / Skills / Schedules prompt-injection sections (the memory-style
 * placeholder + toggle + editable prompt pattern): section rendering through the
 * `{{VAULT}}` / `{{SKILLS}}` / `{{SCHEDULES}}` placeholders, the toggles, the default-prompt
 * fallbacks, the single-pass expansion property, the legacy inline-placeholder
 * compatibility, the insert/migrate helpers, and schedule-name collection.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { systemConfigPath } from "../src/state/paths.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  VAULT_PLACEHOLDER,
  SKILLS_PLACEHOLDER,
  SCHEDULES_PLACEHOLDER,
  VAULT_KEYS_PLACEHOLDER,
  SKILL_METADATA_PLACEHOLDER,
  LEGACY_VAULT_SECTION,
  LEGACY_SKILLS_SECTION,
  SCHEDULE_LIST_EMPTY_NOTE,
  assembleSystemPrompt,
  createAgent,
  hasSchedulesPlaceholder,
  hasSkillsPlaceholder,
  hasVaultPlaceholder,
  insertSchedulesPlaceholder,
  insertSkillsPlaceholder,
  insertVaultPlaceholder,
  listScheduleNames,
  loadOrInitAgentState,
  scheduleDir,
  type AgentState,
  type SystemConfig,
} from "../src/index.js";
import { stubProviderKeys } from "./provider-keys.js";

let root: string;
let restoreKeys: () => void;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-sections-"));
  restoreKeys = stubProviderKeys();
});

afterEach(async () => {
  restoreKeys();
  await fs.rm(root, { recursive: true, force: true });
});

/** Loads a default Agent State under the temp root (creates it on first call). */
async function agentState(): Promise<AgentState> {
  return loadOrInitAgentState({ root });
}

/** A copy of `state` with the given systemConfig fields overridden (in memory only). */
function withConfig(state: AgentState, patch: Partial<SystemConfig>): AgentState {
  return { ...state, systemConfig: { ...state.systemConfig, ...patch } };
}

const DEMO_SKILL = { name: "demo", description: "Demo skill.", version: 1, updated: "2026-08-01" };

/** A complete Environment section, so the rendered prompt carries every `- Label: value` line. */
const SESSION_ENVIRONMENT = {
  sessionId: "session-2026-08-01-00-00-00-0000abcd",
  cwd: "/tmp/workspace",
  agentId: DEFAULT_AGENT_ID,
  projectDir: "/tmp/penguin",
  provider: "anthropic",
  modelId: "claude-sonnet-4-5",
  platform: "linux",
  osVersion: "6.1.0",
  shell: "bash",
  date: "2026-08-01",
};

describe("{{VAULT}} rendering", () => {
  it("renders the default vault section with the key-name list", async () => {
    const prompt = assembleSystemPrompt(await agentState(), undefined, ["KEY_A", "KEY_B"]);
    expect(prompt).toContain("# Vault");
    expect(prompt).toContain("- KEY_A\n- KEY_B");
    expect(prompt).not.toContain(VAULT_PLACEHOLDER);
    expect(prompt).not.toContain(VAULT_KEYS_PLACEHOLDER);
  });

  it("still renders the statement for an empty key list, but nothing without key data", async () => {
    const state = await agentState();
    // Empty list: the vault's purpose statement stays (the model is told what the vault is).
    expect(assembleSystemPrompt(state, undefined, [])).toContain("# Vault");
    // No data at all (direct SDK render): the section is absent, no residue either.
    const bare = assembleSystemPrompt(state);
    expect(bare).not.toContain("# Vault");
    expect(bare).not.toContain(VAULT_PLACEHOLDER);
  });

  it("injects nothing when the toggle is off", async () => {
    const state = withConfig(await agentState(), { vault: { enabled: false } });
    const prompt = assembleSystemPrompt(state, undefined, ["KEY_A"]);
    expect(prompt).not.toContain("# Vault");
    expect(prompt).not.toContain("- KEY_A");
  });

  it("injects nothing into a template without the placeholder — nothing is spliced in", async () => {
    const state = withConfig(await agentState(), {
      system_prompt: "# Role\nDo things.\n# Environment",
    });
    expect(assembleSystemPrompt(state, undefined, ["KEY_A"])).toBe(
      "# Role\nDo things.\n# Environment",
    );
  });

  it("falls back to the built-in prompt for a config that predates the vault section", async () => {
    const state = await agentState();
    const { vault: _vault, ...withoutVault } = state.systemConfig;
    const legacy: AgentState = { ...state, systemConfig: withoutVault };
    // The DTO reports the default as effective; rendering must agree.
    const prompt = assembleSystemPrompt(legacy, undefined, ["KEY_A"]);
    expect(prompt).toContain("# Vault");
    expect(prompt).toContain("- KEY_A");
  });

  it("substitutes {{VAULT_KEYS}} inside a custom vault prompt", async () => {
    const state = withConfig(await agentState(), {
      vault: { enabled: true, prompt: `## Secrets\n${VAULT_KEYS_PLACEHOLDER}\nend` },
    });
    const prompt = assembleSystemPrompt(state, undefined, ["ONLY_KEY"]);
    expect(prompt).toContain("## Secrets\n- ONLY_KEY\nend");
    expect(prompt).not.toContain("# Vault");
  });
});

describe("{{SKILLS}} rendering", () => {
  it("renders the default skills section with metadata lines", async () => {
    const prompt = assembleSystemPrompt(await agentState(), undefined, undefined, [DEMO_SKILL]);
    expect(prompt).toContain("# Skills");
    expect(prompt).toContain("[use_skills]");
    expect(prompt).toContain("- `demo` — Demo skill.");
    expect(prompt).not.toContain(SKILLS_PLACEHOLDER);
    expect(prompt).not.toContain(SKILL_METADATA_PLACEHOLDER);
  });

  it("still renders the statement for an empty skill list, but nothing without skill data", async () => {
    const state = await agentState();
    expect(assembleSystemPrompt(state, undefined, undefined, [])).toContain("# Skills");
    expect(assembleSystemPrompt(state)).not.toContain("# Skills");
  });

  it("injects nothing when the toggle is off", async () => {
    const state = withConfig(await agentState(), { skills: { enabled: false } });
    const prompt = assembleSystemPrompt(state, undefined, undefined, [DEMO_SKILL]);
    expect(prompt).not.toContain("# Skills");
    expect(prompt).not.toContain("- `demo`");
  });

  it("falls back to the built-in prompt for a config that predates the skills section", async () => {
    const state = await agentState();
    const { skills: _skills, ...withoutSkills } = state.systemConfig;
    const legacy: AgentState = { ...state, systemConfig: withoutSkills };
    expect(assembleSystemPrompt(legacy, undefined, undefined, [DEMO_SKILL])).toContain(
      "- `demo` — Demo skill.",
    );
  });
});

describe("{{SCHEDULES}} rendering", () => {
  it("renders the default schedules section with the task roster", async () => {
    const prompt = assembleSystemPrompt(await agentState(), undefined, undefined, undefined, null, [
      "daily-report",
      "weekly-sync",
    ]);
    expect(prompt).toContain("# Scheduled Tasks");
    expect(prompt).toContain("Current tasks:\n- daily-report\n- weekly-sync");
    expect(prompt).not.toContain(SCHEDULES_PLACEHOLDER);
    expect(prompt).not.toContain("{{SCHEDULE_LIST}}");
  });

  it("states the roster is empty for an empty list, and renders nothing without roster data", async () => {
    const state = await agentState();
    // Empty roster: the guidance still teaches the task system, with the empty note in place
    // of a blank line (the indexForInjection convention).
    const empty = assembleSystemPrompt(state, undefined, undefined, undefined, null, []);
    expect(empty).toContain("# Scheduled Tasks");
    expect(empty).toContain(`Current tasks:\n${SCHEDULE_LIST_EMPTY_NOTE}`);
    // No roster supplied at all: the section is absent.
    expect(assembleSystemPrompt(state)).not.toContain("# Scheduled Tasks");
  });

  it("injects nothing when the toggle is off", async () => {
    const state = withConfig(await agentState(), { schedules: { enabled: false } });
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, null, ["daily"]);
    expect(prompt).not.toContain("# Scheduled Tasks");
    expect(prompt).not.toContain("- daily");
  });

  // The section tells the model to target this Session by writing the id off the Environment
  // section's Session ID line. That instruction is only resolvable while both halves render
  // into the same prompt under the same label, so both are pinned to one literal here: rename
  // the Environment line and this fails until the section is re-pointed.
  it("points session_id at the Environment section's Session ID line, which renders with it", async () => {
    const sessionId = "session-2026-08-26-09-00-00-abcd1234";
    const prompt = assembleSystemPrompt(
      await agentState(),
      { ...SESSION_ENVIRONMENT, sessionId },
      undefined,
      undefined,
      null,
      ["daily-report"],
    );
    const label = "Session ID";
    expect(prompt).toContain(`- ${label}: ${sessionId}`);
    expect(prompt).toContain(`write the id from the Environment section's ${label} line`);
    // The fresh-Session form stays available, and the two targets stay mutually exclusive
    // (schedule-file.ts rejects a file that mixes them).
    expect(prompt).toContain("Each trigger then opens a new Session");
    expect(prompt).toContain(
      "`session_id` cannot be combined with workspace / provider / model_id",
    );
    // The example writes the target as `<session_id>`, which the model can only resolve because
    // the system prompt's File system section declares angle-bracket names substitutable and
    // names this one. That section lives in the `prompt` kernel tab, a different tab from
    // `schedules` — so pin the pair, or one tab can advance out from under the other.
    expect(prompt).toContain('session_id = "<session_id>"');
    expect(prompt).toContain(
      "Angle-bracket names such as `<app_data_dir>` and `<session_id>` are placeholders",
    );
    // Defaulting to this Session makes the self-directed loop ordinary, so the section carries
    // the bound that ends one — conditioned on the request having a horizon, so an open-ended
    // reminder is not silently given an expiry date.
    expect(prompt).toContain("give it an `end_at` when the request has a natural horizon");
    expect(prompt).toContain("leave `end_at` off and say in your reply");
    // A subagent renders this same section against its own short-lived Session.
    expect(prompt).toContain("If `run_subagent` is not in your tool list, you are the subagent");
    // A Session is not the durable identity of a conversation, and the section says so.
    expect(prompt).toContain("this Session is not permanent");
  });

  it("falls back to the built-in prompt for a config that predates the schedules section", async () => {
    const state = await agentState();
    const { schedules: _schedules, ...withoutSchedules } = state.systemConfig;
    const legacy: AgentState = { ...state, systemConfig: withoutSchedules };
    expect(
      assembleSystemPrompt(legacy, undefined, undefined, undefined, null, ["daily"]),
    ).toContain("Current tasks:\n- daily");
  });
});

describe("single-pass section expansion", () => {
  it("never expands section tokens carried by another section's prompt", async () => {
    const state = withConfig(await agentState(), {
      vault: {
        enabled: true,
        prompt: `# Vault\n${VAULT_KEYS_PLACEHOLDER}\nsmuggled: {{SKILLS}} {{MEMORY}} {{SCHEDULES}} {{SCHEDULE_LIST}}`,
      },
    });
    const prompt = assembleSystemPrompt(state, undefined, ["KEY_A"], [DEMO_SKILL], null, ["t1"]);
    // The vault block rendered (its own inner token replaced) …
    expect(prompt).toContain("- KEY_A");
    // … but the section tokens it carried stay literal text: the single pass finds tokens in
    // the template only, and replacer output is never rescanned.
    expect(prompt).toContain("smuggled: {{SKILLS}} {{MEMORY}} {{SCHEDULES}} {{SCHEDULE_LIST}}");
    // The template's own {{SKILLS}}/{{SCHEDULES}} still rendered normally.
    expect(prompt).toContain("- `demo` — Demo skill.");
    expect(prompt).toContain("Current tasks:\n- t1");
  });

  it("never expands section tokens smuggled into memory index content", async () => {
    const prompt = assembleSystemPrompt(
      await agentState(),
      undefined,
      ["KEY_A"],
      [DEMO_SKILL],
      {
        userDir: "/data/memory/user",
        userIndex: "- [x](x.md) — {{VAULT}} {{SKILLS}} {{SCHEDULES}} {{VAULT_KEYS}}",
      },
      [],
    );
    expect(prompt).toContain("- [x](x.md) — {{VAULT}} {{SKILLS}} {{SCHEDULES}} {{VAULT_KEYS}}");
  });
});

describe("legacy inline placeholders (pre-{{VAULT}}/{{SKILLS}} templates)", () => {
  /** A minimal legacy-style custom template carrying the inline tokens directly in the body. */
  function inlineState(state: AgentState, patch?: Partial<SystemConfig>): AgentState {
    return withConfig(state, {
      system_prompt: ["before", VAULT_KEYS_PLACEHOLDER, SKILL_METADATA_PLACEHOLDER, "after"].join(
        "\n",
      ),
      ...patch,
    });
  }

  it("still substitutes inline {{VAULT_KEYS}} / {{SKILL_METADATA}} at template level", async () => {
    const state = inlineState(await agentState());
    const prompt = assembleSystemPrompt(state, undefined, ["KEY_A"], [DEMO_SKILL]);
    expect(prompt).toBe(["before", "- KEY_A", "- `demo` — Demo skill.", "after"].join("\n"));
  });

  it("renders inline tokens as empty strings when the toggles are off — the switches govern old templates too", async () => {
    const state = inlineState(await agentState(), {
      vault: { enabled: false },
      skills: { enabled: false },
    });
    const prompt = assembleSystemPrompt(state, undefined, ["KEY_A"], [DEMO_SKILL]);
    expect(prompt).toBe(["before", "", "", "after"].join("\n"));
  });
});

describe("insert / migrate helpers", () => {
  /**
   * Reconstructs the pre-toggle default template from the current one: the section
   * placeholders swapped back for the hardcoded sections, and no {{SCHEDULES}} line — exactly
   * what a stored legacy `system_config.yaml` carries.
   */
  function legacyDefaultTemplate(current: string): string {
    return current
      .split(VAULT_PLACEHOLDER)
      .join(LEGACY_VAULT_SECTION)
      .split(SKILLS_PLACEHOLDER)
      .join(LEGACY_SKILLS_SECTION)
      .split(`${SCHEDULES_PLACEHOLDER}\n\n`)
      .join("");
  }

  it("migrates a legacy default template back to the current one, placeholder by placeholder", async () => {
    const current = (await agentState()).systemConfig.system_prompt;
    const legacy = legacyDefaultTemplate(current);
    expect(hasVaultPlaceholder(legacy)).toBe(false);
    expect(hasSkillsPlaceholder(legacy)).toBe(false);
    expect(hasSchedulesPlaceholder(legacy)).toBe(false);

    // Each migration replaces its legacy section verbatim, in place; schedules (which never
    // had a legacy section) inserts before # Environment — the three together reproduce the
    // current default template exactly.
    const migrated = insertSchedulesPlaceholder(
      insertSkillsPlaceholder(insertVaultPlaceholder(legacy)),
    );
    expect(migrated).toBe(current);
  });

  it("is idempotent on a template that already carries the placeholders", async () => {
    const current = (await agentState()).systemConfig.system_prompt;
    expect(insertVaultPlaceholder(current)).toBe(current);
    expect(insertSkillsPlaceholder(current)).toBe(current);
    expect(insertSchedulesPlaceholder(current)).toBe(current);
  });

  it("inserts before # Environment when there is no legacy section, else appends", () => {
    const withEnvironment = "# Role\nDo things.\n\n# Environment\n- CWD: {{CWD}}";
    expect(insertVaultPlaceholder(withEnvironment)).toBe(
      `# Role\nDo things.\n\n${VAULT_PLACEHOLDER}\n\n# Environment\n- CWD: {{CWD}}`,
    );
    const bare = "# Role\nDo things.";
    expect(insertSkillsPlaceholder(bare)).toBe(`# Role\nDo things.\n\n${SKILLS_PLACEHOLDER}\n`);
    expect(insertSchedulesPlaceholder(bare)).toBe(
      `# Role\nDo things.\n\n${SCHEDULES_PLACEHOLDER}\n`,
    );
  });
});

describe("listScheduleNames", () => {
  it("returns [] when the schedule directory does not exist", async () => {
    await agentState();
    expect(await listScheduleNames(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).toEqual([]);
  });

  it("lists .toml basenames sorted, ignoring other files and directories", async () => {
    await agentState();
    const dir = scheduleDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "weekly.toml"), "", "utf8");
    await fs.writeFile(path.join(dir, "daily.toml"), "", "utf8");
    await fs.writeFile(path.join(dir, "notes.txt"), "", "utf8");
    await fs.mkdir(path.join(dir, "sub.toml")); // a directory never counts as a task file
    expect(await listScheduleNames(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).toEqual([
      "daily",
      "weekly",
    ]);
  });
});

describe("Session prompt integration", () => {
  it("reaches the Session prompt with the current task roster", async () => {
    const agent = await createAgent({ root });
    const dir = scheduleDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "daily-report.toml"), 'prompt = "p"\n', "utf8");
    const session = await agent.createSession();
    try {
      const meta = session.metaMessage.payload as { system_prompt: string };
      expect(meta.system_prompt).toContain("# Scheduled Tasks");
      expect(meta.system_prompt).toContain("Current tasks:\n- daily-report");
      // The section names the directory as the literal pattern the model resolves itself.
      expect(meta.system_prompt).toContain(
        "`<app_data_dir>/agents/<agent_id>/agent_state/schedule/`",
      );
    } finally {
      session.dispose();
    }
  });

  it("is left out of the Session prompt when the Agent config disables the section", async () => {
    const agent = await createAgent({ root });
    // On disk: a Session's context is assembled from the Agent State as it is on disk, never
    // from the Agent object's load-time snapshot.
    const configFile = systemConfigPath(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    const cfg = parseYaml(await fs.readFile(configFile, "utf8")) as SystemConfig;
    cfg.schedules = { enabled: false };
    await fs.writeFile(configFile, stringifyYaml(cfg), "utf8");
    const session = await agent.createSession();
    try {
      const meta = session.metaMessage.payload as { system_prompt: string };
      expect(meta.system_prompt).not.toContain("# Scheduled Tasks");
    } finally {
      session.dispose();
    }
  });
});
