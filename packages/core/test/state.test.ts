import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_ID_PLACEHOLDER,
  AGENTS_MD_PLACEHOLDER,
  VAULT_KEYS_PLACEHOLDER,
  SKILL_METADATA_PLACEHOLDER,
  CWD_PLACEHOLDER,
  DATE_PLACEHOLDER,
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  MODEL_CATALOG,
  OS_VERSION_PLACEHOLDER,
  PLATFORM_PLACEHOLDER,
  PROJECT_DIR_PLACEHOLDER,
  SESSION_ID_PLACEHOLDER,
  addModel,
  setVisionModel,
  agentsMdPath,
  agentStateDir,
  agentVaultPath,
  loadAgentVault,
  assembleSystemPrompt,
  buildToolConfig,
  selectBuiltinToolsForModel,
  defaultProjectConfig,
  getModel,
  isValidVaultKey,
  loadOrInitAgentState,
  loadProjectConfig,
  memoryDir,
  scratchpadDir,
  projectConfigPath,
  removeVaultEntry,
  resolveModelRef,
  resolveRoot,
  setDefaultModel,
  setVaultEntry,
  skillsDir,
  systemConfigPath,
  toolsDir,
  type ModelRef,
  type ProjectConfig,
} from "../src/state/index.js";
import { sessionEnvironment } from "../src/internal/session-support.js";

let tmpRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-state-"));
  process.env.PENGUIN_HOME = tmpRoot;
});

afterEach(async () => {
  if (prevHome === undefined) {
    delete process.env.PENGUIN_HOME;
  } else {
    process.env.PENGUIN_HOME = prevHome;
  }
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("paths / resolveRoot", () => {
  it("honors PENGUIN_HOME", () => {
    expect(resolveRoot()).toBe(tmpRoot);
  });
});

describe("loadOrInitAgentState", () => {
  it("initializes an empty agent directory with the full state layout", async () => {
    const state = await loadOrInitAgentState();
    expect(state.root).toBe(tmpRoot);
    expect(state.projectId).toBe(DEFAULT_PROJECT_ID);
    expect(state.agentId).toBe(DEFAULT_AGENT_ID);

    const root = tmpRoot;
    expect(await exists(systemConfigPath(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toBe(true);
    expect(await exists(agentsMdPath(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toBe(true);
    expect(await exists(toolsDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toBe(true);
    expect(await exists(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toBe(true);
    expect(await exists(skillsDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toBe(true);
    // The scratchpad/ directory alongside agent_state (model temp files get a subdirectory per Session id).
    expect(await exists(scratchpadDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toBe(true);

    expect(state.stateDir).toBe(agentStateDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID));

    // The default system Prompt states the Agent's identity, without repeating tool details
    // already in the tool schema (Suggested workflows only points to the run_subagent
    // delegation entry point).
    expect(state.systemConfig.system_prompt).toContain("PenguinHarness");
    expect(state.systemConfig.system_prompt).not.toContain("exec_command");
    // Suggested workflows absorbs Subagent delegation and task conventions (self-reported
    // identity as a soft convention, parallelism, file exchange).
    expect(state.systemConfig.system_prompt).toContain("# Suggested workflows");
    expect(state.systemConfig.system_prompt).toContain("run_subagent");
    expect(state.systemConfig.system_prompt).toContain("Caller agent");
    // The default AGENTS.md is empty: it carries no preset guidance.
    expect(state.agentsMd).toBe("");
    expect(state.systemConfig.system_prompt).toContain(AGENTS_MD_PLACEHOLDER);
    expect(state.systemConfig.system_prompt).toContain(SESSION_ID_PLACEHOLDER);
    expect(state.systemConfig.system_prompt).toContain(CWD_PLACEHOLDER);
    expect(state.systemConfig.system_prompt).toContain(PLATFORM_PLACEHOLDER);
    expect(state.systemConfig.system_prompt).toContain(OS_VERSION_PLACEHOLDER);
    expect(state.systemConfig.system_prompt).toContain(DATE_PLACEHOLDER);
    // AGENTS.md and the Environment injection sit at the end of the template, with AGENTS.md
    // before Environment; the <developer_instructions> wrapper text is written directly into
    // the template (the Prompt is transparent about the config).
    expect(state.systemConfig.system_prompt).toContain("<developer_instructions>");
    expect(state.systemConfig.system_prompt).toContain("</developer_instructions>");
    // The default template explains the semantics of system-synthesized markers to the model,
    // and recommends preferring tool use.
    expect(state.systemConfig.system_prompt).toContain("<turn_aborted>");
    expect(state.systemConfig.system_prompt).toContain("<turn_retried>");
    expect(state.systemConfig.system_prompt).toContain("<context_summary>");
    expect(state.systemConfig.system_prompt).toContain("# Tool use");
    // Privacy hardening: explicitly forbids reading .project_config.toml (the sole config file,
    // which holds API keys) and each Agent's .vault.toml, and states that config can only be
    // changed via the CLI (penguin config ...).
    expect(state.systemConfig.system_prompt).toContain("Never read");
    expect(state.systemConfig.system_prompt).toContain(".project_config.toml");
    expect(state.systemConfig.system_prompt).toContain("agent_state/.vault.toml");
    expect(state.systemConfig.system_prompt).toContain("CLI-only");
    expect(state.systemConfig.system_prompt).toContain("penguin config");
    expect(state.systemConfig.system_prompt).not.toContain(".credentials.toml");
    expect(state.systemConfig.system_prompt.indexOf(AGENTS_MD_PLACEHOLDER)).toBeLessThan(
      state.systemConfig.system_prompt.indexOf("# Environment"),
    );
    // The # Vault and # Skills body sections plus their placeholders: the default template
    // places them after </developer_instructions> and before # Environment, in the order
    // Vault -> Skills (the statement text is part of the template body, kept even with no
    // keys/skills).
    const tpl = state.systemConfig.system_prompt;
    expect(tpl).toContain("# Vault");
    expect(tpl).toContain(VAULT_KEYS_PLACEHOLDER);
    expect(tpl).toContain("# Skills");
    expect(tpl).toContain(SKILL_METADATA_PLACEHOLDER);
    expect(tpl).toContain("<use_skills>");
    expect(tpl.indexOf("</developer_instructions>")).toBeLessThan(tpl.indexOf("# Vault"));
    expect(tpl.indexOf("# Vault")).toBeLessThan(tpl.indexOf(VAULT_KEYS_PLACEHOLDER));
    expect(tpl.indexOf(VAULT_KEYS_PLACEHOLDER)).toBeLessThan(tpl.indexOf("# Skills"));
    expect(tpl.indexOf("# Skills")).toBeLessThan(tpl.indexOf(SKILL_METADATA_PLACEHOLDER));
    expect(tpl.indexOf(SKILL_METADATA_PLACEHOLDER)).toBeLessThan(tpl.indexOf("# Environment"));
    expect(state.systemConfig.model?.max_tokens).toBe(32000);
    expect(state.systemConfig.model?.thinking_level).toBe("medium");
    expect(state.systemConfig.model?.timeoutMs).toBe(120000);
    expect(state.systemConfig.tools?.mcpServers).toEqual([]);
    expect(Object.hasOwn(state.systemConfig, "description")).toBe(false);
    expect(Object.hasOwn(state.systemConfig, "subagents")).toBe(false);
  });

  it("loads an existing agent directory and returns the same system prompt", async () => {
    const first = await loadOrInitAgentState();
    const second = await loadOrInitAgentState();
    expect(second.systemConfig.system_prompt).toBe(first.systemConfig.system_prompt);
    expect(second.systemConfig.system_prompt).toContain("PenguinHarness");
    expect(second.agentsMd).toBe(first.agentsMd);
    // The tool config is fully preserved on the load path.
    expect(second.systemConfig.tools?.builtin?.[0]?.name).toBe("exec_command");
  });

  it("respects custom agentId / projectId", async () => {
    const state = await loadOrInitAgentState({ agentId: "agent_x", projectId: "proj_y" });
    expect(state.agentId).toBe("agent_x");
    expect(state.projectId).toBe("proj_y");
    expect(await exists(systemConfigPath(tmpRoot, "proj_y", "agent_x"))).toBe(true);
  });
});

describe("buildToolConfig", () => {
  it("exposes exec/input command, run/input subagent (rw) and read_image (r)", async () => {
    const state = await loadOrInitAgentState();
    const cfg = buildToolConfig(state);
    expect(cfg.mcpServers).toEqual([]);
    expect(cfg.customTools.map((t) => t.name)).toEqual([
      "exec_command",
      "input_command",
      "run_subagent",
      "input_subagent",
      "read_image",
      "describe_image",
    ]);
    const exec = cfg.customTools.find((t) => t.name === "exec_command")!;
    expect(exec.permission).toBe("rw");
    expect(exec.timeoutMs).toBe(120000);
    expect(exec.maxOutputLength).toBe(16000);
    expect((exec.parameters as { required?: string[] }).required).toEqual(["cmd"]);
    const write = cfg.customTools.find((t) => t.name === "input_command")!;
    expect(write.permission).toBe("rw");
    expect((write.parameters as { required?: string[] }).required).toEqual(["process_id"]);
    const sub = cfg.customTools.find((t) => t.name === "run_subagent")!;
    expect(sub.permission).toBe("rw");
    expect((sub.parameters as { required?: string[] }).required).toEqual(["prompt"]);
    const writeSub = cfg.customTools.find((t) => t.name === "input_subagent")!;
    expect(writeSub.permission).toBe("rw");
    expect((writeSub.parameters as { required?: string[] }).required).toEqual(["subagent_id"]);
    // Both image-reading tool entries are explicitly in the config, each declaring its
    // applicable model kind via the forModel annotation.
    const readImage = cfg.customTools.find((t) => t.name === "read_image")!;
    expect(readImage.forModel).toBe("vision");
    expect(readImage.permission).toBe("r");
    expect(Object.keys((readImage.parameters as { properties: object }).properties)).toEqual([
      "source",
    ]);
    const describeImage = cfg.customTools.find((t) => t.name === "describe_image")!;
    expect(describeImage.forModel).toBe("text-only");
    expect(describeImage.permission).toBe("r");
    expect(Object.keys((describeImage.parameters as { properties: object }).properties)).toEqual([
      "source",
      "prompt",
    ]);
    expect((describeImage.parameters as { required?: string[] }).required).toEqual(["source"]);
  });

  it("selectBuiltinToolsForModel picks the matching image tool per model kind", async () => {
    const state = await loadOrInitAgentState();
    const all = buildToolConfig(state).customTools;
    // Vision model: read_image is kept, describe_image is filtered out; unannotated tools are unaffected.
    const forVision = selectBuiltinToolsForModel(all, true);
    expect(forVision.some((t) => t.name === "read_image")).toBe(true);
    expect(forVision.some((t) => t.name === "describe_image")).toBe(false);
    expect(forVision.filter((t) => t.name === "exec_command")).toHaveLength(1);
    // Text-only model: describe_image is kept.
    const forText = selectBuiltinToolsForModel(all, false);
    expect(forText.some((t) => t.name === "read_image")).toBe(false);
    expect(forText.some((t) => t.name === "describe_image")).toBe(true);
    expect(forText.filter((t) => t.name === "exec_command")).toHaveLength(1);
  });

  it("loads MCP Server config from system_config.yaml", () => {
    const state = {
      root: tmpRoot,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      stateDir: agentStateDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      systemConfig: {
        system_prompt: "x",
        tools: {
          builtin: [],
          mcpServers: [{ name: "fs", config: { command: "mcp-fs" } }],
        },
      },
      agentsMd: "y",
    };

    const cfg = buildToolConfig(state);
    expect(cfg.customTools).toEqual([]);
    expect(cfg.mcpServers).toEqual([{ name: "fs", config: { command: "mcp-fs" } }]);
  });

  it("falls back to default builtin tools when config omits them", () => {
    const state = {
      root: tmpRoot,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      stateDir: agentStateDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      systemConfig: { system_prompt: "x" },
      agentsMd: "y",
    };
    const cfg = buildToolConfig(state);
    expect(cfg.customTools.map((t) => t.name)).toEqual([
      "exec_command",
      "input_command",
      "run_subagent",
      "input_subagent",
      "read_image",
      "describe_image",
    ]);
  });
});

describe("assembleSystemPrompt", () => {
  it("renders default system prompt placeholders", async () => {
    const state = await loadOrInitAgentState();
    const prompt = assembleSystemPrompt(
      state,
      sessionEnvironment("/tmp/penguin-ws", "session-test-1", {
        agentId: DEFAULT_AGENT_ID,
        projectDir: "/tmp/proj",
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
      }),
    );
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain("PenguinHarness");
    // File system's two file-delivery conventions: a workspace file is mentioned in the reply
    // by its **workspace-relative path** in backticks (the frontend renders a message file card
    // from this); scratchpad only holds intermediate artifacts, and final deliverables must
    // land in the Workspace.
    expect(prompt).toContain("mention its workspace-relative path in backticks");
    expect(prompt).toContain("always place final deliverables in the workspace");
    // The default template wraps AGENTS.md in a <developer_instructions> XML block.
    expect(prompt).toContain("<developer_instructions>");
    expect(prompt).toContain("</developer_instructions>");
    expect(prompt.indexOf("<developer_instructions>")).toBeLessThan(
      prompt.indexOf("# Environment"),
    );
    expect(prompt).not.toContain(AGENTS_MD_PLACEHOLDER);
    expect(prompt).not.toContain(SESSION_ID_PLACEHOLDER);
    expect(prompt).not.toContain(CWD_PLACEHOLDER);
    expect(prompt).not.toContain(PLATFORM_PLACEHOLDER);
    expect(prompt).not.toContain(OS_VERSION_PLACEHOLDER);
    expect(prompt).not.toContain(DATE_PLACEHOLDER);
  });

  it("replaces AGENTS.md and specific Session environment fields at template locations", () => {
    const state = {
      root: tmpRoot,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      stateDir: agentStateDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      systemConfig: {
        system_prompt: [
          "before",
          `sid=${SESSION_ID_PLACEHOLDER}`,
          `cwd=${CWD_PLACEHOLDER}`,
          `aid=${AGENT_ID_PLACEHOLDER}`,
          `pdir=${PROJECT_DIR_PLACEHOLDER}`,
          `platform=${PLATFORM_PLACEHOLDER}`,
          `os=${OS_VERSION_PLACEHOLDER}`,
          `date=${DATE_PLACEHOLDER}`,
          "middle",
          AGENTS_MD_PLACEHOLDER,
          "after",
        ].join("\n"),
      },
      agentsMd: "# Agent Rules\nFollow local rules.",
    };

    const prompt = assembleSystemPrompt(state, {
      sessionId: "session-1",
      cwd: "/tmp/ws",
      agentId: "agent-x",
      projectDir: "/tmp/proj",
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      platform: "darwin",
      osVersion: "Darwin 25.0.0",
      date: "2026-06-30",
    });
    expect(prompt).toBe(
      [
        "before",
        "sid=session-1",
        "cwd=/tmp/ws",
        "aid=agent-x",
        "pdir=/tmp/proj",
        "platform=darwin",
        "os=Darwin 25.0.0",
        "date=2026-06-30",
        "middle",
        "# Agent Rules\nFollow local rules.",
        "after",
      ].join("\n"),
    );
  });

  it("replaces the placeholder with an empty string when AGENTS.md is blank", () => {
    const state = {
      root: tmpRoot,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      stateDir: agentStateDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      systemConfig: {
        system_prompt: ["before", AGENTS_MD_PLACEHOLDER, "after"].join("\n"),
      },
      agentsMd: "  \n",
    };

    const prompt = assembleSystemPrompt(state);
    expect(prompt).toBe("before\n\nafter");
  });

  it("does not append AGENTS.md or Session environment without placeholders", () => {
    const state = {
      root: tmpRoot,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      stateDir: agentStateDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      systemConfig: { system_prompt: "base prompt" },
      agentsMd: "# Agent Rules\nShould not appear.",
    };

    const prompt = assembleSystemPrompt(state, {
      sessionId: "session-1",
      cwd: "/tmp/ws",
      agentId: "agent-x",
      projectDir: "/tmp/proj",
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      platform: "darwin",
      osVersion: "Darwin 25.0.0",
      date: "2026-06-30",
    });
    expect(prompt).toBe("base prompt");
  });

  it("renders vault key names (never values) via the {{VAULT_KEYS}} placeholder", () => {
    const state = {
      root: tmpRoot,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      stateDir: agentStateDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      systemConfig: {
        system_prompt: ["before", AGENTS_MD_PLACEHOLDER, VAULT_KEYS_PLACEHOLDER, "after"].join(
          "\n",
        ),
      },
      agentsMd: "# Agent Rules",
    };

    const prompt = assembleSystemPrompt(state, undefined, ["KEY_A", "KEY_B"]);
    // The placeholder is replaced with a list of key names (one `- KEY` per line); the vault's
    // purpose statement is part of the template body, not carried by the replacement value.
    expect(prompt).toBe(["before", "# Agent Rules", "- KEY_A", "- KEY_B", "after"].join("\n"));
  });

  it("replaces {{VAULT_KEYS}} with an empty string when there are no keys", () => {
    const state = {
      root: tmpRoot,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      stateDir: agentStateDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      systemConfig: {
        system_prompt: ["before", AGENTS_MD_PLACEHOLDER, VAULT_KEYS_PLACEHOLDER, "after"].join(
          "\n",
        ),
      },
      agentsMd: "# Agent Rules",
    };
    // No keys: the placeholder is replaced with an empty string (the template body's vault
    // statement is kept, though this test's template does not include one); the placeholder
    // leaves no residue.
    const empty = assembleSystemPrompt(state, undefined, []);
    expect(empty).toBe(["before", "# Agent Rules", "", "after"].join("\n"));
    expect(assembleSystemPrompt(state)).not.toContain(VAULT_KEYS_PLACEHOLDER);
  });

  it("does not auto-inject other Agent State files", async () => {
    const state = await loadOrInitAgentState();
    await fs.writeFile(
      path.join(memoryDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), "note.md"),
      "MEMORY_SHOULD_NOT_BE_IN_PROMPT",
      "utf8",
    );
    await fs.writeFile(
      path.join(skillsDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), "SKILL.md"),
      "SKILL_SHOULD_NOT_BE_IN_PROMPT",
      "utf8",
    );

    const reloaded = await loadOrInitAgentState();
    const prompt = assembleSystemPrompt(reloaded);

    expect(prompt).not.toContain("MEMORY_SHOULD_NOT_BE_IN_PROMPT");
    expect(prompt).not.toContain("SKILL_SHOULD_NOT_BE_IN_PROMPT");
  });

  it("replaces generated Session environment field placeholders when provided", async () => {
    const state = await loadOrInitAgentState();
    const env = sessionEnvironment(
      "/tmp/penguin-ws",
      "session-test-1",
      { agentId: "agent-x", projectDir: "/tmp/proj", provider: "openai", modelId: "gpt-5.5" },
      new Date("2026-06-30T00:00:00"),
    );
    const prompt = assembleSystemPrompt(state, env);

    expect(prompt).toContain("# Environment");
    expect(prompt).toContain("Session ID: session-test-1");
    expect(prompt).toContain("CWD: /tmp/penguin-ws");
    expect(prompt).toContain("Agent ID: agent-x");
    expect(prompt).toContain("Project Dir: /tmp/proj");
    expect(prompt).toContain("Provider: openai");
    expect(prompt).toContain("Model ID: gpt-5.5");
    expect(prompt).toContain("Platform:");
    expect(prompt).toContain("OS Version:");
    expect(prompt).toContain("Date: 2026-06-30");
    expect(prompt.indexOf("Platform:")).toBeLessThan(prompt.indexOf("OS Version:"));
    expect(prompt.indexOf("OS Version:")).toBeLessThan(prompt.indexOf("Date:"));
    expect(prompt.indexOf("Date:")).toBeLessThan(prompt.indexOf("Project Dir:"));
    expect(prompt.indexOf("Project Dir:")).toBeLessThan(prompt.indexOf("Agent ID:"));
    expect(prompt.indexOf("Agent ID:")).toBeLessThan(prompt.indexOf("CWD:"));
    expect(prompt.indexOf("CWD:")).toBeLessThan(prompt.indexOf("Provider:"));
    expect(prompt.indexOf("Provider:")).toBeLessThan(prompt.indexOf("Model ID:"));
    expect(prompt.indexOf("Model ID:")).toBeLessThan(prompt.indexOf("Session ID:"));
  });
});

describe("project-config round trip", () => {
  it("returns default config when file is absent (without writing)", async () => {
    const cfg = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    expect(cfg).toEqual(defaultProjectConfig());
    // loadProjectConfig must not write to disk.
    expect(await exists(projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID))).toBe(false);
  });

  it("persists addModel with inline credential and default, then reads back", async () => {
    const saved = await addModel(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      {
        provider: "custom",
        model_id: "gpt-test",
        context_window: 128000,
        max_tokens: 8192,
        api_key: "sk-abc",
        base_url: "https://example.com/v1",
      },
      { setDefault: true },
    );
    // default_model is a pair reference (no string concatenation involved).
    expect(saved.default_model).toEqual({ provider: "custom", model_id: "gpt-test" });

    const loaded = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    expect(loaded.default_model).toEqual({ provider: "custom", model_id: "gpt-test" });

    // The credential is inlined in the entry; the two independent fields provider and
    // model_id together form the unique key.
    const entry = getModel(loaded, { provider: "custom", model_id: "gpt-test" });
    expect(entry).toEqual({
      provider: "custom",
      model_id: "gpt-test",
      context_window: 128000,
      max_tokens: 8192,
      api_key: "sk-abc",
      base_url: "https://example.com/v1",
    });

    // getModel matches the exact pair: a different provider means no match.
    expect(getModel(loaded, { provider: "openai", model_id: "gpt-test" })).toBeUndefined();
    expect(getModel(loaded, { provider: "custom", model_id: "unknown-model" })).toBeUndefined();
  });

  it("addModel files the entry under the provider it was given, never one of its own choosing", async () => {
    // provider is a required field: nothing is inferred from the builtin catalog, so a model
    // outside the known groups is filed under custom only because the caller said so. glm-5.2
    // is sold by both the Qwen Token Plan gateway and Zhipu — the caller names which one, and
    // the entry (with its api_key) lands in exactly that group.
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "anthropic",
      model_id: "claude-sonnet-4-6",
    });
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, { provider: "custom", model_id: "my-own-model" });
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "zhipu",
      model_id: "glm-5.2",
      api_key: "sk-zhipu",
    });
    const loaded = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    expect(
      getModel(loaded, { provider: "anthropic", model_id: "claude-sonnet-4-6" }),
    ).toBeDefined();
    expect(getModel(loaded, { provider: "custom", model_id: "my-own-model" })).toBeDefined();
    expect(getModel(loaded, { provider: "zhipu", model_id: "glm-5.2" })?.api_key).toBe("sk-zhipu");
    // The key never leaks into the other group that resells the same bare id.
    expect(
      getModel(loaded, { provider: "qwen-token-plan", model_id: "glm-5.2" })?.api_key,
    ).toBeUndefined();
  });

  it("addModel requires an explicit provider: a bare model_id does not type-check", () => {
    // Compile-time contract (asserted by `pnpm typecheck`, which includes this file): with the
    // catalog inference gone there is nothing to fall back to, so the entry's provider field is
    // required rather than optional. vitest only checks that the call expression exists.
    const bare = { model_id: "glm-5.2" };
    // @ts-expect-error provider is required: a model reference is always a (provider, model_id) pair.
    const call = (): Promise<ProjectConfig> => addModel(tmpRoot, DEFAULT_PROJECT_ID, bare);
    expect(call).toBeTypeOf("function");
  });

  it("upserts by the (provider, model_id) pair; same model_id under two providers co-exists", async () => {
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "pa",
      model_id: "m1",
      context_window: 1000,
    });
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "pa",
      model_id: "m1",
      context_window: 2000,
    });
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "pb",
      model_id: "m1",
      context_window: 3000,
    });
    const loaded = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    const matches = loaded.models.filter((m) => m.model_id === "m1");
    expect(matches).toHaveLength(2);
    expect(getModel(loaded, { provider: "pa", model_id: "m1" })?.context_window).toBe(2000);
    expect(getModel(loaded, { provider: "pb", model_id: "m1" })?.context_window).toBe(3000);
  });

  it("addModel persists vision flag and upsert preserves it when not re-specified", async () => {
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "ds",
      vision: false,
    });
    // Only supplements context_window, without vision: the original annotation is kept.
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "ds",
      context_window: 64000,
    });
    const dsRef = { provider: "custom", model_id: "ds" };
    let m = getModel(await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID), dsRef);
    expect(m?.vision).toBe(false);
    expect(m?.context_window).toBe(64000);
    // Explicitly switches it back to supported.
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "ds",
      vision: true,
    });
    m = getModel(await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID), dsRef);
    expect(m?.vision).toBe(true);
  });

  it("addModel persists max_tokens and upsert preserves it when not re-specified", async () => {
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "small-window",
      max_tokens: 4096,
    });
    // Only supplements context_window, without max_tokens: the original annotation is kept.
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "small-window",
      context_window: 32768,
    });
    const ref = { provider: "custom", model_id: "small-window" };
    let m = getModel(await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID), ref);
    expect(m?.max_tokens).toBe(4096);
    expect(m?.context_window).toBe(32768);
    // Explicitly re-pins the cap.
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "small-window",
      max_tokens: 2048,
    });
    m = getModel(await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID), ref);
    expect(m?.max_tokens).toBe(2048);
  });

  it("setVisionModel persists and validates the target", async () => {
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "vis",
      vision: true,
    });
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "blind",
      vision: false,
    });
    const visRef = { provider: "custom", model_id: "vis" };
    await setVisionModel(tmpRoot, DEFAULT_PROJECT_ID, visRef);
    const loaded = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    expect(loaded.vision_model).toEqual(visRef);
    // A subsequent addModel save/reload round trip does not lose vision_model (loadProjectConfig
    // passes it through explicitly).
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "vis",
      context_window: 1000,
    });
    expect((await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID)).vision_model).toEqual(visRef);
    // A target that does not exist or is annotated as not supporting images: throws
    // (the error includes the pair reference).
    await expect(
      setVisionModel(tmpRoot, DEFAULT_PROJECT_ID, { provider: "custom", model_id: "nope" }),
    ).rejects.toThrow(/model_id=nope/);
    await expect(
      setVisionModel(tmpRoot, DEFAULT_PROJECT_ID, { provider: "custom", model_id: "blind" }),
    ).rejects.toThrow(/not supporting images/);
  });

  it("upsert preserves existing context_window and inline credential when not re-specified", async () => {
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "m1",
      context_window: 200000,
      base_url: "https://gw.example",
    });
    // Only supplements an api_key, without context_window/base_url.
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "m1",
      api_key: "sk-xyz",
    });
    const loaded = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    const m = getModel(loaded, { provider: "custom", model_id: "m1" });
    expect(m?.context_window).toBe(200000); // Not cleared
    expect(m?.api_key).toBe("sk-xyz");
    expect(m?.base_url).toBe("https://gw.example"); // The original base_url is kept
  });

  it("upsert preserves display_name / created_at written by the interface layer", async () => {
    // The interface layer (server) writes display_name / created_at onto an entry; the CLI-side
    // addModel must not clear them when supplementing other fields (with a single config file,
    // these fields now live in the same entry as the credential).
    const file = projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      [
        "[[models]]",
        'provider = "custom"',
        'model_id = "m-keep"',
        'display_name = "My Model"',
        'api_key = "sk-old"',
        'created_at = "2026-07-01T00:00:00Z"',
      ].join("\n"),
      "utf8",
    );
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "m-keep",
      api_key: "sk-new",
    });
    const m = getModel(await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID), {
      provider: "custom",
      model_id: "m-keep",
    });
    expect(m?.api_key).toBe("sk-new");
    expect(m?.display_name).toBe("My Model");
    expect(m?.created_at).toBe("2026-07-01T00:00:00Z");
  });

  it("default config carries the anthropic claude-sonnet-4-6 pricing (three buckets)", () => {
    const entry = getModel(defaultProjectConfig(), {
      provider: "anthropic",
      model_id: "claude-sonnet-4-6",
    });
    expect(entry?.context_window).toBe(1000000);
    expect(entry?.pricing).toEqual({
      unit: "usd_per_mtok",
      cache_read: 0.3,
      cache_write: 3.75,
      output: 15,
    });
    // A preset model that supports vision does not persist a vision field (default = supported).
    expect(entry?.vision).toBeUndefined();
  });

  it("default config presets the full model catalog (default = deepseek deepseek-v4-pro)", () => {
    const cfg = defaultProjectConfig();
    expect(cfg.default_model).toEqual({ provider: "deepseek", model_id: "deepseek-v4-pro" });
    // The catalog is presented in full: provider and model_id are separate columns, model_id
    // being the plain upstream id (vision is only persisted as false for models that don't
    // support images).
    expect(cfg.models.map((m) => [m.provider, m.model_id])).toEqual(
      MODEL_CATALOG.map((m) => [m.provider, m.modelId]),
    );
    for (const entry of cfg.models) {
      const cat = MODEL_CATALOG.find(
        (c) => c.provider === entry.provider && c.modelId === entry.model_id,
      )!;
      expect(entry.vision).toBe(cat.supportsVision ? undefined : false);
      // A catalog entry without a list price (the Token Plan preview model) presets no
      // pricing; every other catalog entry stores USD pricing.
      if (cat.pricing === undefined) expect(entry.pricing).toBeUndefined();
      else expect(entry.pricing?.unit).toBe("usd_per_mtok");
      // A model that auto-routes leaves client_type unset; a gateway model (OpenRouter)
      // explicitly sets it to openai.
      expect(entry.client_type).toBe(cat.clientType);
      // A gateway model has its base URL preset inline (no key included); other models have
      // no credential.
      expect(entry.base_url).toBe(cat.baseUrl);
      expect(entry.api_key).toBeUndefined();
    }
    expect(getModel(cfg, { provider: "openrouter", model_id: "xiaomi/mimo-v2.5" })?.base_url).toBe(
      "https://openrouter.ai/api/v1",
    );
    expect(
      getModel(cfg, { provider: "deepseek", model_id: "deepseek-v4-pro" })?.base_url,
    ).toBeUndefined();
  });

  it("persists pricing and field-merges buckets on upsert", async () => {
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "p1",
      pricing: { cache_read: 0.3, cache_write: 3.75, output: 15 },
    });
    // Only output is updated, the other two buckets are kept.
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "p1",
      pricing: { output: 20 },
    });
    const loaded = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    expect(getModel(loaded, { provider: "custom", model_id: "p1" })?.pricing).toEqual({
      unit: "usd_per_mtok",
      cache_read: 0.3,
      cache_write: 3.75,
      output: 20,
    });
  });

  it("setDefaultModel updates and persists a pair reference", async () => {
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "m2",
      context_window: 4096,
    });
    const m2Ref = { provider: "custom", model_id: "m2" };
    const updated = await setDefaultModel(tmpRoot, DEFAULT_PROJECT_ID, m2Ref);
    expect(updated.default_model).toEqual(m2Ref);
    const loaded = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    expect(loaded.default_model).toEqual(m2Ref);
    // A target not in models: throws (the same validation as setVisionModel, with the error
    // including the pair reference and a model-list hint), and the original default model is
    // unaffected. A mismatched provider likewise fails (exact pair match, no fuzzy resolution).
    await expect(
      setDefaultModel(tmpRoot, DEFAULT_PROJECT_ID, { provider: "custom", model_id: "nope" }),
    ).rejects.toThrow(/\(provider=custom, model_id=nope\).*model list/);
    await expect(
      setDefaultModel(tmpRoot, DEFAULT_PROJECT_ID, { provider: "openai", model_id: "m2" }),
    ).rejects.toThrow(/is not in models/);
    expect((await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID)).default_model).toEqual(m2Ref);
  });

  it("loadProjectConfig tolerates an empty config file (returns defaults, no throw)", async () => {
    const file = projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "", "utf8"); // Empty file -> parseToml may return null
    const loaded = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    expect(loaded.models).toEqual([]);
  });

  it("rejects old-format config files with a clear error (no migration)", async () => {
    const file = projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Old format 1: default_model is a concatenated storage id string.
    await fs.writeFile(file, 'default_model = "deepseek/deepseek-v4-pro"\n', "utf8");
    await expect(loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID)).rejects.toThrow(
      /legacy|paired reference/,
    );
    // Old format 2: a model entry missing provider (from the era of composite model_id +
    // request_model_id).
    await fs.writeFile(
      file,
      [
        "[[models]]",
        'model_id = "anthropic/claude-sonnet-4-6"',
        'request_model_id = "claude-sonnet-4-6"',
      ].join("\n"),
      "utf8",
    );
    await expect(loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID)).rejects.toThrow(
      /legacy|separate fields/,
    );
  });
});

describe("resolveModelRef (validates a (provider, model_id) pair against the config)", () => {
  const cfg: ProjectConfig = {
    models: [
      { provider: "deepseek", model_id: "deepseek-v4-pro" },
      { provider: "siliconflow", model_id: "shared-id" },
      { provider: "openrouter", model_id: "shared-id" },
    ],
  };

  it("returns the pair when it names a configured entry", () => {
    expect(resolveModelRef(cfg, "deepseek-v4-pro", "deepseek")).toEqual({
      provider: "deepseek",
      model_id: "deepseek-v4-pro",
    });
    // The same bare model_id under two groups is never ambiguous: each pair names its own entry.
    expect(resolveModelRef(cfg, "shared-id", "siliconflow")).toEqual({
      provider: "siliconflow",
      model_id: "shared-id",
    });
    expect(resolveModelRef(cfg, "shared-id", "openrouter")).toEqual({
      provider: "openrouter",
      model_id: "shared-id",
    });
  });

  it("throws when the pair is not configured; the error carries the pair reference", () => {
    // Wrong group for a configured model_id: no fallback to "the entry that happens to have
    // this id" — a pair the config doesn't have simply isn't a model.
    expect(() => resolveModelRef(cfg, "shared-id", "openai")).toThrow(
      /is not in the Project config.*\(provider=openai, model_id=shared-id\)/,
    );
    // Unknown model_id, and exact matching only (no fuzzy/prefix matching).
    expect(() => resolveModelRef(cfg, "no-such-model", "deepseek")).toThrow(
      /\(provider=deepseek, model_id=no-such-model\)/,
    );
    expect(() => resolveModelRef(cfg, "deepseek-v4", "deepseek")).toThrow(
      /is not in the Project config/,
    );
  });

  it("requires provider: a bare model_id does not type-check (no resolution path left)", () => {
    // The pair is enforced by the type checker — asserted by `pnpm typecheck`, which includes
    // this file; the unused-directive error is the failure mode if the parameter ever goes
    // optional again. vitest only checks that the call expression exists.
    // @ts-expect-error provider is required: a model reference is always a (provider, model_id) pair.
    const call = (): ModelRef => resolveModelRef(cfg, "deepseek-v4-pro");
    expect(call).toBeTypeOf("function");
  });
});

describe("single hidden config file (.project_config.toml, credentials inlined)", () => {
  it("addModel writes one hidden file with 0600 permission; api_key lives inline", async () => {
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "m-split",
      api_key: "sk-split-1",
    });
    const file = projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID);
    // The sole config file is hidden (not shown by ls by default) and has 0600 permission
    // (owner read/write only).
    expect(path.basename(file)).toBe(".project_config.toml");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(file, "utf8")).toContain("sk-split-1");
    // The old two-file layout is no longer produced.
    expect(await exists(path.join(tmpRoot, DEFAULT_PROJECT_ID, "project_config.toml"))).toBe(false);
    expect(await exists(path.join(tmpRoot, DEFAULT_PROJECT_ID, ".credentials.toml"))).toBe(false);
  });

  it("chmod converges an existing file back to 0600 on save", async () => {
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "m-perm",
      api_key: "sk-1",
    });
    const file = projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID);
    await fs.chmod(file, 0o644);
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "m-perm",
      api_key: "sk-2",
    });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it("writes provider and model_id as separate fields; refs are TOML inline tables", async () => {
    await addModel(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      { provider: "openrouter", model_id: "xiaomi/mimo-v2.5" },
      { setDefault: true },
    );
    await setVisionModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "anthropic",
      model_id: "claude-sonnet-4-6",
    });
    const raw = await fs.readFile(projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID), "utf8");
    // A reference pair is persisted as an inline table; entries have
    // provider / model_id as separate columns, with no concatenated storage id or
    // request_model_id appearing anywhere.
    expect(raw).toContain(
      'default_model = { provider = "openrouter", model_id = "xiaomi/mimo-v2.5" }',
    );
    expect(raw).toContain(
      'vision_model = { provider = "anthropic", model_id = "claude-sonnet-4-6" }',
    );
    expect(raw).toContain('provider = "openrouter"');
    expect(raw).toContain('model_id = "xiaomi/mimo-v2.5"');
    expect(raw).not.toContain("request_model_id");
    expect(raw).not.toContain('"openrouter/xiaomi/mimo-v2.5"');
  });
});

describe("agent vault (agent_state/.vault.toml)", () => {
  it("set/remove roundtrip persists to the agent's .vault.toml", async () => {
    await setVaultEntry(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "MY_API_KEY", "sk-secret-1");
    await setVaultEntry(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "OTHER_KEY", "v2");
    // A same-named key overwrites, producing no duplicate.
    await setVaultEntry(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "MY_API_KEY", "sk-secret-2");
    let vault = await loadAgentVault(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(vault).toEqual({ MY_API_KEY: "sk-secret-2", OTHER_KEY: "v2" });
    // Persisted in plaintext to this Agent's agent_state/.vault.toml (an accepted tradeoff:
    // masking happens at the interface layer) -- a hidden file (not shown by ls by default)
    // with 0600 permission (owner read/write only).
    const file = agentVaultPath(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(path.basename(file)).toBe(".vault.toml");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    const raw = await fs.readFile(file, "utf8");
    expect(raw).toContain("sk-secret-2");
    // The Project config no longer carries the vault.
    expect(JSON.stringify(await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID))).not.toContain(
      "sk-secret-2",
    );

    vault = await removeVaultEntry(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "MY_API_KEY");
    expect(vault).toEqual({ OTHER_KEY: "v2" });
    // Once emptied, the whole .vault.toml is removed; removing a non-existent key is
    // idempotent and does not throw.
    vault = await removeVaultEntry(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "OTHER_KEY");
    expect(vault).toEqual({});
    await expect(fs.access(file)).rejects.toThrow();
    vault = await removeVaultEntry(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "GHOST");
    expect(vault).toEqual({});
  });

  it("keeps vaults independent between agents", async () => {
    await setVaultEntry(tmpRoot, DEFAULT_PROJECT_ID, "agent-a", "KEY_A", "va");
    await setVaultEntry(tmpRoot, DEFAULT_PROJECT_ID, "agent-b", "KEY_B", "vb");
    expect(await loadAgentVault(tmpRoot, DEFAULT_PROJECT_ID, "agent-a")).toEqual({ KEY_A: "va" });
    expect(await loadAgentVault(tmpRoot, DEFAULT_PROJECT_ID, "agent-b")).toEqual({ KEY_B: "vb" });
  });

  it("rejects invalid keys and keeps shell-safe names only", async () => {
    const set = (key: string) =>
      setVaultEntry(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, key, "v");
    await expect(set("1BAD")).rejects.toThrow(/vault key/);
    await expect(set("BAD-DASH")).rejects.toThrow();
    await expect(set("BAD KEY")).rejects.toThrow();
    await expect(set("")).rejects.toThrow();
    // Starting with an underscore is valid (shell environment variable naming rule).
    await set("_OK_1");
    expect(isValidVaultKey("_OK_1")).toBe(true);
    expect(isValidVaultKey("9NOPE")).toBe(false);
    // A value that is too long (>8192) is rejected: since it gets injected into the child
    // process environment, an oversized value would make exec spawn fail (E2BIG).
    await expect(
      setVaultEntry(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "OK_BIG", "x".repeat(8193)),
    ).rejects.toThrow(/too long/);
  });

  it("ignores non-string values and invalid key names from a hand-edited TOML; missing file is an empty vault", async () => {
    const file = agentVaultPath(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Non-string values and invalid key names (starting with a dash / digit) are always
    // ignored -- the same rule as the write side (review gemini #1: if an invalid key were
    // loaded, it would get injected into the Prompt/env, and after a GET brought it out, a PUT
    // of the whole table back would 400, bricking the vault page).
    await fs.writeFile(file, 'GOOD = "ok"\nBAD = 123\n"BAD-DASH" = "x"\n"9NUM" = "y"\n', "utf8");
    expect(await loadAgentVault(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).toEqual({
      GOOD: "ok",
    });
    expect(await loadAgentVault(tmpRoot, DEFAULT_PROJECT_ID, "no-such-agent")).toEqual({});
  });
});

describe("defensive config parsing", () => {
  it("throws a clear error when system_config.yaml is empty or corrupt", async () => {
    // First initialize normally, then empty out system_config.yaml; reloading should throw a
    // clear error rather than producing an undefined-laden message.
    await loadOrInitAgentState();
    const cfgPath = systemConfigPath(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    await fs.writeFile(cfgPath, "", "utf8");
    await expect(loadOrInitAgentState()).rejects.toThrow(/system_prompt|Invalid|corrupted/);

    await fs.writeFile(cfgPath, "just a string, not a mapping", "utf8");
    await expect(loadOrInitAgentState()).rejects.toThrow(/system_prompt|Invalid|corrupted/);
  });
});
