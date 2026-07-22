/**
 * Agent.createSession's Workspace handling and vault injection (no network needed; only
 * constructs the Session, never sends a request).
 *
 * Regression: an explicitly given Workspace must be an existing directory. When it
 * does not exist, a clear error must be thrown rather than auto-creating it, and bash must not
 * be started with an invalid cwd after Session creation, which would throw a misleading
 * `spawn bash ENOENT`. A temp directory is only created when no Workspace is specified.
 *
 * vault: the Agent vault's (agent_state/.vault.toml) **key names** are
 * injected into the assembled system prompt; values are never injected.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addModel,
  createAgent,
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  installSkill,
  setVaultEntry,
} from "../src/index.js";
import { effectiveMaxContextLength, metaMaxTokens } from "../src/agent.js";
import { mapThinkingLevel } from "../src/llm/index.js";
import { stubProviderKeys } from "./provider-keys.js";
import type { EnvironmentConfig, EnvironmentServices, SubagentRunner } from "../src/interfaces.js";

// Captures the services buildRuntime hands to each Environment, so tests can drive the REAL
// subagent runner (the spawn closure in agent.ts). Spawning only constructs the child Session,
// and pulling a single message from handle.run yields the child session_meta before any LLM
// request is issued — no network is ever touched. The wrapper is otherwise transparent, so
// every other test in this file behaves as with the real class.
const capturedEnvServices = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../src/environment/index.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/environment/index.js")>();
  class CapturingEnvironment extends mod.Environment {
    constructor(config: EnvironmentConfig) {
      super(config);
      capturedEnvServices.list.push(config.services);
    }
  }
  return { ...mod, Environment: CapturingEnvironment };
});

let tmpRoot: string;
let prevHome: string | undefined;
let restoreKeys: () => void;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-harness-"));
  process.env.PENGUIN_HOME = tmpRoot;
  restoreKeys = stubProviderKeys();
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  restoreKeys();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("effectiveMaxContextLength (compaction threshold clamped to the model window)", () => {
  it("clamps to 75% of a small model window; leaves big/unknown windows and off untouched", () => {
    expect(effectiveMaxContextLength(128000, 32768)).toBe(24576); // small window: clamp to 75%
    expect(effectiveMaxContextLength(128000, 200000)).toBe(128000); // ample window: unchanged
    expect(effectiveMaxContextLength(-1, 32768)).toBe(-1); // off: no clamping
    expect(effectiveMaxContextLength(0, 32768)).toBe(0); // off: no clamping
    expect(effectiveMaxContextLength(128000, "unknown")).toBe(128000); // unknown window: no clamping
  });
});

describe("metaMaxTokens (meta-request budget tightened by the per-model cap)", () => {
  it("keeps the budget unless the per-model cap is smaller; never raises it", () => {
    expect(metaMaxTokens(300, undefined)).toBe(300); // no per-model cap: the budget as-is
    expect(metaMaxTokens(300, 8000)).toBe(300); // ample cap: the small budget stays
    expect(metaMaxTokens(300, 128)).toBe(128); // pinned below the budget: the cap binds
    expect(metaMaxTokens(2048, 1024)).toBe(1024); // vision-describer budget, same rule
  });
});

describe("Agent.createSession workspace handling", () => {
  it("throws a clear error when the given workspace does not exist (no auto-create)", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "nested", "does-not-exist");
    await expect(agent.createSession({ workspaceDir: ws })).rejects.toThrow(/does not exist/);
    // Must not be auto-created.
    await expect(fs.stat(ws)).rejects.toThrow();
  });

  it("throws when the given workspace path is not a directory", async () => {
    const agent = await createAgent();
    const filePath = path.join(tmpRoot, "a-file");
    await fs.writeFile(filePath, "x", "utf8");
    await expect(agent.createSession({ workspaceDir: filePath })).rejects.toThrow(
      /is not a directory/,
    );
  });

  it("accepts an existing directory and resolves it to an absolute path", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    expect(session.workspaceDir).toBe(ws);
    expect(path.isAbsolute(session.workspaceDir)).toBe(true);
  });

  it("rejects a model reference that is not in the Project config with a clear error", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-bad-model");
    await fs.mkdir(ws, { recursive: true });
    // A reference outside the config is not silently allowed (the unique key is provider +
    // model_id); the error is thrown before creating the temp Workspace.
    await expect(
      agent.createSession({
        workspaceDir: ws,
        modelId: "not-configured-model",
        provider: "custom",
      }),
    ).rejects.toThrow(/is not in the Project config/);
    await expect(
      agent.createSession({ workspaceDir: ws, modelId: "deepseek-v4-pro", provider: "openai" }),
    ).rejects.toThrow(/\(provider=openai, model_id=deepseek-v4-pro\)/);
  });

  it("passes model timeout from system_config to GenerativeModel", async () => {
    const agent = await createAgent();
    agent.state.systemConfig.model = {
      ...(agent.state.systemConfig.model ?? {}),
      timeoutMs: 3456,
    };
    const ws = path.join(tmpRoot, "ws-timeout");
    await fs.mkdir(ws, { recursive: true });

    const session = await agent.createSession({ workspaceDir: ws });
    const llm = (session as unknown as { engine: { deps: { llm: unknown } } }).engine.deps.llm;

    expect((llm as { requestTimeoutMs?: number }).requestTimeoutMs).toBe(3456);
  });
});

describe("Agent.createSession model reference ((provider, model_id) pair)", () => {
  it("records the pair reference in session_meta (default_model when unspecified)", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-ref-default");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    try {
      // Defaults to the default_model reference; session_meta carries the pair reference
      // (same source that Trace writes).
      const meta = session.metaMessage.payload as { provider: string; model_id: string };
      expect(meta.provider).toBe("deepseek");
      expect(meta.model_id).toBe("deepseek-v4-pro");
      expect(session.provider).toBe("deepseek");
      expect(session.modelId).toBe("deepseek-v4-pro");
    } finally {
      session.dispose();
    }
  });

  it("selects the entry named by the pair, even when a second group sells the same model_id", async () => {
    // A user-run proxy resells claude-sonnet-4-6 under the same upstream id: the two entries
    // coexist and the pair — not the bare id — decides which one (and therefore which
    // credential and base_url) the Session runs on.
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "myproxy",
      model_id: "claude-sonnet-4-6",
    });
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-ref-pair");
    await fs.mkdir(ws, { recursive: true });
    const vendor = await agent.createSession({
      workspaceDir: ws,
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
    });
    try {
      expect(vendor.provider).toBe("anthropic");
      expect(vendor.modelId).toBe("claude-sonnet-4-6");
    } finally {
      vendor.dispose();
    }
    const proxied = await agent.createSession({
      workspaceDir: ws,
      modelId: "claude-sonnet-4-6",
      provider: "myproxy",
    });
    try {
      expect(proxied.provider).toBe("myproxy");
      expect(proxied.modelId).toBe("claude-sonnet-4-6");
    } finally {
      proxied.dispose();
    }
  });

  it("rejects half a reference: modelId without provider, and provider without modelId", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-ref-half");
    await fs.mkdir(ws, { recursive: true });
    // A bare model_id is never resolved against the config, not even when exactly one entry
    // carries it (deepseek-v4-flash is unique here): the group is the caller's to name.
    await expect(
      agent.createSession({ workspaceDir: ws, modelId: "deepseek-v4-flash" }),
    ).rejects.toThrow(/must be given as a \(provider, model_id\) pair/);
    // The mirror case: provider alone is not a reference either.
    await expect(agent.createSession({ workspaceDir: ws, provider: "deepseek" })).rejects.toThrow(
      /must be given as a \(provider, model_id\) pair/,
    );
    // Neither half given is the documented "use the Project default" path, not an error.
    const session = await agent.createSession({ workspaceDir: ws });
    try {
      expect(session.provider).toBe("deepseek");
      expect(session.modelId).toBe("deepseek-v4-pro");
    } finally {
      session.dispose();
    }
  });
});

describe("Agent.createSession thinking level (explicit option wins over the Agent config)", () => {
  const uniThinkingOf = (llm: unknown): unknown =>
    ((llm as { uniConfig?: { thinking_level?: unknown } }).uniConfig ?? {}).thinking_level;
  const llmOf = (session: unknown): unknown =>
    (session as { engine: { deps: { llm: unknown } } }).engine.deps.llm;

  it("falls back to the Agent config for both the meta echo and the llm config", async () => {
    const agent = await createAgent();
    // The seeded Agent config pins thinking_level "medium" — the only source when no option is given.
    expect(agent.state.systemConfig.model?.thinking_level).toBe("medium");
    const ws = path.join(tmpRoot, "ws-thinking-default");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    try {
      expect((session.metaMessage.payload as { thinking_level: string }).thinking_level).toBe(
        "medium",
      );
      expect(uniThinkingOf(llmOf(session))).toBe(mapThinkingLevel("medium"));
    } finally {
      session.dispose();
    }
  });

  it("uses an explicit thinkingLevel over the Agent config (subagent inheritance rides on this)", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-thinking-explicit");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws, thinkingLevel: "high" });
    try {
      expect((session.metaMessage.payload as { thinking_level: string }).thinking_level).toBe(
        "high",
      );
      expect(uniThinkingOf(llmOf(session))).toBe(mapThinkingLevel("high"));
    } finally {
      session.dispose();
    }
  });
});

describe("run_subagent spawning follows the PARENT session (never the Project default)", () => {
  /** The subagent runner captured from the most recently constructed real Environment. */
  function lastSpawnedRunner(): SubagentRunner {
    const services = capturedEnvServices.list.at(-1) as EnvironmentServices | undefined;
    const runner = services?.subagentRunner;
    expect(runner).toBeDefined();
    return runner!;
  }

  /**
   * Spawns through the real runner and reads the child session_meta — the first message
   * handle.run yields, emitted before any LLM request; the run generator is closed right
   * after, so nothing is ever sent upstream.
   */
  async function spawnedChildMeta(
    runner: SubagentRunner,
    input: Parameters<SubagentRunner["spawn"]>[0],
  ): Promise<{ provider: string; model_id: string; thinking_level: string; workspace: string }> {
    const handle = await runner.spawn(input);
    try {
      const gen = handle.run({ prompt: "noop" });
      const first = await gen.next();
      expect(first.done).toBe(false);
      const msg = first.value!;
      expect(msg.type).toBe("session_meta");
      // Child messages are stamped with the child Session id as the origin hop.
      expect(msg.origin?.[0]).toBe(handle.sessionId);
      await gen.return(undefined);
      return msg.payload as {
        provider: string;
        model_id: string;
        thinking_level: string;
        workspace: string;
      };
    } finally {
      handle.dispose();
    }
  }

  it("inherits the parent's model pair, thinking level, and workspace when the args omit them", async () => {
    const agent = await createAgent();
    agent.state.systemConfig.model = {
      ...(agent.state.systemConfig.model ?? {}),
      thinking_level: "high",
    };
    const ws = path.join(tmpRoot, "ws-inherit");
    await fs.mkdir(ws, { recursive: true });
    // The parent runs a NON-default model: the Project default (deepseek pair) must not leak in.
    const parent = await agent.createSession({
      workspaceDir: ws,
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
    });
    const runner = lastSpawnedRunner();
    try {
      const child = await spawnedChildMeta(runner, {});
      expect(child.provider).toBe("anthropic");
      expect(child.model_id).toBe("claude-sonnet-4-6");
      expect(child.thinking_level).toBe("high");
      // Workspace inheritance (behavior that predates model/thinking inheritance): locked here.
      expect(child.workspace).toBe(ws);
    } finally {
      parent.dispose();
    }
  });

  it("still honors an explicit (provider, model_id) pair over inheritance", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-inherit-explicit");
    await fs.mkdir(ws, { recursive: true });
    const parent = await agent.createSession({
      workspaceDir: ws,
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
    });
    const runner = lastSpawnedRunner();
    try {
      const child = await spawnedChildMeta(runner, {
        modelId: "deepseek-v4-pro",
        provider: "deepseek",
      });
      expect(child.provider).toBe("deepseek");
      expect(child.model_id).toBe("deepseek-v4-pro");
      // Thinking level and workspace are inherited implicitly even with an explicit model.
      expect(child.thinking_level).toBe("medium");
      expect(child.workspace).toBe(ws);
    } finally {
      parent.dispose();
    }
  });

  it("makes a cross-agent child follow the parent session, not its own Agent config", async () => {
    // Seed the second Agent first (spawn verifies its system_config exists); its own seeded
    // config (thinking "medium") and the Project default model must both lose to the parent.
    await createAgent({ agentId: "helper_agent" });
    const agent = await createAgent();
    agent.state.systemConfig.model = {
      ...(agent.state.systemConfig.model ?? {}),
      thinking_level: "xhigh",
    };
    const ws = path.join(tmpRoot, "ws-inherit-cross");
    await fs.mkdir(ws, { recursive: true });
    const parent = await agent.createSession({
      workspaceDir: ws,
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
    });
    const runner = lastSpawnedRunner();
    try {
      const child = await spawnedChildMeta(runner, { agentId: "helper_agent" });
      expect(child.provider).toBe("anthropic");
      expect(child.model_id).toBe("claude-sonnet-4-6");
      expect(child.thinking_level).toBe("xhigh");
      expect(child.workspace).toBe(ws);
    } finally {
      parent.dispose();
    }
  });
});

describe("Agent.createSession max output tokens (per-model cap wins over the Agent config)", () => {
  // Reads a constructed GenerativeModel's request config (private; runtime-accessible for assertion).
  const uniConfigOf = (llm: unknown) =>
    (llm as { uniConfig?: { max_tokens?: number } }).uniConfig ?? {};

  it("uses the entry's max_tokens in llmConfig, and inherits the seeded 32000 when unset", async () => {
    // A 32k-context local model: the seeded per-Agent default (32000 output tokens) cannot fit
    // into its window together with any prompt — the pinned per-model cap must win.
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "local-32k",
      client_type: "openai",
      context_window: 32768,
      max_tokens: 8000,
    });
    const agent = await createAgent();
    expect(agent.state.systemConfig.model?.max_tokens).toBe(32000);
    const ws = path.join(tmpRoot, "ws-max-tokens");
    await fs.mkdir(ws, { recursive: true });

    const pinned = await agent.createSession({
      workspaceDir: ws,
      modelId: "local-32k",
      provider: "custom",
    });
    try {
      const llm = (pinned as unknown as { engine: { deps: { llm: unknown } } }).engine.deps.llm;
      expect(uniConfigOf(llm).max_tokens).toBe(8000);
    } finally {
      pinned.dispose();
    }

    // An unannotated entry (the default model) inherits the Agent value, as before.
    const inherited = await agent.createSession({ workspaceDir: ws });
    try {
      const llm = (inherited as unknown as { engine: { deps: { llm: unknown } } }).engine.deps.llm;
      expect(uniConfigOf(llm).max_tokens).toBe(32000);
    } finally {
      inherited.dispose();
    }
  });

  it("meta requests keep their small budget, tightened when the per-model cap is even smaller", async () => {
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "local-32k",
      client_type: "openai",
      max_tokens: 8000,
    });
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "tiny-cap",
      client_type: "openai",
      max_tokens: 128,
    });
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-meta-cap");
    await fs.mkdir(ws, { recursive: true });

    // Ample per-model cap: the title one-shot keeps its own 300 budget (never raised to the cap).
    const ample = await agent.createSession({
      workspaceDir: ws,
      modelId: "local-32k",
      provider: "custom",
    });
    try {
      const bare = (ample as unknown as { createBareLLM?: () => unknown }).createBareLLM?.();
      expect(uniConfigOf(bare).max_tokens).toBe(300);
    } finally {
      ample.dispose();
    }

    // Cap pinned below the budget: the meta request must respect it too.
    const tiny = await agent.createSession({
      workspaceDir: ws,
      modelId: "tiny-cap",
      provider: "custom",
    });
    try {
      const bare = (tiny as unknown as { createBareLLM?: () => unknown }).createBareLLM?.();
      expect(uniConfigOf(bare).max_tokens).toBe(128);
    } finally {
      tiny.dispose();
    }
  });
});

describe("Agent.createSession vault injection", () => {
  it("injects vault key names (never values) into the assembled system prompt", async () => {
    // Write the Agent vault to disk first; createSession reads that Agent's own .vault.toml.
    await setVaultEntry(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      "VAULT_ONLY_KEY",
      "vault-secret-value",
    );
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-vault");
    await fs.mkdir(ws, { recursive: true });

    const session = await agent.createSession({ workspaceDir: ws });
    try {
      const meta = session.metaMessage.payload as { system_prompt: string };
      // The "# Vault" statement is part of the template body; key names are injected at the
      // placeholder as a `- KEY` list.
      expect(meta.system_prompt).toContain("# Vault");
      expect(meta.system_prompt).toContain("- VAULT_ONLY_KEY");
      // Values never enter the model context.
      expect(meta.system_prompt).not.toContain("vault-secret-value");
    } finally {
      session.dispose();
    }
  });

  it("keeps the vault statement but lists no keys when the Agent has no vault", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-no-vault");
    await fs.mkdir(ws, { recursive: true });

    const session = await agent.createSession({ workspaceDir: ws });
    try {
      const meta = session.metaMessage.payload as { system_prompt: string };
      // No vault: the "# Vault" section statement is kept, and the
      // placeholder is replaced with an empty string, leaving no residue.
      expect(meta.system_prompt).toContain("# Vault");
      expect(meta.system_prompt).not.toContain("{{VAULT_KEYS}}");
      expect(meta.system_prompt).not.toContain("VAULT_ONLY_KEY");
    } finally {
      session.dispose();
    }
  });
});

describe("Agent.createSession skill metadata injection", () => {
  it("injects installed skill metadata lines (never bodies) into the assembled system prompt", async () => {
    await installSkill(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, {
      name: "demo-skill",
      content:
        "---\nname: demo-skill\ndescription: Demo skill for tests.\nversion: 1\nupdated: 2026-07-16\n---\n\nSKILL_BODY_NOT_IN_PROMPT\n",
    });
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-skills");
    await fs.mkdir(ws, { recursive: true });

    const session = await agent.createSession({ workspaceDir: ws });
    try {
      const meta = session.metaMessage.payload as { system_prompt: string };
      expect(meta.system_prompt).toContain("# Skills");
      expect(meta.system_prompt).toContain("- `demo-skill` — Demo skill for tests.");
      // Only metadata is injected; the model reads the body on demand.
      expect(meta.system_prompt).not.toContain("SKILL_BODY_NOT_IN_PROMPT");
      expect(meta.system_prompt).not.toContain("{{SKILL_METADATA}}");
    } finally {
      session.dispose();
    }
  });
});
