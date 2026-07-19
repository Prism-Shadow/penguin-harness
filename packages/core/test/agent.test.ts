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

describe("effectiveMaxContextLength (压缩阈值按模型窗口钳制)", () => {
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
    await expect(agent.createSession({ workspaceDir: ws })).rejects.toThrow(/不存在/);
    // Must not be auto-created.
    await expect(fs.stat(ws)).rejects.toThrow();
  });

  it("throws when the given workspace path is not a directory", async () => {
    const agent = await createAgent();
    const filePath = path.join(tmpRoot, "a-file");
    await fs.writeFile(filePath, "x", "utf8");
    await expect(agent.createSession({ workspaceDir: filePath })).rejects.toThrow(/不是目录/);
  });

  it("accepts an existing directory and resolves it to an absolute path", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    expect(session.workspaceDir).toBe(ws);
    expect(path.isAbsolute(session.workspaceDir)).toBe(true);
  });

  it("rejects a modelId that is not in the Project config with a clear error", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-bad-model");
    await fs.mkdir(ws, { recursive: true });
    // A reference outside the config is not silently allowed (the unique key is provider +
    // model_id); the error is thrown before creating the temp Workspace.
    await expect(
      agent.createSession({ workspaceDir: ws, modelId: "not-configured-model" }),
    ).rejects.toThrow(/不在 Project 配置中/);
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

describe("Agent.createSession model reference（(provider, model_id) 成对）", () => {
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

  it("resolves a unique bare model_id and accepts an explicit pair", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-ref-pair");
    await fs.mkdir(ws, { recursive: true });
    // Provider omitted: model_id is a globally unique exact match in the config -> resolves to that entry.
    const bare = await agent.createSession({ workspaceDir: ws, modelId: "deepseek-v4-flash" });
    try {
      expect(bare.provider).toBe("deepseek");
      expect(bare.modelId).toBe("deepseek-v4-flash");
    } finally {
      bare.dispose();
    }
    const paired = await agent.createSession({
      workspaceDir: ws,
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
    });
    try {
      expect(paired.provider).toBe("anthropic");
      expect(paired.modelId).toBe("claude-sonnet-4-6");
    } finally {
      paired.dispose();
    }
  });

  it("rejects an ambiguous bare model_id and a provider without modelId", async () => {
    // Two providers coexist with the same model_id: omitting provider throws an ambiguity
    // error (listing the candidate pair references).
    await addModel(tmpRoot, DEFAULT_PROJECT_ID, {
      provider: "myproxy",
      model_id: "claude-sonnet-4-6",
    });
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws-ref-ambiguous");
    await fs.mkdir(ws, { recursive: true });
    await expect(
      agent.createSession({ workspaceDir: ws, modelId: "claude-sonnet-4-6" }),
    ).rejects.toThrow(/歧义.*\(provider=anthropic, model_id=claude-sonnet-4-6\)/);
    // Adding provider resolves it.
    const session = await agent.createSession({
      workspaceDir: ws,
      modelId: "claude-sonnet-4-6",
      provider: "myproxy",
    });
    try {
      expect(session.provider).toBe("myproxy");
    } finally {
      session.dispose();
    }
    // provider cannot be used alone (the reference must be a pair).
    await expect(agent.createSession({ workspaceDir: ws, provider: "anthropic" })).rejects.toThrow(
      /provider 不能单独使用/,
    );
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
