/**
 * Memory: key derivation, temporary-Workspace exclusion, directory preparation, frontmatter
 * parsing, and the `{{MEMORY}}` prompt block (marker-fenced indexes, the cap, and the
 * no-placeholder / no-workspace_prompt degradations).
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
  MEMORY_INDEX_FILENAME,
  USER_SCOPE_KEY,
  WORKSPACE_MARKER_FILENAME,
  assembleSystemPrompt,
  ensureUserMemoryDir,
  ensureWorkspaceMemoryDir,
  isTemporaryWorkspace,
  loadOrInitAgentState,
  memoryDir,
  memoryScopeDir,
  parseMemoryFrontmatter,
  readScopeIndex,
  readWorkspaceMarker,
  resolveSessionMemory,
  userMemoryDir,
  workspaceMemoryKey,
  workspaceMemoryKeyForRealPath,
  type AgentState,
  type SessionMemory,
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
  it("creates the Workspace directory with an empty index and records the path in its marker", async () => {
    const key = await workspaceMemoryKey(workspace);
    const dir = await ensureWorkspaceMemoryDir({
      root,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceKey: key,
      workspacePath: workspace,
    });
    expect(dir).toBe(memoryScopeDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, key));
    expect(await readWorkspaceMarker(dir)).toBe(workspace);
    expect(await readScopeIndex(dir)).toBe("");
    // Idempotent: a second call neither fails nor rewrites a different path.
    await ensureWorkspaceMemoryDir({
      root,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceKey: key,
      workspacePath: workspace,
    });
    expect((await fs.readdir(dir)).sort()).toEqual(
      [WORKSPACE_MARKER_FILENAME, MEMORY_INDEX_FILENAME].sort(),
    );
  });

  it("initializes Agent State with the User scope and its empty index, and no topic file", async () => {
    await agentState();
    expect(await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toEqual([
      USER_SCOPE_KEY,
    ]);
    const userDir = userMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(await fs.readdir(userDir)).toEqual([MEMORY_INDEX_FILENAME]);
    expect(await readScopeIndex(userDir)).toBe("");
  });

  it("never overwrites an existing index", async () => {
    await agentState();
    const userDir = userMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    await fs.writeFile(path.join(userDir, MEMORY_INDEX_FILENAME), "- [a](a.md) — hook\n", "utf8");
    await ensureUserMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(await readScopeIndex(userDir)).toBe("- [a](a.md) — hook\n");
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

  it("prepares both scopes and returns each scope's own index for a persistent Workspace", async () => {
    await agentState();
    const userDir = userMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    await fs.writeFile(
      path.join(userDir, MEMORY_INDEX_FILENAME),
      "- [pnpm](prefers-pnpm.md) — package manager\n",
      "utf8",
    );
    const memory = await resolve({ workspaceDir: workspace, enabled: true });
    expect(memory?.userDir).toBe(userDir);
    expect(memory?.userIndex).toContain("prefers-pnpm.md");
    expect(memory?.workspace?.key).toBe(await workspaceMemoryKey(workspace));
    expect(memory?.workspace?.index).toBe("");
    await expect(fs.stat(memory!.workspace!.dir)).resolves.toBeTruthy();
  });

  it("returns null and creates no Workspace scope when Memory is disabled", async () => {
    await agentState();
    expect(await resolve({ workspaceDir: workspace, enabled: false })).toBeNull();
    // The User scope from Agent State init stays; the point is nothing new appears.
    expect(await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toEqual([
      USER_SCOPE_KEY,
    ]);
  });

  it("gives a temporary Workspace the User scope and no Workspace scope", async () => {
    await agentState();
    const tmp = tempWorkspacePath();
    await fs.mkdir(tmp, { recursive: true });
    const memory = await resolve({ workspaceDir: tmp, enabled: true });
    // The User scope is the only place such a Session could write and have it read back.
    expect(memory?.userDir).toBe(userMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID));
    expect(memory?.workspace).toBeUndefined();
    expect(await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toEqual([
      USER_SCOPE_KEY,
    ]);
  });
});

describe("frontmatter", () => {
  it("reads name / description / type / updated_at", () => {
    const parsed = parseMemoryFrontmatter(
      "---\nname: testing-conventions\ndescription: how tests run\ntype: feedback\nupdated_at: 2026-08-07\n---\n\n- body\n",
      "testing-conventions.md",
    );
    expect(parsed).toEqual({
      name: "testing-conventions",
      description: "how tests run",
      type: "feedback",
      updatedAt: "2026-08-07",
    });
  });

  it("accepts the user type", () => {
    const parsed = parseMemoryFrontmatter("---\ntype: user\n---\nbody\n", "notes.md");
    expect(parsed).toEqual({ name: "notes.md", description: "", type: "user" });
  });

  it("falls back to the file name and drops an unknown type", () => {
    const parsed = parseMemoryFrontmatter("---\ntype: diary\n---\nbody\n", "notes.md");
    expect(parsed).toEqual({ name: "notes.md", description: "" });
  });

  it("returns null when the file has no frontmatter", () => {
    expect(parseMemoryFrontmatter("just a note\n", "notes.md")).toBeNull();
  });
});

describe("{{MEMORY}} rendering", () => {
  /** Marker lines of each half of the block, so a test can assert which scopes were rendered. */
  const USER_LINE = "User memory directory:";
  const WORKSPACE_LINE = "Workspace memory directory:";

  const bothScopes: SessionMemory = {
    userDir: "/data/memory/user",
    userIndex: "- [pnpm](prefers-pnpm.md) — package manager",
    workspace: {
      key: "my-app-12345678",
      dir: "/data/memory/my-app-12345678",
      index: "- [testing](testing-conventions.md) — how tests run",
    },
  };

  it("renders both scopes, each index fenced by its own marker pair", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, bothScopes);
    expect(prompt).toContain("/data/memory/user");
    expect(prompt).toContain("/data/memory/my-app-12345678");
    expect(prompt).toContain(
      "[user_memory_index]\n- [pnpm](prefers-pnpm.md) — package manager\n[/user_memory_index]",
    );
    expect(prompt).toContain(
      "[workspace_memory_index]\n- [testing](testing-conventions.md) — how tests run\n[/workspace_memory_index]",
    );
    expect(prompt).not.toContain("{{MEMORY}}");
    expect(prompt).not.toContain(MEMORY_INDEX_EMPTY_NOTE);
  });

  it("renders the User half alone when the Session has no Workspace scope", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, {
      userDir: "/data/memory/user",
      userIndex: "",
    });
    expect(prompt).toContain(USER_LINE);
    expect(prompt).toContain("/data/memory/user");
    // The Workspace half is a separate config key precisely so it can be left out entirely:
    // a temporary Workspace must never be told about a directory it does not have.
    expect(prompt).not.toContain(WORKSPACE_LINE);
    // The scope-choice rule lives in the Workspace half, so a one-scope Session never sees it.
    expect(prompt).not.toContain("Facts about the workspace");
  });

  it("states a scope's store is empty when its index has no content yet", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, {
      ...bothScopes,
      workspace: { ...bothScopes.workspace!, index: "  \n" },
    });
    // Only the blank Workspace index gets the note; the User index keeps its content.
    expect(prompt).toContain(`[workspace_memory_index]\n${MEMORY_INDEX_EMPTY_NOTE}`);
    expect(prompt).toContain("- [pnpm](prefers-pnpm.md) — package manager");
  });

  it("caps an injected index at 200 lines and notes the truncation", async () => {
    const state = await agentState();
    const lines = Array.from({ length: 220 }, (_, i) => `- [m${i}](m${i}.md) — hook`);
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, {
      userDir: "/data/memory/user",
      userIndex: lines.join("\n"),
    });
    expect(prompt).toContain("- [m199](m199.md) — hook");
    // The file on disk keeps all 220 lines; only the injection is capped.
    expect(prompt).not.toContain("- [m200](m200.md) — hook");
    expect(prompt).toContain("showing 200 of 220 lines");
  });

  it("injects nothing at all when the Session has no Memory", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state);
    expect(prompt).not.toContain("{{MEMORY}}");
    expect(prompt).not.toContain("# Memory");
    expect(prompt).not.toContain(USER_LINE);
    expect(prompt).not.toContain(WORKSPACE_LINE);
    // Neighboring sections are untouched.
    expect(prompt).toContain("# Skills");
    expect(prompt).toContain("# Environment");
  });

  it("injects no Memory into a template without the placeholder — nothing is spliced in", async () => {
    const state = await agentState();
    const bare: AgentState = {
      ...state,
      systemConfig: { ...state.systemConfig, system_prompt: "# Role\nDo things.\n# Environment" },
    };
    // The Memory tab offers inserting {{MEMORY}} explicitly; rendering never adds it itself.
    expect(assembleSystemPrompt(bare, undefined, undefined, undefined, bothScopes)).toBe(
      "# Role\nDo things.\n# Environment",
    );
  });

  it("keeps the User half when the config carries no workspace_prompt", async () => {
    const state = await agentState();
    const noWorkspaceBlock: AgentState = {
      ...state,
      systemConfig: {
        ...state.systemConfig,
        memory: { ...state.systemConfig.memory, workspace_prompt: undefined },
      },
    };
    // An Agent whose config predates the Workspace half degrades to User-scope-only rather
    // than losing Memory altogether.
    const prompt = assembleSystemPrompt(
      noWorkspaceBlock,
      undefined,
      undefined,
      undefined,
      bothScopes,
    );
    expect(prompt).toContain(USER_LINE);
    expect(prompt).not.toContain(WORKSPACE_LINE);
  });

  it("reaches the Session prompt with both scopes, or the User scope alone for a temporary Workspace", async () => {
    const agent = await createAgent({ root });
    const withWorkspace = await agent.createSession({ workspaceDir: workspace });
    const key = await workspaceMemoryKey(workspace);
    expect(sessionPrompt(withWorkspace)).toContain(
      memoryScopeDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, key),
    );
    expect(sessionPrompt(withWorkspace)).toContain(WORKSPACE_LINE);

    // No Workspace given: the SDK allocates a temporary one, which gets the User scope only.
    const temporary = await agent.createSession();
    expect(sessionPrompt(temporary)).toContain(
      userMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
    );
    expect(sessionPrompt(temporary)).not.toContain(WORKSPACE_LINE);
    expect(
      (await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).sort(),
    ).toEqual([USER_SCOPE_KEY, key].sort());
  });

  it("is left out of the Session prompt when the Agent config disables Memory", async () => {
    const agent = await createAgent({ root });
    agent.state.systemConfig.memory = { ...agent.state.systemConfig.memory, enabled: false };
    const session = await agent.createSession({ workspaceDir: workspace });
    expect(sessionPrompt(session)).not.toContain(USER_LINE);
    expect(sessionPrompt(session)).not.toContain(WORKSPACE_LINE);
    // No Workspace scope appears; only the User scope from Agent State init.
    expect(await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toEqual([
      USER_SCOPE_KEY,
    ]);
  });
});

describe("ensureUserMemoryDir", () => {
  it("creates the User scope directory with its index and leaves no .workspace marker", async () => {
    await agentState();
    const dir = await ensureUserMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(dir).toBe(userMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID));
    // The marker records the path a key was hashed from; this scope stands for no path.
    expect(await readWorkspaceMarker(dir)).toBeUndefined();
    // Idempotent: a second Session must not fail on an existing directory.
    await expect(ensureUserMemoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).resolves.toBe(
      dir,
    );
  });

  it("is a name no generated workspace key can collide with", async () => {
    // Every generated key is `<base>-<8 hex>`, so it always carries a hyphen.
    const key = workspaceMemoryKeyForRealPath("/home/dev/user");
    expect(key).not.toBe(USER_SCOPE_KEY);
    expect(key.startsWith(`${USER_SCOPE_KEY}-`)).toBe(true);
  });
});
