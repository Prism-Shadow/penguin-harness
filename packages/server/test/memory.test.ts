/**
 * Integration tests for the Memory routes (agent_state/memory/): the overview reports the
 * Agent-level switch and one entry per scope (user scope first), topic files can be listed /
 * read / deleted, deleting a file prunes its index lines, path traversal in a scope key or
 * file name is rejected, the switch round-trips through the Agent config without touching any
 * file, and non-members see 404.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEMORY_INDEX_FILENAME,
  USER_SCOPE_KEY,
  memoryDir,
  memoryScopeDir,
} from "@prismshadow/penguin-core";
import type {
  AgentConfigResponse,
  MemoryFileResponse,
  MemoryFilesResponse,
  MemoryOverviewResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const WORKSPACE_KEY = "my-app-a81f32c4";
// The `type:` line is the retired field earlier files may still carry — listing must ignore it.
const TOPIC = `---
name: testing-conventions
description: how tests are run here
type: feedback
updated_at: 2026-08-07
---

- Integration tests talk to a real database.
`;

describe("memory api", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let memoryPath: string;
  let configPath: string;
  /** The Workspace Memory directory a Session would have created. */
  let wsDir: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-memory", name: "memory project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    memoryPath = `/api/projects/${projectId}/agents/default_agent/memory`;
    configPath = `/api/projects/${projectId}/agents/default_agent/config`;
    wsDir = memoryScopeDir(t.root, projectId, "default_agent", WORKSPACE_KEY);
    await fs.mkdir(wsDir, { recursive: true });
    await fs.writeFile(path.join(wsDir, ".workspace"), "/home/dev/my-app\n", "utf8");
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const filesPath = (key = WORKSPACE_KEY) => `${memoryPath}/scopes/${key}/files`;

  it("overview reports the switch, the user scope, and one entry per Workspace", async () => {
    await fs.writeFile(path.join(wsDir, "testing-conventions.md"), TOPIC, "utf8");

    const body = (await (await owner.get(memoryPath)).json()) as MemoryOverviewResponse;
    expect(body.enabled).toBe(true);
    // A freshly created Agent gets the current default template, which carries {{MEMORY}}.
    expect(body.templateHasMemory).toBe(true);
    expect(body.memoryDir).toBe(memoryDir(t.root, projectId, "default_agent"));
    expect(body.scopes).toHaveLength(2);
    // The user scope leads the list (default_agent was initialized with it on disk).
    expect(body.scopes[0]).toMatchObject({
      scopeKey: USER_SCOPE_KEY,
      kind: "user",
      fileCount: 0,
    });
    expect(body.scopes[0]?.workspacePath).toBeUndefined();
    expect(body.scopes[1]).toMatchObject({
      scopeKey: WORKSPACE_KEY,
      kind: "workspace",
      workspacePath: "/home/dev/my-app",
      fileCount: 1,
    });
    expect(body.scopes[1]?.updatedAt).toBeTruthy();
  });

  it("does not count a scope's MEMORY.md index as a topic file", async () => {
    await fs.writeFile(path.join(wsDir, MEMORY_INDEX_FILENAME), "- [t](t.md) — hook\n", "utf8");
    const list = (await (await owner.get(filesPath())).json()) as MemoryFilesResponse;
    expect(list.files).toHaveLength(0);
    // Nor can the index be fetched or deleted as a topic file — under any casing, since
    // macOS/Windows resolve memory.md to MEMORY.md.
    expect((await owner.get(`${filesPath()}/${MEMORY_INDEX_FILENAME}`)).status).toBe(400);
    expect((await owner.delete(`${filesPath()}/${MEMORY_INDEX_FILENAME}`)).status).toBe(400);
    expect((await owner.get(`${filesPath()}/memory.md`)).status).toBe(400);
    expect((await owner.delete(`${filesPath()}/Memory.Md`)).status).toBe(400);
  });

  it("accepts a workspace key starting with an underscore, as core generates for _site-style directories", async () => {
    const key = "_site-1a2b3c4d";
    const dir = memoryScopeDir(t.root, projectId, "default_agent", key);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "notes.md"), "---\nname: n\n---\nbody\n", "utf8");
    const list = (await (await owner.get(filesPath(key))).json()) as MemoryFilesResponse;
    expect(list.files.map((f) => f.name)).toEqual(["notes.md"]);
  });

  it("lists, reads and deletes a non-ASCII topic file the model wrote", async () => {
    const name = "项目背景.md";
    await fs.writeFile(path.join(wsDir, name), "---\nname: 项目背景\n---\n正文\n", "utf8");
    const list = (await (await owner.get(filesPath())).json()) as MemoryFilesResponse;
    expect(list.files.map((f) => f.name)).toContain(name);
    const encoded = `${filesPath()}/${encodeURIComponent(name)}`;
    expect((await owner.get(encoded)).status).toBe(200);
    expect((await owner.delete(encoded)).status).toBe(204);
    expect(await fs.readdir(wsDir)).not.toContain(name);
  });

  it("neither lists nor follows a symlinked topic file", async () => {
    const outside = path.join(t.root, "outside-secret.txt");
    await fs.writeFile(outside, "secret", "utf8");
    await fs.symlink(outside, path.join(wsDir, "leak.md"));
    const list = (await (await owner.get(filesPath())).json()) as MemoryFilesResponse;
    expect(list.files.map((f) => f.name)).not.toContain("leak.md");
    // Direct addressing must not follow the link either.
    expect((await owner.get(`${filesPath()}/leak.md`)).status).toBe(404);
  });

  it("404s a scope directory smuggled in as a symlink", async () => {
    const outside = path.join(t.root, "outside-dir");
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "loot.md"), "---\nname: l\n---\nx\n", "utf8");
    await fs.symlink(outside, memoryScopeDir(t.root, projectId, "default_agent", "evil-12345678"));
    expect((await owner.get(filesPath("evil-12345678"))).status).toBe(404);
  });

  it("lists the user scope of an Agent that predates Memory, creating it on demand", async () => {
    // A Workspace directory comes from a Session, but the user scope belongs to the Agent.
    await fs.rm(memoryScopeDir(t.root, projectId, "default_agent", USER_SCOPE_KEY), {
      recursive: true,
      force: true,
    });
    const list = (await (await owner.get(filesPath(USER_SCOPE_KEY))).json()) as MemoryFilesResponse;
    expect(list.files).toHaveLength(0);
    await expect(
      fs.stat(memoryScopeDir(t.root, projectId, "default_agent", USER_SCOPE_KEY)),
    ).resolves.toBeTruthy();
  });

  it("still 404s a Workspace key with no directory, so only the user scope is auto-created", async () => {
    const res = await owner.get(filesPath("never-run-0badc0de"));
    expect(res.status).toBe(404);
  });

  it("lists and reads topic files with their frontmatter, ignoring the .workspace marker", async () => {
    await fs.writeFile(path.join(wsDir, "testing-conventions.md"), TOPIC, "utf8");

    const list = (await (await owner.get(filesPath())).json()) as MemoryFilesResponse;
    expect(list.files).toHaveLength(1);
    expect(list.files[0]).toMatchObject({
      name: "testing-conventions.md",
      title: "testing-conventions",
      description: "how tests are run here",
      updatedAt: "2026-08-07",
    });
    // The retired type field stays out of the DTO even when the file still declares it.
    expect(list.files[0]).not.toHaveProperty("type");

    const read = (await (
      await owner.get(`${filesPath()}/testing-conventions.md`)
    ).json()) as MemoryFileResponse;
    expect(read.content).toBe(TOPIC);
  });

  it("deletes a topic file and prunes its index lines, leaving other lines alone", async () => {
    await fs.writeFile(path.join(wsDir, "testing-conventions.md"), TOPIC, "utf8");
    await fs.writeFile(path.join(wsDir, "release-process.md"), "---\nname: r\n---\nbody\n", "utf8");
    await fs.writeFile(
      path.join(wsDir, MEMORY_INDEX_FILENAME),
      "- [Testing](./testing-conventions.md) — how tests are run here\n" +
        "- [Release](release-process.md) — release steps\n" +
        "Prose mentioning testing-conventions.md survives.\n",
      "utf8",
    );

    expect((await owner.delete(`${filesPath()}/testing-conventions.md`)).status).toBe(204);
    expect(await fs.readdir(wsDir)).not.toContain("testing-conventions.md");
    const index = await fs.readFile(path.join(wsDir, MEMORY_INDEX_FILENAME), "utf8");
    expect(index).not.toContain("](testing-conventions.md)");
    expect(index).toContain("- [Release](release-process.md) — release steps");
    // A plain-prose mention is not a link to the file; the mechanical edit leaves it be.
    expect(index).toContain("Prose mentioning testing-conventions.md survives.");

    expect((await owner.delete(`${filesPath()}/testing-conventions.md`)).status).toBe(404);
  });

  it("rejects traversal and non-Markdown names, and an unknown Workspace", async () => {
    // A key or file name that could climb out of the Memory directory never reaches the filesystem
    // (the separator is percent-encoded, so it arrives as one path segment and is ours to reject).
    expect((await owner.get(filesPath("..%2Fescape"))).status).toBe(400);
    expect((await owner.get(`${filesPath()}/..%2Fescape.md`)).status).toBe(400);
    expect((await owner.get(`${filesPath()}/notes.txt`)).status).toBe(400);
    expect((await owner.delete(`${filesPath()}/.workspace`)).status).toBe(400);
    expect((await owner.get(filesPath("never-seen-0badc0de"))).status).toBe(404);
  });

  it("toggles the Agent-level switch through the config route without touching any file", async () => {
    await fs.writeFile(path.join(wsDir, "testing-conventions.md"), TOPIC, "utf8");

    const off = await owner.put(configPath, { config: { memory: { enabled: false } } });
    expect(off.status).toBe(200);
    expect(((await off.json()) as AgentConfigResponse).config.memory.enabled).toBe(false);

    // Turning Memory off keeps the files and the management API working; it only stops Memory
    // from reaching the model's context.
    const body = (await (await owner.get(memoryPath)).json()) as MemoryOverviewResponse;
    expect(body.enabled).toBe(false);
    expect(body.scopes.find((s) => s.scopeKey === WORKSPACE_KEY)?.fileCount).toBe(1);

    const on = await owner.put(configPath, { config: { memory: { enabled: true } } });
    expect(((await on.json()) as AgentConfigResponse).config.memory.enabled).toBe(true);
  });

  it("reports a template without the {{MEMORY}} placeholder and inserts it on request", async () => {
    // Simulate an Agent from before Memory: replace the template with one lacking the placeholder.
    const put = await owner.put(configPath, {
      config: { systemPrompt: "# Role\nDo things.\n# Environment" },
    });
    expect(put.status).toBe(200);
    let body = (await (await owner.get(memoryPath)).json()) as MemoryOverviewResponse;
    expect(body.templateHasMemory).toBe(false);

    const inserted = await owner.post(`${memoryPath}/template-placeholder`, {});
    expect(inserted.status).toBe(200);
    body = (await inserted.json()) as MemoryOverviewResponse;
    expect(body.templateHasMemory).toBe(true);

    const cfg = (await (await owner.get(configPath)).json()) as AgentConfigResponse;
    // Inserted at the position the default template gives it: before # Environment.
    expect(cfg.config.systemPrompt.indexOf("{{MEMORY}}")).toBeGreaterThan(-1);
    expect(cfg.config.systemPrompt.indexOf("{{MEMORY}}")).toBeLessThan(
      cfg.config.systemPrompt.indexOf("# Environment"),
    );

    // Idempotent: a second call changes nothing and still succeeds.
    const again = await owner.post(`${memoryPath}/template-placeholder`, {});
    expect(again.status).toBe(200);
    const cfgAgain = (await (await owner.get(configPath)).json()) as AgentConfigResponse;
    expect(cfgAgain.config.systemPrompt).toBe(cfg.config.systemPrompt);
  });

  it("round-trips the memory prompts through the config route, reporting defaults until set", async () => {
    const before = (await (await owner.get(configPath)).json()) as AgentConfigResponse;
    // A fresh default agent stores the built-in prompts in its own yaml.
    expect(before.config.memory.prompt).toContain("{{USER_MEMORY_INDEX}}");
    expect(before.config.memory.workspacePrompt).toContain("## Workspace memory");

    const put = await owner.put(configPath, {
      config: { memory: { prompt: "# Memory\ncustom {{USER_MEMORY_INDEX}}" } },
    });
    expect(put.status).toBe(200);
    const after = (await put.json()) as AgentConfigResponse;
    expect(after.config.memory.prompt).toBe("# Memory\ncustom {{USER_MEMORY_INDEX}}");
    // The untouched half keeps its value.
    expect(after.config.memory.workspacePrompt).toContain("## Workspace memory");
  });

  it("reports the memory count on the Agent list, summed across scopes minus the indexes", async () => {
    await fs.writeFile(path.join(wsDir, "testing-conventions.md"), TOPIC, "utf8");
    await fs.writeFile(path.join(wsDir, MEMORY_INDEX_FILENAME), "- [t](t.md) — hook\n", "utf8");
    const userDir = memoryScopeDir(t.root, projectId, "default_agent", USER_SCOPE_KEY);
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(path.join(userDir, "prefers-pnpm.md"), "---\nname: p\n---\nx\n", "utf8");

    const body = (await (await owner.get(`/api/projects/${projectId}/agents`)).json()) as {
      agents: { agentId: string; memoryCount: number }[];
    };
    const agent = body.agents.find((a) => a.agentId === "default_agent");
    expect(agent?.memoryCount).toBe(2);
  });

  it("404s for a non-member on every Memory route", async () => {
    expect((await outsider.get(memoryPath)).status).toBe(404);
    expect((await outsider.post(`${memoryPath}/template-placeholder`, {})).status).toBe(404);
    expect((await outsider.get(filesPath())).status).toBe(404);
    expect((await outsider.get(`${filesPath()}/x.md`)).status).toBe(404);
    expect((await outsider.delete(`${filesPath()}/x.md`)).status).toBe(404);
  });
});
