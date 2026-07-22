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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThinkingLevel } from "@prismshadow/agenthub";
import {
  addModel,
  createAgent,
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  installSkill,
  setVaultEntry,
} from "../src/index.js";
import { effectiveMaxContextLength } from "../src/agent.js";
import { stubProviderKeys } from "./provider-keys.js";

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

describe("Agent.createSession thinking level (per-model annotation wins over the Agent config)", () => {
  it("uses the entry's thinking_level in llmConfig and records the effective level in session_meta", async () => {
    // A local model served without thinking, annotated none — while the Agent State is
    // seeded with an explicit per-Agent "medium" (agent-wins would leave the per-model
    // annotation permanently shadowed).
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "custom",
      model_id: "local-no-think",
      client_type: "openai",
      thinking_level: "none",
    });
    const agent = await createAgent();
    expect(agent.state.systemConfig.model?.thinking_level).toBe("medium");
    const ws = path.join(tmpRoot, "ws-thinking");
    await fs.mkdir(ws, { recursive: true });

    const annotated = await agent.createSession({
      workspaceDir: ws,
      modelId: "local-no-think",
      provider: "custom",
    });
    try {
      // session_meta records the **effective** level (what the Trace view shows).
      const meta = annotated.metaMessage.payload as { thinking_level: string };
      expect(meta.thinking_level).toBe("none");
      // And the LLM request config carries the same level.
      const llm = (annotated as unknown as { engine: { deps: { llm: unknown } } }).engine.deps.llm;
      const uniConfig = (llm as { uniConfig?: { thinking_level?: unknown } }).uniConfig;
      expect(uniConfig?.thinking_level).toBe(ThinkingLevel.NONE);
    } finally {
      annotated.dispose();
    }

    // An unannotated entry (the default model) inherits the Agent value, as before.
    const inherited = await agent.createSession({ workspaceDir: ws });
    try {
      const meta = inherited.metaMessage.payload as { thinking_level: string };
      expect(meta.thinking_level).toBe("medium");
      const llm = (inherited as unknown as { engine: { deps: { llm: unknown } } }).engine.deps.llm;
      const uniConfig = (llm as { uniConfig?: { thinking_level?: unknown } }).uniConfig;
      expect(uniConfig?.thinking_level).toBe(ThinkingLevel.MEDIUM);
    } finally {
      inherited.dispose();
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
