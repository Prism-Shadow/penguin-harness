/**
 * Memory: key derivation, temporary-Workspace exclusion, directory preparation, frontmatter
 * parsing, and the `{{MEMORY}}` prompt block (heading-led scope sections, the line and char
 * caps, the rendered Workspace dir, and the no-placeholder / no-workspace_prompt degradations).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { SystemConfig } from "../src/index.js";
import { systemConfigPath } from "../src/state/paths.js";
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
  it("reads name / description / updated_at", () => {
    const parsed = parseMemoryFrontmatter(
      "---\nname: testing-conventions\ndescription: how tests run\nupdated_at: 2026-08-07\n---\n\n- body\n",
      "testing-conventions.md",
    );
    expect(parsed).toEqual({
      name: "testing-conventions",
      description: "how tests run",
      updatedAt: "2026-08-07",
    });
  });

  it("falls back to the file name and ignores unknown fields, including a legacy type line", () => {
    const parsed = parseMemoryFrontmatter(
      "---\ntype: feedback\nmood: blue\n---\nbody\n",
      "notes.md",
    );
    expect(parsed).toEqual({ name: "notes.md", description: "" });
  });

  it("returns null when the file has no frontmatter", () => {
    expect(parseMemoryFrontmatter("just a note\n", "notes.md")).toBeNull();
  });
});

describe("{{MEMORY}} rendering", () => {
  /** Heading lines of each half of the block, so a test can assert which scopes were rendered. */
  const USER_LINE = "## User memory";
  const WORKSPACE_LINE = "## Workspace memory";

  const bothScopes: SessionMemory = {
    userDir: "/data/memory/user",
    userIndex: "- [pnpm](prefers-pnpm.md) — package manager",
    workspace: {
      key: "my-app-12345678",
      dir: "/data/memory/my-app-12345678",
      index: "- [testing](testing-conventions.md) — how tests run",
    },
  };

  it("renders both scopes as heading-led sections; the User dir stays literal, the Workspace dir is injected", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, bothScopes);
    // The User dir is a literal pattern the model resolves from Environment values; the
    // Workspace dir's key segment is a hash it never could, so that one renders resolved.
    expect(prompt).toContain(
      "User Memory Dir: `<app_data_dir>/agents/<agent_id>/agent_state/memory/user`",
    );
    expect(prompt).toContain("Workspace Memory Dir: `/data/memory/my-app-12345678`");
    expect(prompt).not.toContain("{{WORKSPACE_MEMORY_DIR}}");
    expect(prompt).toContain(`${USER_LINE}\n`);
    expect(prompt).toContain("Index:\n- [pnpm](prefers-pnpm.md) — package manager");
    expect(prompt).toContain(`${WORKSPACE_LINE}\n`);
    expect(prompt).toContain("Index:\n- [testing](testing-conventions.md) — how tests run");
    expect(prompt).not.toContain("{{MEMORY}}");
    expect(prompt).not.toContain(MEMORY_INDEX_EMPTY_NOTE);
    // The retired marker fences are gone — the headings are the structure.
    expect(prompt).not.toContain("[user_memory_index]");
    expect(prompt).not.toContain("[workspace_memory_index]");
  });

  it("renders the User half alone when the Session has no Workspace scope", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, {
      userDir: "/data/memory/user",
      userIndex: "",
    });
    expect(prompt).toContain(USER_LINE);
    // The Workspace half is a separate config key precisely so it can be left out entirely:
    // a temporary Workspace must never be told about a scope it does not have.
    expect(prompt).not.toContain(WORKSPACE_LINE);
    expect(prompt).not.toContain("Workspace Memory Dir");
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
    expect(prompt).toContain(`Index:\n${MEMORY_INDEX_EMPTY_NOTE}`);
    expect(prompt).toContain("Index:\n- [pnpm](prefers-pnpm.md) — package manager");
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

  it("caps an injected index at 25k characters, cutting at a line boundary", async () => {
    const state = await agentState();
    // 10 lines of exactly 5,000 chars slip past the line cap; the char backstop keeps the
    // first 4 whole lines (4 × 5,000 + 3 separators = 20,003; a fifth would need 25,004).
    const lines = Array.from({ length: 10 }, (_, i) => `- [m${i}](m${i}.md) ${"x".repeat(4986)}`);
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, {
      userDir: "/data/memory/user",
      userIndex: lines.join("\n"),
    });
    expect(prompt).toContain("- [m3](m3.md) x");
    expect(prompt).not.toContain("- [m4](m4.md) x");
    expect(prompt).toContain("showing 4 of 10 lines");
  });

  it("cuts mid-line only when a single line alone exceeds the char cap", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, undefined, undefined, {
      userDir: "/data/memory/user",
      userIndex: `- [huge](huge.md) ${"y".repeat(30_000)}`,
    });
    expect(prompt).toContain("showing the first 25000 characters");
  });

  it("injects nothing at all when the Session has no Memory", async () => {
    const state = await agentState();
    // Skill data provided (an empty list) so the neighboring {{SKILLS}} section renders and
    // proves it is untouched by Memory's absence.
    const prompt = assembleSystemPrompt(state, undefined, undefined, []);
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

  it("falls back to the built-in prompts for a config that predates Memory", async () => {
    const state = await agentState();
    const { memory: _memory, ...withoutMemory } = state.systemConfig;
    const legacy: AgentState = { ...state, systemConfig: withoutMemory };
    // The DTO reports the defaults as effective; rendering must agree, or the one-click
    // placeholder insert on an old agent would enable a block that expands to nothing.
    const prompt = assembleSystemPrompt(legacy, undefined, undefined, undefined, bothScopes);
    expect(prompt).toContain("# Memory");
    expect(prompt).toContain(USER_LINE);
    expect(prompt).toContain(WORKSPACE_LINE);
  });

  it("resolves the workspace placeholders anywhere in the block instead of leaking them", async () => {
    const state = await agentState();
    const custom: AgentState = {
      ...state,
      systemConfig: {
        ...state.systemConfig,
        memory: {
          enabled: true,
          prompt: "P {{WORKSPACE_MEMORY_INDEX}} Q {{WORKSPACE_MEMORY_DIR}} R",
          workspace_prompt: "",
        },
      },
    };
    // In a persistent Workspace a workspace token written into the main prompt gets the value…
    const withWorkspace = assembleSystemPrompt(custom, undefined, undefined, undefined, bothScopes);
    expect(withWorkspace).toContain("P - [testing](testing-conventions.md) — how tests run Q");
    expect(withWorkspace).toContain("Q /data/memory/my-app-12345678 R");
    // …and without one it blanks rather than leaking the literal token.
    const without = assembleSystemPrompt(custom, undefined, undefined, undefined, {
      userDir: "/data/memory/user",
      userIndex: "",
    });
    expect(without).not.toContain("{{WORKSPACE_MEMORY_INDEX}}");
    expect(without).not.toContain("{{WORKSPACE_MEMORY_DIR}}");
  });

  it("never re-expands template placeholders smuggled into index content", async () => {
    const state = await agentState();
    const prompt = assembleSystemPrompt(state, undefined, ["SOME_KEY"], undefined, {
      userDir: "/data/memory/user",
      userIndex: "- [x](x.md) — {{VAULT_KEYS}} {{SESSION_ID}}",
    });
    // {{MEMORY}} expands last, so the template tokens the model wrote stay literal text.
    expect(prompt).toContain("- [x](x.md) — {{VAULT_KEYS}} {{SESSION_ID}}");
  });

  it("keeps the Workspace half when the main prompt is explicitly emptied", async () => {
    const state = await agentState();
    const emptied: AgentState = {
      ...state,
      systemConfig: {
        ...state.systemConfig,
        memory: { ...state.systemConfig.memory, prompt: "" },
      },
    };
    // The halves are edited independently on the Memory tab: clearing one never silences the
    // other — the Workspace section still renders on its own with its index.
    const prompt = assembleSystemPrompt(emptied, undefined, undefined, undefined, bothScopes);
    expect(prompt).not.toContain(USER_LINE);
    expect(prompt).toContain(WORKSPACE_LINE);
    expect(prompt).toContain("Index:\n- [testing](testing-conventions.md) — how tests run");
  });

  it("drops the Workspace half only for an explicitly emptied workspace_prompt", async () => {
    const state = await agentState();
    const emptied: AgentState = {
      ...state,
      systemConfig: {
        ...state.systemConfig,
        memory: { ...state.systemConfig.memory, workspace_prompt: "" },
      },
    };
    // A missing key falls back to the built-in default (see the legacy-config test above);
    // clearing the field is the deliberate off channel — `??`, not `||`.
    const prompt = assembleSystemPrompt(emptied, undefined, undefined, undefined, bothScopes);
    expect(prompt).toContain(USER_LINE);
    expect(prompt).not.toContain(WORKSPACE_LINE);
  });

  it("reaches the Session prompt with both scopes, or the User scope alone for a temporary Workspace", async () => {
    const agent = await createAgent({ root });
    const withWorkspace = await agent.createSession({ workspaceDir: workspace });
    const key = await workspaceMemoryKey(workspace);
    expect(sessionPrompt(withWorkspace)).toContain(
      `Workspace Memory Dir: \`${memoryScopeDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, key)}\``,
    );
    expect(sessionPrompt(withWorkspace)).toContain(WORKSPACE_LINE);

    // No Workspace given: the SDK allocates a temporary one, which gets the User scope only —
    // the User directory renders as the literal pattern, and no Workspace section appears.
    const temporary = await agent.createSession();
    expect(sessionPrompt(temporary)).toContain(
      "User Memory Dir: `<app_data_dir>/agents/<agent_id>/agent_state/memory/user`",
    );
    expect(sessionPrompt(temporary)).not.toContain(WORKSPACE_LINE);
    expect(
      (await fs.readdir(memoryDir(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).sort(),
    ).toEqual([USER_SCOPE_KEY, key].sort());
  });

  it("is left out of the Session prompt when the Agent config disables Memory", async () => {
    const agent = await createAgent({ root });
    // On disk: a Session's context is assembled from the Agent State as it is on disk, never
    // from the Agent object's load-time snapshot.
    const configFile = systemConfigPath(root, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    const cfg = parseYaml(await fs.readFile(configFile, "utf8")) as SystemConfig;
    cfg.memory = { ...cfg.memory, enabled: false };
    await fs.writeFile(configFile, stringifyYaml(cfg), "utf8");
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
