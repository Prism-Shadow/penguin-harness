/**
 * Workspace Memory: key derivation, temporary-Workspace exclusion, directory preparation,
 * frontmatter parsing, and the `{{MEMORY}}` prompt block.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  createAgent,
  AGENT_SCOPE_KEY,
  MEMORY_INDEX_EMPTY_NOTE,
  MEMORY_PLACEHOLDER,
  WORKSPACE_MARKER_FILENAME,
  agentMemoryDir,
  assembleSystemPrompt,
  ensureAgentMemoryDir,
  ensureWorkspaceMemoryDir,
  isTemporaryWorkspace,
  loadOrInitAgentState,
  memoryDir,
  memoryIndexPath,
  parseMemoryFrontmatter,
  readMemoryIndex,
  readWorkspaceMarker,
  resolveSessionMemory,
  workspaceMemoryDir,
  workspaceMemoryKey,
  workspaceMemoryKeyForRealPath,
  type AgentState,
} from "../src/index.js";
import { stubProviderKeys } from "./provider-keys.js";

let root: string;
let workspace: string;
let restoreKeys: () => void;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-memory-"));
  workspace = path.join(root, "projects", "my-app");
  await fs.mkdir(workspace, { recursive: true });
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

/** The effective system prompt a created Session recorded in its session_meta. */
function sessionPrompt(session: { metaMessage: { payload: unknown } }): string {
  return (session.metaMessage.payload as { system_prompt: string }).system_prompt;
}

describe("workspace key", () => {
  it("is a safe basename plus a path hash, and is stable across calls", () => {
    const key = workspaceMemoryKeyForRealPath("/home/u/work/My App!");
    expect(key).toMatch(/^my-app-[0-9a-f]{8}$/);
    expect(workspaceMemoryKeyForRealPath("/home/u/work/My App!")).toBe(key);
  });

  it("separates two Workspaces that share a directory name", () => {
    expect(workspaceMemoryKeyForRealPath("/a/site")).not.toBe(
      workspaceMemoryKeyForRealPath("/b/site"),
    );
  });

  it("falls back to a generic base when the name has nothing key-safe in it", () => {
    expect(workspaceMemoryKeyForRealPath("/srv/项目")).toMatch(/^workspace-[0-9a-f]{8}$/);
  });

  it("resolves symlinks, so two routes to one directory share a key", async () => {
    const link = path.join(root, "link-to-app");
    await fs.symlink(workspace, link, "dir");
    expect(await workspaceMemoryKey(link)).toBe(await workspaceMemoryKey(workspace));
  });

  it("keeps a stable key for a directory that no longer exists (realpath fails)", async () => {
    const gone = path.join(root, "deleted");
    expect(await workspaceMemoryKey(gone)).toBe(workspaceMemoryKeyForRealPath(path.resolve(gone)));
  });
});

describe("temporary Workspace detection", () => {
  it("recognizes an Agent's own workspaces/ directory", async () => {
    const tmp = path.join(
      root,
      DEFAULT_PROJECT_ID,
      "agents",
      DEFAULT_AGENT_ID,
      "workspaces",
      "tmp-1234abcd",
    );
    await fs.mkdir(tmp, { recursive: true });
    expect(await isTemporaryWorkspace(root, DEFAULT_PROJECT_ID, tmp)).toBe(true);
  });

  it("treats a user directory — including one elsewhere under the Agent — as persistent", async () => {
    const stateSubdir = path.join(root, DEFAULT_PROJECT_ID, "agents", DEFAULT_AGENT_ID, "traces");
    await fs.mkdir(stateSubdir, { recursive: true });
    expect(await isTemporaryWorkspace(root, DEFAULT_PROJECT_ID, workspace)).toBe(false);
    expect(await isTemporaryWorkspace(root, DEFAULT_PROJECT_ID, stateSubdir)).toBe(false);
  });
});

describe("directory preparation", () => {
  it("creates the Workspace directory and records the Workspace path in its marker", async () => {
    const key = await workspaceMemoryKey(workspace);
    const dir = await ensureWorkspaceMemoryDir({
      root,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceKey: key,
      workspacePath: workspace,
    });
    expect(dir).toBe(workspaceMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, key));
    expect(await readWorkspaceMarker(dir)).toBe(workspace);
    // Idempotent: a second call neither fails nor rewrites a different path.
    await ensureWorkspaceMemoryDir({
      root,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceKey: key,
      workspacePath: workspace,
    });
    expect(await fs.readdir(dir)).toEqual([WORKSPACE_MARKER_FILENAME]);
  });

  it("reads an absent index as an empty string, and no topic file is preprovisioned", async () => {
    await agentState();
    expect(await readMemoryIndex(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).toBe("");
    expect(await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toEqual([]);
  });
});

describe("resolveSessionMemory", () => {
  const resolve = (opts: { workspaceDir: string; enabled: boolean }) =>
    resolveSessionMemory({
      root,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      ...opts,
    });

  /** Path of the temporary Workspace the SDK would allocate for a Session given no Workspace. */
  function tempWorkspacePath(): string {
    return path.join(
      root,
      DEFAULT_PROJECT_ID,
      "agents",
      DEFAULT_AGENT_ID,
      "workspaces",
      "tmp-cafebabe",
    );
  }

  it("prepares both scopes and returns the index for a persistent Workspace", async () => {
    await agentState();
    await fs.writeFile(
      memoryIndexPath(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      "# Memory\n\n## group\n",
      "utf8",
    );
    const memory = await resolve({ workspaceDir: workspace, enabled: true });
    expect(memory?.workspace?.key).toBe(await workspaceMemoryKey(workspace));
    expect(memory?.index).toContain("## group");
    await expect(fs.stat(memory!.workspace!.dir)).resolves.toBeTruthy();
    expect(memory?.agentDir).toBe(agentMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID));
    await expect(fs.stat(memory!.agentDir)).resolves.toBeTruthy();
  });

  it("returns null and creates nothing when Memory is disabled", async () => {
    await agentState();
    expect(await resolve({ workspaceDir: workspace, enabled: false })).toBeNull();
    expect(await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toEqual([]);
  });

  it("gives a temporary Workspace the Agent scope and no Workspace scope", async () => {
    await agentState();
    const tmp = tempWorkspacePath();
    await fs.mkdir(tmp, { recursive: true });
    const memory = await resolve({ workspaceDir: tmp, enabled: true });
    // The Agent scope is the only place such a Session could write and have it read back.
    expect(memory?.agentDir).toBe(agentMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID));
    expect(memory?.workspace).toBeUndefined();
    expect(await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toEqual([
      AGENT_SCOPE_KEY,
    ]);
  });
});

describe("frontmatter", () => {
  it("reads name / description / type / updated_at", () => {
    const parsed = parseMemoryFrontmatter(
      "---\nname: Testing conventions\ndescription: how tests run\ntype: feedback\nupdated_at: 2026-07-30\n---\n\n- body\n",
      "feedback_testing.md",
    );
    expect(parsed).toEqual({
      name: "Testing conventions",
      description: "how tests run",
      type: "feedback",
      updatedAt: "2026-07-30",
    });
  });

  it("falls back to the file name and drops an unknown type", () => {
    const parsed = parseMemoryFrontmatter("---\ntype: user\n---\nbody\n", "notes.md");
    expect(parsed).toEqual({ name: "notes.md", description: "" });
  });

  it("returns null when the file has no frontmatter", () => {
    expect(parseMemoryFrontmatter("just a note\n", "notes.md")).toBeNull();
  });
});

describe("{{MEMORY}} injection", () => {
  /** Marker lines of each half of the block, so a test can assert which scopes were rendered. */
  const AGENT_LINE = "Agent memory directory:";
  const WORKSPACE_LINE = "Workspace memory directory:";

  const bothScopes = {
    agentDir: "/data/memory/agent",
    workspace: { key: "my-app-12345678", dir: "/data/memory/my-app-12345678" },
    index:
      "# Memory\n\n## my-app-12345678\n\n- [Testing](my-app-12345678/feedback_testing.md) — how tests run",
  };

  it("renders both scopes with their directories and the index substituted", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, bothScopes);
    expect(prompt).toContain("/data/memory/agent");
    expect(prompt).toContain("/data/memory/my-app-12345678");
    expect(prompt).toContain("- [Testing](my-app-12345678/feedback_testing.md) — how tests run");
    expect(prompt).not.toContain(MEMORY_PLACEHOLDER);
    expect(prompt).not.toContain(MEMORY_INDEX_EMPTY_NOTE);
  });

  it("renders the Agent scope alone when the Session has no Workspace scope", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, {
      agentDir: "/data/memory/agent",
      index: "# Memory\n",
    });
    expect(prompt).toContain(AGENT_LINE);
    expect(prompt).toContain("/data/memory/agent");
    // The Workspace half is a separate config key precisely so it can be left out entirely:
    // a temporary Workspace must never be told about a directory it does not have.
    expect(prompt).not.toContain(WORKSPACE_LINE);
    // The scope-choice rule lives in the Workspace half, so a one-scope Session never sees it.
    expect(prompt).not.toContain("Choosing between the two");
  });

  it("states the store is empty when the index has no content yet", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, {
      ...bothScopes,
      index: "  \n",
    });
    expect(prompt).toContain(MEMORY_INDEX_EMPTY_NOTE);
  });

  it("injects nothing at all when the Session has no Memory", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state);
    expect(prompt).not.toContain(MEMORY_PLACEHOLDER);
    expect(prompt).not.toContain(AGENT_LINE);
    expect(prompt).not.toContain(WORKSPACE_LINE);
  });

  it("reaches the Session prompt with both scopes, or the Agent scope alone for a temporary Workspace", async () => {
    const agent = await createAgent({ root });
    const withWorkspace = await agent.createSession({ workspaceDir: workspace });
    const key = await workspaceMemoryKey(workspace);
    expect(sessionPrompt(withWorkspace)).toContain(
      workspaceMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, key),
    );
    expect(sessionPrompt(withWorkspace)).toContain(WORKSPACE_LINE);

    // No Workspace given: the SDK allocates a temporary one, which gets the Agent scope only.
    const temporary = await agent.createSession();
    expect(sessionPrompt(temporary)).toContain(
      agentMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
    );
    expect(sessionPrompt(temporary)).not.toContain(WORKSPACE_LINE);
    expect(
      (await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).sort(),
    ).toEqual([AGENT_SCOPE_KEY, key].sort());
  });

  it("is left out of the Session prompt when the Agent config disables Memory", async () => {
    const agent = await createAgent({ root });
    agent.state.systemConfig.memory = { ...agent.state.systemConfig.memory, enabled: false };
    const session = await agent.createSession({ workspaceDir: workspace });
    expect(sessionPrompt(session)).not.toContain(AGENT_LINE);
    expect(sessionPrompt(session)).not.toContain(WORKSPACE_LINE);
    expect(await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toEqual([]);
  });

  it("injects nothing when the Agent's template carries no {{MEMORY}} placeholder", async () => {
    const state = await agentState();
    const stripped: AgentState = {
      ...state,
      systemConfig: {
        ...state.systemConfig,
        system_prompt: state.systemConfig.system_prompt.split(MEMORY_PLACEHOLDER).join(""),
      },
    };
    const prompt = assembleSystemPrompt(stripped, undefined, undefined, undefined, bothScopes);
    expect(prompt).not.toContain("/data/memory/my-app-12345678");
    expect(prompt).not.toContain("/data/memory/agent");
  });

  it("keeps the Agent half when the config carries no workspace_prompt", async () => {
    const state = await agentState();
    const noWorkspaceBlock: AgentState = {
      ...state,
      systemConfig: {
        ...state.systemConfig,
        memory: { ...state.systemConfig.memory, workspace_prompt: undefined },
      },
    };
    // An Agent whose config predates the Workspace half degrades to Agent-scope-only rather
    // than losing Memory altogether.
    const prompt = assembleSystemPrompt(
      noWorkspaceBlock,
      undefined,
      undefined,
      undefined,
      bothScopes,
    );
    expect(prompt).toContain(AGENT_LINE);
    expect(prompt).not.toContain(WORKSPACE_LINE);
  });
});

describe("ensureAgentMemoryDir", () => {
  it("creates the Agent scope directory and leaves no .workspace marker", async () => {
    await agentState();
    const dir = await ensureAgentMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(dir).toBe(agentMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID));
    // The marker records the path a key was hashed from; this scope stands for no path.
    expect(await readWorkspaceMarker(dir)).toBeUndefined();
    // Idempotent: a second Session must not fail on an existing directory.
    await expect(ensureAgentMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).resolves.toBe(
      dir,
    );
  });

  it("is a name no generated workspace key can collide with", async () => {
    // Every generated key is `<base>-<8 hex>`, so it always carries a hyphen.
    const key = workspaceMemoryKeyForRealPath("/home/dev/agent");
    expect(key).not.toBe(AGENT_SCOPE_KEY);
    expect(key.startsWith(`${AGENT_SCOPE_KEY}-`)).toBe(true);
  });
});
