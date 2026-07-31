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
  MEMORY_INDEX_EMPTY_NOTE,
  MEMORY_PLACEHOLDER,
  WORKSPACE_MARKER_FILENAME,
  assembleSystemPrompt,
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

  it("prepares the directory and returns the index for a persistent Workspace", async () => {
    await agentState();
    await fs.writeFile(
      memoryIndexPath(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      "# Memory\n\n## group\n",
      "utf8",
    );
    const memory = await resolve({ workspaceDir: workspace, enabled: true });
    expect(memory?.key).toBe(await workspaceMemoryKey(workspace));
    expect(memory?.index).toContain("## group");
    await expect(fs.stat(memory!.dir)).resolves.toBeTruthy();
  });

  it("returns null and creates nothing when Memory is disabled", async () => {
    await agentState();
    expect(await resolve({ workspaceDir: workspace, enabled: false })).toBeNull();
    expect(await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toEqual([]);
  });

  it("returns null for a temporary Workspace", async () => {
    await agentState();
    const tmp = path.join(
      root,
      DEFAULT_PROJECT_ID,
      "agents",
      DEFAULT_AGENT_ID,
      "workspaces",
      "tmp-cafebabe",
    );
    await fs.mkdir(tmp, { recursive: true });
    expect(await resolve({ workspaceDir: tmp, enabled: true })).toBeNull();
    expect(await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toEqual([]);
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
  it("renders the configured block with the directory and index substituted", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, {
      key: "my-app-12345678",
      dir: "/data/memory/my-app-12345678",
      index:
        "# Memory\n\n## my-app-12345678\n\n- [Testing](my-app-12345678/feedback_testing.md) — how tests run",
    });
    expect(prompt).toContain("/data/memory/my-app-12345678");
    expect(prompt).toContain("- [Testing](my-app-12345678/feedback_testing.md) — how tests run");
    expect(prompt).not.toContain(MEMORY_PLACEHOLDER);
    expect(prompt).not.toContain(MEMORY_INDEX_EMPTY_NOTE);
  });

  it("states the store is empty when the index has no content yet", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, {
      key: "my-app-12345678",
      dir: "/data/memory/my-app-12345678",
      index: "  \n",
    });
    expect(prompt).toContain(MEMORY_INDEX_EMPTY_NOTE);
  });

  it("injects nothing at all when the Session has no Memory", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state);
    expect(prompt).not.toContain(MEMORY_PLACEHOLDER);
    expect(prompt).not.toContain("Current workspace memory directory");
  });

  it("reaches the Session's system prompt for a persistent Workspace, but not a temporary one", async () => {
    const agent = await createAgent({ root });
    const withWorkspace = await agent.createSession({ workspaceDir: workspace });
    const key = await workspaceMemoryKey(workspace);
    expect(sessionPrompt(withWorkspace)).toContain(
      workspaceMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, key),
    );
    // No Workspace given: the SDK allocates a temporary one, which gets no Memory.
    const temporary = await agent.createSession();
    expect(sessionPrompt(temporary)).not.toContain("Current workspace memory directory");
    expect(await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toEqual([key]);
  });

  it("is left out of the Session prompt when the Agent config disables Memory", async () => {
    const agent = await createAgent({ root });
    agent.state.systemConfig.memory = { ...agent.state.systemConfig.memory, enabled: false };
    const session = await agent.createSession({ workspaceDir: workspace });
    expect(sessionPrompt(session)).not.toContain("Current workspace memory directory");
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
    const prompt = assembleSystemPrompt(stripped, undefined, undefined, undefined, {
      key: "my-app-12345678",
      dir: "/data/memory/my-app-12345678",
      index: "# Memory\n",
    });
    expect(prompt).not.toContain("/data/memory/my-app-12345678");
  });
});
