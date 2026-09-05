/**
 * Agent.createSession's Workspace handling and vault injection (no network needed; only
 * constructs the Session, never sends a request).
 *
 * Regression: an explicitly given Workspace must be an existing directory. When it
 * does not exist, a clear error must be thrown rather than auto-creating it, and bash must not
 * be started with an invalid cwd after Session creation, which would throw a misleading
 * `spawn bash ENOENT`. A temporary workspace is only created when no Workspace is specified.
 *
 * vault: the Agent vault's (agent_state/.vault.toml) **key names** are
 * injected into the assembled system prompt; values are never injected.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type { OpenContextOptions, OpenedContext, SystemConfig } from "../src/index.js";
import { agentsMdPath, projectConfigPath, systemConfigPath } from "../src/state/paths.js";
import {
  addModel,
  createAgent,
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  installSkill,
  loadProjectConfig,
  saveProjectConfig,
  setVaultEntry,
  userText,
} from "../src/index.js";
import { metaMaxTokens } from "../src/agent.js";
import { mapThinkingLevel } from "../src/llm/index.js";
import { stubProviderKeys } from "./provider-keys.js";
import type {
  EnvironmentConfig,
  EnvironmentServices,
  SubagentRunner,
} from "../src/interfaces/index.js";

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

// Captures every GenerativeModelConfig buildRuntime constructs: the effective thinking level
// is no longer observable through session_meta (it holds invariants only) — assertions read
// the construction default from the captured config instead.
const capturedLLMConfigs = vi.hoisted(() => ({ list: [] as { thinkingLevel?: string }[] }));
vi.mock("../src/llm/index.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/llm/index.js")>();
  class CapturingGenerativeModel extends mod.GenerativeModel {
    constructor(config: ConstructorParameters<typeof mod.GenerativeModel>[0]) {
      super(config);
      capturedLLMConfigs.list.push(config as { thinkingLevel?: string });
    }
  }
  return { ...mod, GenerativeModel: CapturingGenerativeModel };
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

// effectiveMaxContextLength moved to llm/context-limits.ts; its derivation (window-derived
// compaction threshold, issue #218) is covered in test/context-limits.test.ts.

/**
 * Edits the default Agent's on-disk `system_config.yaml`: a Session runs on the Agent State as
 * it is on disk when each of its model contexts opens, never on the Agent object's load-time
 * snapshot — so a test that wants a config to take effect writes it here.
 */
async function patchSystemConfig(patch: (cfg: SystemConfig) => void): Promise<void> {
  const file = systemConfigPath(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
  const cfg = parseYaml(await fs.readFile(file, "utf8")) as SystemConfig;
  patch(cfg);
  await fs.writeFile(file, stringifyYaml(cfg), "utf8");
}

/** Drains the session's lazy first-run bootstrap so the engine (and its LLM) exists for inspection. */
async function bootstrapped(session: unknown): Promise<void> {
  const gen = (session as { ensureReady(): AsyncGenerator<unknown> }).ensureReady();
  for await (const _ of gen) {
    // drain: the bootstrap's own events aren't under test here
  }
}

describe("metaMaxTokens (meta-request budget tightened by the per-model cap)", () => {
  it("keeps the budget unless the per-model cap is smaller; never raises it", () => {
    expect(metaMaxTokens(300, undefined)).toBe(300); // no per-model cap: the budget as-is
    expect(metaMaxTokens(300, 8000)).toBe(300); // ample cap: the small budget stays
    expect(metaMaxTokens(300, 128)).toBe(128); // pinned below the budget: the cap binds
    expect(metaMaxTokens(2048, 1024)).toBe(1024); // vision-describer budget, same rule
    expect(metaMaxTokens(300, -1)).toBe(300); // -1 = uncapped: never tightens to -1 (issue #55 sibling)
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
    // model_id); the error is thrown before creating the temporary workspace.
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
    await patchSystemConfig((cfg) => {
      cfg.model = { ...(cfg.model ?? {}), timeoutMs: 3456 };
    });
    const ws = path.join(tmpRoot, "ws-timeout");
    await fs.mkdir(ws, { recursive: true });

    const session = await agent.createSession({ workspaceDir: ws });
    await bootstrapped(session);
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
      expect(meta.model_id).toBe("deepseek-v4-flash-vision-exp");
      expect(session.provider).toBe("deepseek");
      expect(session.modelId).toBe("deepseek-v4-flash-vision-exp");
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
      expect(session.modelId).toBe("deepseek-v4-flash-vision-exp");
    } finally {
      session.dispose();
    }
  });
});

describe("Agent.createSession session source (session_meta origin marker)", () => {
  it("records the given source in session_meta; a user-created session carries no source key", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-source");
    await fs.mkdir(ws, { recursive: true });

    const scheduled = await agent.createSession({ workspaceDir: ws, source: "schedule" });
    try {
      expect((scheduled.metaMessage.payload as { source?: string }).source).toBe("schedule");
    } finally {
      scheduled.dispose();
    }

    // Absent = user-created: the key must not appear at all (Trace consumers treat absence as the default).
    const plain = await agent.createSession({ workspaceDir: ws });
    try {
      expect("source" in (plain.metaMessage.payload as unknown as Record<string, unknown>)).toBe(
        false,
      );
    } finally {
      plain.dispose();
    }
  });
});

describe("Agent.createSession thinking level (explicit option wins over the Agent config)", () => {
  // A context's level is the LLM object's construction default (the Session's live pin
  // overrides it per request); nothing is recorded — the level is a per-request parameter.
  const defaultLevelOf = async (session: unknown): Promise<unknown> => {
    await bootstrapped(session);
    return (session as { engine: { deps: { llm: { defaultThinkingLevel?: unknown } } } }).engine
      .deps.llm.defaultThinkingLevel;
  };

  it("falls back to the Agent config for the llm default", async () => {
    const agent = await createAgent();
    // The seeded Agent config pins thinking_level "medium" — the only source when no option is given.
    expect(agent.state.systemConfig.model?.thinking_level).toBe("medium");
    const ws = path.join(tmpRoot, "ws-thinking-default");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    try {
      expect(await defaultLevelOf(session)).toBe("medium");
      expect(mapThinkingLevel("medium")).toBeDefined(); // the name maps onto the wire enum
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
      expect(await defaultLevelOf(session)).toBe("high");
    } finally {
      session.dispose();
    }
  });

  // The full resolution chain (the single rule, comment-pinned at Agent.configuredThinkingLevel
  // and mirrored by the web draft picker's display): Agent explicit `model.thinking_level` >
  // Project `default_chat.thinking_level` > built-in "medium".
  it("falls back to the Project's default_chat.thinking_level when the Agent config has none", async () => {
    const cfg = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    cfg.default_chat = { thinking_level: "high" };
    await saveProjectConfig(tmpRoot, DEFAULT_PROJECT_ID, cfg);
    const agent = await createAgent();
    // A hand-edited config without a level (the seeded default pins "medium").
    await patchSystemConfig((cfg) => {
      delete cfg.model?.thinking_level;
    });
    const ws = path.join(tmpRoot, "ws-thinking-project");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    try {
      expect(await defaultLevelOf(session)).toBe("high");
    } finally {
      session.dispose();
    }
  });

  it("Agent explicit level wins over the project default; built-in medium is the last resort", async () => {
    const cfg = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    cfg.default_chat = { thinking_level: "low" };
    await saveProjectConfig(tmpRoot, DEFAULT_PROJECT_ID, cfg);
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-thinking-chain");
    await fs.mkdir(ws, { recursive: true });
    // The seeded config's explicit "medium" beats the project's "low".
    const explicit = await agent.createSession({ workspaceDir: ws });
    try {
      expect(await defaultLevelOf(explicit)).toBe("medium");
    } finally {
      explicit.dispose();
    }
    // No explicit level and no project default -> the built-in "medium". Both halves of
    // the chain are read from disk when a context opens, so the SAME Agent object sees the
    // Project config edited underneath it.
    const noDefault = await loadProjectConfig(tmpRoot, DEFAULT_PROJECT_ID);
    delete noDefault.default_chat;
    await saveProjectConfig(tmpRoot, DEFAULT_PROJECT_ID, noDefault);
    await patchSystemConfig((cfg) => {
      delete cfg.model?.thinking_level;
    });
    const builtin = await agent.createSession({ workspaceDir: ws });
    try {
      expect(await defaultLevelOf(builtin)).toBe("medium");
    } finally {
      builtin.dispose();
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
   * handle.run yields, emitted before any LLM request. The child's effective thinking
   * level is no longer in session_meta (invariants only): the stream is advanced up to
   * the child's tool_list_ready event — the point where the lazy bootstrap has constructed
   * the LLM — and the captured config (the last one pushed) is read there; the generator
   * is closed right after, so nothing is ever sent upstream.
   */
  async function spawnedChildMeta(
    runner: SubagentRunner,
    input: Parameters<SubagentRunner["spawn"]>[0],
  ): Promise<{
    provider: string;
    model_id: string;
    workspace: string;
    source?: string;
    llm: { thinkingLevel?: string };
  }> {
    const handle = await runner.spawn(input);
    let llm: { thinkingLevel?: string } | undefined;
    try {
      const gen = handle.run({ messages: [userText("noop")] });
      const first = await gen.next();
      expect(first.done).toBe(false);
      const msg = first.value as OmniMessage;
      expect(msg.type).toBe("session_meta");
      // Child messages are stamped with the child Session id as the origin hop.
      expect(msg.origin?.[0]).toBe(handle.sessionId);
      for (;;) {
        const next = await gen.next();
        expect(next.done).toBe(false);
        if (((next.value as OmniMessage).payload as { type?: string }).type === "tool_list_ready") {
          llm = capturedLLMConfigs.list.at(-1)!;
          break;
        }
      }
      await gen.return(null);
      return {
        ...(msg.payload as {
          provider: string;
          model_id: string;
          workspace: string;
          source?: string;
        }),
        llm: llm!,
      };
    } finally {
      handle.dispose();
    }
  }

  it("inherits the parent's model pair, thinking level, and workspace when the args omit them", async () => {
    const agent = await createAgent();
    await patchSystemConfig((cfg) => {
      cfg.model = { ...(cfg.model ?? {}), thinking_level: "high" };
    });
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
      expect(child.llm.thinkingLevel).toBe("high");
      // Workspace inheritance (behavior that predates model/thinking inheritance): locked here.
      expect(child.workspace).toBe(ws);
      // The spawn site marks the child's own session_meta as subagent-created — the single
      // source of truth the server derives from (its registration fallback cannot mask this).
      expect(child.source).toBe("subagent");
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
      expect(child.llm.thinkingLevel).toBe("medium");
      expect(child.workspace).toBe(ws);
    } finally {
      parent.dispose();
    }
  });

  it("passes 'no thinking level' down when the parent has none (the child config never applies)", async () => {
    // helper_agent's own seeded config pins "medium". With the config chain always resolving
    // (Agent explicit > Project default_chat > built-in "medium"), a parent with NO level can
    // only come from the explicit tri-state null (an SDK caller suppressing the chain). That
    // null must reach the child as-is: falling back to the child's own config here was the
    // fallback hole — the child must show no level at all.
    await createAgent({ agentId: "helper_agent" });
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-inherit-none");
    await fs.mkdir(ws, { recursive: true });
    const parent = await agent.createSession({ workspaceDir: ws, thinkingLevel: null });
    // The parent LLM is only constructed by the lazy bootstrap — drive it before reading.
    await bootstrapped(parent);
    const parentLLM = capturedLLMConfigs.list.at(-1)!;
    const runner = lastSpawnedRunner();
    try {
      expect("thinkingLevel" in parentLLM).toBe(false);
      const child = await spawnedChildMeta(runner, { agentId: "helper_agent" });
      // The tri-state null reached the child: no level at all, not helper_agent's "medium".
      expect("thinkingLevel" in child.llm).toBe(false);
    } finally {
      parent.dispose();
    }
  });

  it("pins an explicit spawn-time thinking level over inheritance (run_subagent's thinking_level)", async () => {
    const agent = await createAgent();
    await patchSystemConfig((cfg) => {
      cfg.model = { ...(cfg.model ?? {}), thinking_level: "high" };
    });
    const ws = path.join(tmpRoot, "ws-thinking-override");
    await fs.mkdir(ws, { recursive: true });
    const parent = await agent.createSession({ workspaceDir: ws });
    const runner = lastSpawnedRunner();
    try {
      const child = await spawnedChildMeta(runner, { thinkingLevel: "low" });
      // The explicit level wins over the parent's effective "high"; the rest of the spawn
      // still follows the parent (workspace locked here as the cheap witness).
      expect(child.llm.thinkingLevel).toBe("low");
      expect(child.workspace).toBe(ws);
    } finally {
      parent.dispose();
    }
  });

  it("pins an explicit spawn-time thinking level even when the parent has no level at all", async () => {
    // With the parent suppressing the config chain (tri-state null), an explicit spawn level
    // must still apply — the override sits above the inherit-or-null resolution, not below it.
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-thinking-override-none");
    await fs.mkdir(ws, { recursive: true });
    const parent = await agent.createSession({ workspaceDir: ws, thinkingLevel: null });
    const runner = lastSpawnedRunner();
    try {
      const child = await spawnedChildMeta(runner, { thinkingLevel: "xhigh" });
      expect(child.llm.thinkingLevel).toBe("xhigh");
    } finally {
      parent.dispose();
    }
  });

  it("rejects half a model reference at the runner layer (never completed from the parent's half)", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-inherit-half");
    await fs.mkdir(ws, { recursive: true });
    const parent = await agent.createSession({ workspaceDir: ws });
    const runner = lastSpawnedRunner();
    try {
      await expect(runner.spawn({ modelId: "claude-sonnet-4-6" })).rejects.toThrow(
        /must be given as a \(provider, model_id\) pair/,
      );
      await expect(runner.spawn({ provider: "anthropic" })).rejects.toThrow(
        /must be given as a \(provider, model_id\) pair/,
      );
    } finally {
      parent.dispose();
    }
  });

  it("makes a cross-agent child follow the parent session, not its own Agent config", async () => {
    // Seed the second Agent first (spawn verifies its system_config exists); its own seeded
    // config (thinking "medium") and the Project default model must both lose to the parent.
    await createAgent({ agentId: "helper_agent" });
    const agent = await createAgent();
    await patchSystemConfig((cfg) => {
      cfg.model = { ...(cfg.model ?? {}), thinking_level: "xhigh" };
    });
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
      expect(child.llm.thinkingLevel).toBe("xhigh");
      expect(child.workspace).toBe(ws);
    } finally {
      parent.dispose();
    }
  });

  it("forwards the run input as an origin-tagged user message, after session_meta and before any model output", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-input-forward");
    await fs.mkdir(ws, { recursive: true });
    const parent = await agent.createSession({
      workspaceDir: ws,
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
    });
    const runner = lastSpawnedRunner();
    const handle = await runner.spawn({});
    try {
      // The child's user side has no other live source: a session's normal caller typed its
      // own input, but this caller is the PARENT — the frontend renders the child conversation
      // purely from these forwarded messages. (Regression: the panel showed no user messages
      // live, while a reload — child-Trace expansion — did show them.)
      const gen = handle.run({ messages: [userText("count the TODO items")] });
      const first = (await gen.next()).value as { type: string };
      expect(first.type).toBe("session_meta");
      // The input yield precedes childSession.run: pulling it never issues an LLM request.
      const second = await gen.next();
      expect(second.done).toBe(false);
      const msg = second.value as {
        type: string;
        origin?: string[];
        payload: { type: string; role?: string; text?: string };
      };
      expect(msg.origin).toEqual([handle.sessionId]);
      expect(msg.type).toBe("model_msg");
      expect(msg.payload).toMatchObject({
        type: "text",
        role: "user",
        text: "count the TODO items",
      });
      await gen.return(null);
    } finally {
      handle.dispose();
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
      await bootstrapped(pinned);
      const llm = (pinned as unknown as { engine: { deps: { llm: unknown } } }).engine.deps.llm;
      expect(uniConfigOf(llm).max_tokens).toBe(8000);
    } finally {
      pinned.dispose();
    }

    // An unannotated entry (the default model) inherits the Agent value, as before.
    const inherited = await agent.createSession({ workspaceDir: ws });
    try {
      await bootstrapped(inherited);
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

describe("Agent.createSession fast mode (session requests only, never the meta ones)", () => {
  const uniConfigOf = (llm: unknown) =>
    (llm as { uniConfig?: { fast_mode?: boolean } }).uniConfig ?? {};

  it("the entry's fast_mode reaches the session LLM and is withheld from the meta LLM", async () => {
    // The scoping decision the whole feature rests on: the premium tier is what the user is
    // waiting on, so it rides the session's own requests, while background one-shots (title
    // generation here; read_file's vision describer builds from the *vision* model's entry and
    // so cannot inherit it at all) stay on the standard tier. Without this test the split is
    // asserted only by comments, and a refactor that hoists fastMode into a shared config
    // helper would start billing every session title at premium rates with all suites green.
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "fast-on",
      client_type: "openai",
      fast_mode: true,
    });
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-fast-mode");
    await fs.mkdir(ws, { recursive: true });

    const session = await agent.createSession({
      workspaceDir: ws,
      modelId: "fast-on",
      provider: "custom",
    });
    try {
      await bootstrapped(session);
      const llm = (session as unknown as { engine: { deps: { llm: unknown } } }).engine.deps.llm;
      expect(uniConfigOf(llm).fast_mode).toBe(true);
      // The title one-shot on the same model must not carry it.
      const bare = (session as unknown as { createBareLLM?: () => unknown }).createBareLLM?.();
      expect("fast_mode" in uniConfigOf(bare)).toBe(false);
    } finally {
      session.dispose();
    }
  });

  it("an unannotated entry puts no fast_mode key on the wire at all", async () => {
    // Absent, not false: models without a fast tier reject the parameter, so every existing
    // config has to stay byte-identical on the wire.
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "fast-off",
      client_type: "openai",
    });
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-fast-mode-off");
    await fs.mkdir(ws, { recursive: true });

    const session = await agent.createSession({
      workspaceDir: ws,
      modelId: "fast-off",
      provider: "custom",
    });
    try {
      await bootstrapped(session);
      const llm = (session as unknown as { engine: { deps: { llm: unknown } } }).engine.deps.llm;
      expect("fast_mode" in uniConfigOf(llm)).toBe(false);
    } finally {
      session.dispose();
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
        "---\nname: demo-skill\ndescription: Demo skill for tests.\nversion: 2026-07-16.1\n---\n\nSKILL_BODY_NOT_IN_PROMPT\n",
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

describe("Agent model contexts are assembled from the Agent State on disk, at every context open", () => {
  const promptOf = (session: { metaMessage: OmniMessage }): string =>
    (session.metaMessage.payload as { system_prompt: string }).system_prompt;
  const mdFile = () => agentsMdPath(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
  const typeOf = (msg: OmniMessage | undefined): string | undefined =>
    (msg?.payload as { type?: string } | undefined)?.type;
  /** The engine-facing context opener (the Session's wrapper around the Agent's factory), reachable once the first-run bootstrap has resolved the toolset. */
  const openerOf = (session: unknown) =>
    (
      session as {
        engine: {
          deps: {
            openNextContext: (opts: OpenContextOptions) => Promise<OpenedContext>;
          };
        };
      }
    ).engine.deps.openNextContext;
  /** Opens the Session's next context through its opener, collecting the records the opener publishes. */
  async function openNext(
    session: unknown,
  ): Promise<{ opened: OpenedContext; records: OmniMessage[] }> {
    const records: OmniMessage[] = [];
    const opened = await openerOf(session)({ emit: (msg) => records.push(msg) });
    return { opened, records };
  }
  /** The config the most recently constructed GenerativeModel was given. */
  const lastBuilt = () =>
    capturedLLMConfigs.list.at(-1) as
      { systemPrompt?: string; tools?: { name: string }[]; thinkingLevel?: string } | undefined;
  const toolNames = (tools: { name: string }[] | undefined): string[] =>
    (tools ?? []).map((t) => t.name);
  /** The vault the Environment's command session registry injects at every spawn. */
  const environmentVaultOf = (session: unknown): Record<string, string> =>
    (session as { environment: { commandSessions: { vault: Record<string, string> } } }).environment
      .commandSessions.vault;

  it("createSession assembles from disk, not from the Agent's load-time snapshot", async () => {
    const agent = await createAgent();
    await fs.writeFile(mdFile(), "EDITED AFTER LOAD", "utf8");
    await patchSystemConfig((cfg) => {
      cfg.max_turns = 7;
    });
    const ws = path.join(tmpRoot, "ws-md-disk");
    await fs.mkdir(ws, { recursive: true });

    const session = await agent.createSession({ workspaceDir: ws });
    try {
      expect(promptOf(session)).toContain("EDITED AFTER LOAD");
      expect(
        (session as unknown as { engineDeps: { maxTurns?: number } }).engineDeps.maxTurns,
      ).toBe(7);
      // The Agent object's copies are the load-time snapshot; no Session runs on them.
      expect(agent.state.agentsMd).not.toContain("EDITED AFTER LOAD");
      expect(agent.state.systemConfig.max_turns).not.toBe(7);
    } finally {
      session.dispose();
    }
  });

  it("the context opened after compaction is rebuilt whole — prompt, toolset, vault, run settings — and its records describe it", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-rebuild");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    try {
      await bootstrapped(session);
      expect(toolNames(lastBuilt()!.tools)).toContain("write_file");
      expect(environmentVaultOf(session)).toEqual({});
      expect(promptOf(session)).not.toContain("EDITED DURING THE OLD CONTEXT");

      // Everything edited during the old context — by the model working on its own
      // configuration, or by hand in the Agent settings.
      await fs.writeFile(mdFile(), "EDITED DURING THE OLD CONTEXT", "utf8");
      await setVaultEntry(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "NEW_API_KEY", "shh");
      await patchSystemConfig((cfg) => {
        cfg.tools = {
          ...(cfg.tools ?? {}),
          builtin: (cfg.tools?.builtin ?? []).filter((t) => t.name !== "write_file"),
        };
        cfg.compaction = { ...(cfg.compaction ?? {}), mode: "discard" };
        cfg.max_turns = 3;
        cfg.model = { ...(cfg.model ?? {}), thinking_level: "high" };
      });

      const { opened, records } = await openNext(session);

      // The new LLM object carries the re-assembled prompt, the re-read toolset and the
      // config's model defaults…
      const after = lastBuilt()!;
      expect(after.systemPrompt).toContain("EDITED DURING THE OLD CONTEXT");
      expect(after.systemPrompt).toContain("NEW_API_KEY");
      expect(toolNames(after.tools)).not.toContain("write_file");
      expect(toolNames(after.tools)).toContain("read_file");
      expect(after.thinkingLevel).toBe("high");
      // …the vault's values went straight into the Environment's command environment…
      expect(environmentVaultOf(session)).toEqual({ NEW_API_KEY: "shh" });
      // …the engine settings follow the re-read config…
      expect(opened.maxTurns).toBe(3);
      expect(opened.compaction?.mode).toBe("discard");
      // …the meta the rotated Trace file opens with records exactly that prompt (the Session's
      // own meta follows the running context), and the toolset record is published for the
      // file head and the live stream.
      const recorded = (opened.sessionMeta!.payload as { system_prompt: string }).system_prompt;
      expect(recorded).toBe(after.systemPrompt);
      expect(promptOf(session)).toBe(recorded);
      expect(records.map(typeOf)).toEqual(["tool_list_ready"]);
      expect(toolNames((records[0]!.payload as { tools: { name: string }[] }).tools)).toEqual(
        toolNames(after.tools),
      );
    } finally {
      session.dispose();
    }
  });

  it("session_meta records no level; the config default and a null pin shape only the LLM base", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-thinking-meta");
    await fs.mkdir(ws, { recursive: true });
    const levelOf = (session: { metaMessage: OmniMessage }) =>
      (session.metaMessage.payload as { thinking_level?: string }).thinking_level;

    // The seeded config pins "medium"; a `null` pin (a subagent whose parent has none) runs
    // without a level. Neither is recorded: the level is a per-request parameter.
    const configured = await agent.createSession({ workspaceDir: ws });
    const unlevelled = await agent.createSession({ workspaceDir: ws, thinkingLevel: null });
    try {
      await bootstrapped(configured);
      expect(lastBuilt()!.thinkingLevel).toBe("medium");
      expect(levelOf(configured)).toBeUndefined();
      await bootstrapped(unlevelled);
      expect(lastBuilt()!.thinkingLevel).toBeUndefined();
      expect(levelOf(unlevelled)).toBeUndefined();
    } finally {
      configured.dispose();
      unlevelled.dispose();
    }
  });

  it("toolPermission and the command policy are strict-tier: an edit lands at the next context open, not mid-context", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-strict-permission");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    const policyOf = () =>
      (
        session as unknown as { commandPolicy?: () => { enabled?: boolean } | undefined }
      ).commandPolicy?.();
    try {
      await bootstrapped(session);
      expect(session.toolPermission("read_file")).toBe("r");
      const openedWith = policyOf();
      await patchSystemConfig((cfg) => {
        cfg.tools = {
          ...(cfg.tools ?? {}),
          builtin: (cfg.tools?.builtin ?? []).map((t) =>
            t.name === "read_file" ? { ...t, permission: "rw" as const } : t,
          ),
        };
      });
      await fs.writeFile(
        projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID),
        "[command_policy]\nenabled = false\n",
        "utf8",
      );
      // The running context's toolset and policy stand until rotation…
      expect(session.toolPermission("read_file")).toBe("r");
      expect(policyOf()).toBe(openedWith);
      // …and the next context opens with both edits.
      await openNext(session);
      expect(session.toolPermission("read_file")).toBe("rw");
      expect(policyOf()).toEqual({ enabled: false });
    } finally {
      session.dispose();
    }
  });

  it("thinkingLevel is plain engine state: an assignment rides requests while contexts keep their config base", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-thinking-pin");
    await fs.mkdir(ws, { recursive: true });
    const levelOf = (session: { metaMessage: OmniMessage }) =>
      (session.metaMessage.payload as { thinking_level?: string }).thinking_level;
    const engineLevelOf = (session: unknown) =>
      (session as { engine: { thinkingLevel?: string } }).engine.thinkingLevel;

    const session = await agent.createSession({ workspaceDir: ws });
    try {
      // Assigned before the first run: buffered on the Session, handed to the engine when
      // it is built. The context's own base stays the config default ("medium").
      session.thinkingLevel = "high";
      expect(session.thinkingLevel).toBe("high");
      expect(levelOf(session)).toBeUndefined();
      await bootstrapped(session);
      expect(lastBuilt()!.thinkingLevel).toBe("medium");
      expect(engineLevelOf(session)).toBe("high");

      // Reassigned mid-session: engine state for every subsequent request; the context a
      // compaction opens still bases on the creation option and the config, and the meta
      // records nothing.
      session.thinkingLevel = "xhigh";
      expect(engineLevelOf(session)).toBe("xhigh");
      const { opened } = await openNext(session);
      expect(
        (opened.sessionMeta!.payload as { thinking_level?: string }).thinking_level,
      ).toBeUndefined();
      expect(lastBuilt()!.thinkingLevel).toBe("medium");
      expect(session.thinkingLevel).toBe("xhigh");
    } finally {
      session.dispose();
    }
  });

  it("reconnects the new context's MCP Servers, bracketing the connect with the same event pair the first run uses", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-mcp-rotate");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    // The provider warns on stderr about the unreachable server; keep the test output clean.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await bootstrapped(session);
      // A server added during the old context. Its command cannot be spawned, so the connect
      // fails fast — and the outcome is recorded rather than hidden.
      await patchSystemConfig((cfg) => {
        cfg.tools = {
          ...(cfg.tools ?? {}),
          mcpServers: [{ name: "ghost", config: { command: "penguin-no-such-mcp-server" } }],
        };
      });

      const { records } = await openNext(session);

      expect(records.map(typeOf)).toEqual([
        "mcp_connect_begin",
        "mcp_connect_end",
        "tool_list_ready",
      ]);
      expect((records[0]!.payload as { servers: string[] }).servers).toEqual(["ghost"]);
      const end = records[1]!.payload as {
        status: string;
        results: { server: string; status: string }[];
      };
      expect(end.status).toBe("fatal");
      expect(end.results).toEqual([expect.objectContaining({ server: "ghost", status: "fatal" })]);
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining('MCP server "ghost" unavailable'),
      );
    } finally {
      stderr.mockRestore();
      session.dispose();
    }
  });

  it("an Agent State that cannot be assembled fails the context open outright — no silent fallback", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-unreadable");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    try {
      await bootstrapped(session);
      const before = promptOf(session);
      // system_config.yaml no longer parses — an edit gone wrong mid-context.
      await fs.writeFile(systemConfigPath(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), "");

      await expect(openNext(session)).rejects.toThrow("Invalid Agent State config");
      // Nothing was adopted: the Session still describes the context that is running.
      expect(promptOf(session)).toBe(before);
    } finally {
      session.dispose();
    }
  });
});
