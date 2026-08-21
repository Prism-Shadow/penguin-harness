/**
 * Integration tests for the Memory routes (agent_state/memory/): the overview reports the
 * Agent-level switch and one entry per scope (user scope first), topic files can be listed /
 * read / deleted, deleting a file prunes its index lines, path traversal in a scope key or
 * file name is rejected, the switch round-trips through the Agent config without touching any
 * file, and non-members see 404.
 *
 * A second suite covers whole-scope transfer: what an export carries, each branch of the import
 * collision policy (skip / overwrite / replace, and when a confirmation is required), every
 * rejection on that untrusted write path, and the owner gate on import.
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
  MemoryImportMode,
  MemoryImportResponse,
  MemoryOverviewResponse,
  MemoryScopeExport,
  MemoryTransferFile,
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

describe("memory scope export/import", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let memoryPath: string;
  let wsDir: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-transfer", name: "transfer" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
    memoryPath = `/api/projects/${projectId}/agents/default_agent/memory`;
    wsDir = memoryScopeDir(t.root, projectId, "default_agent", WORKSPACE_KEY);
    await fs.mkdir(wsDir, { recursive: true });
    await fs.writeFile(path.join(wsDir, ".workspace"), "/home/dev/my-app\n", "utf8");
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const exportPath = (key = WORKSPACE_KEY) => `${memoryPath}/scopes/${key}/export`;
  const importPath = (key = WORKSPACE_KEY) => `${memoryPath}/scopes/${key}/import`;

  /** A transfer document carrying the given files; its index links each of them unless one is given. */
  const document = (files: MemoryTransferFile[], index?: string | null): MemoryScopeExport => ({
    format: "penguin-memory-scope",
    version: 1,
    scopeKey: WORKSPACE_KEY,
    kind: "workspace",
    exportedAt: "2026-08-20T00:00:00.000Z",
    index:
      index === undefined
        ? `# Memories\n\n${files.map((f) => `- [${f.name}](${f.name}) — imported`).join("\n")}\n`
        : index,
    files,
  });

  const topic = (name: string, body: string): MemoryTransferFile => ({
    name,
    content: `---\nname: ${name}\n---\n${body}\n`,
  });

  const runImport = async (
    payload: unknown,
    opts: { mode?: MemoryImportMode; confirm?: boolean; key?: string } = {},
  ) =>
    owner.post(importPath(opts.key), {
      payload,
      ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
      ...(opts.confirm !== undefined ? { confirm: opts.confirm } : {}),
    });

  const namesOnDisk = async (): Promise<string[]> =>
    (await fs.readdir(wsDir))
      .filter((n) => n.endsWith(".md") && n !== MEMORY_INDEX_FILENAME)
      .sort();

  const readIndex = (): Promise<string> =>
    fs.readFile(path.join(wsDir, MEMORY_INDEX_FILENAME), "utf8");

  it("exports every topic file plus the scope's index, as one attachment", async () => {
    await fs.writeFile(path.join(wsDir, "testing-conventions.md"), TOPIC, "utf8");
    await fs.writeFile(path.join(wsDir, "项目背景.md"), "---\nname: 项目背景\n---\n正文\n", "utf8");
    await fs.writeFile(path.join(wsDir, MEMORY_INDEX_FILENAME), "- [t](t.md) — hook\n", "utf8");

    const res = await owner.get(exportPath());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(
      new RegExp(`filename="default_agent-${WORKSPACE_KEY}-memory-\\d{8}-\\d{4}\\.json"`),
    );
    const doc = (await res.json()) as MemoryScopeExport;
    expect(doc.format).toBe("penguin-memory-scope");
    expect(doc.version).toBe(1);
    expect(doc.kind).toBe("workspace");
    expect(doc.workspacePath).toBe("/home/dev/my-app");
    // The index travels with the files: only the index enters the model's context.
    expect(doc.index).toBe("- [t](t.md) — hook\n");
    expect(doc.files.map((f) => f.name)).toEqual(["testing-conventions.md", "项目背景.md"]);
    expect(doc.files[0]?.content).toBe(TOPIC);
    // The .workspace marker is the Harness's, not a memory.
    expect(doc.files.map((f) => f.name)).not.toContain(".workspace");
  });

  it("exports the user scope, creating it on demand, with no workspace path", async () => {
    const doc = (await (await owner.get(exportPath(USER_SCOPE_KEY))).json()) as MemoryScopeExport;
    expect(doc.kind).toBe("user");
    expect(doc.workspacePath).toBeUndefined();
    // A provisioned Agent starts with an empty user index on disk, so the document carries an
    // empty string; null is reserved for a scope that has no MEMORY.md at all — as this
    // Workspace scope, created by hand above, does not.
    expect(doc.index).toBe("");
    expect(doc.files).toEqual([]);
    expect(((await (await owner.get(exportPath())).json()) as MemoryScopeExport).index).toBeNull();
  });

  it("round-trips one scope's export into another scope", async () => {
    await fs.writeFile(path.join(wsDir, "testing-conventions.md"), TOPIC, "utf8");
    await fs.writeFile(path.join(wsDir, MEMORY_INDEX_FILENAME), "- [T](testing-conventions.md)\n");
    const doc = (await (await owner.get(exportPath())).json()) as MemoryScopeExport;

    const res = await runImport(doc, { key: USER_SCOPE_KEY });
    expect(res.status).toBe(200);
    expect((await res.json()) as MemoryImportResponse).toMatchObject({
      scopeKey: USER_SCOPE_KEY,
      mode: "skip",
      added: ["testing-conventions.md"],
      indexWritten: true,
    });
    const userDir = memoryScopeDir(t.root, projectId, "default_agent", USER_SCOPE_KEY);
    expect(await fs.readFile(path.join(userDir, "testing-conventions.md"), "utf8")).toBe(TOPIC);
    expect(await fs.readFile(path.join(userDir, MEMORY_INDEX_FILENAME), "utf8")).toBe(
      "- [T](testing-conventions.md)\n",
    );
  });

  // —— The collision policy, branch by branch ——

  it("defaults to skip: an existing memory is kept and the newcomer is indexed beside it", async () => {
    await fs.writeFile(path.join(wsDir, "keep.md"), "on disk\n", "utf8");
    await fs.writeFile(path.join(wsDir, MEMORY_INDEX_FILENAME), "- [Keep](keep.md) — mine\n");

    const res = await runImport(
      document([topic("keep.md", "from the file"), topic("new.md", "n")]),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as MemoryImportResponse;
    expect(body).toMatchObject({ mode: "skip", added: ["new.md"], skipped: ["keep.md"] });
    expect(body.overwritten).toEqual([]);
    expect(body.removed).toEqual([]);
    // Nothing was lost: the file on disk is untouched.
    expect(await fs.readFile(path.join(wsDir, "keep.md"), "utf8")).toBe("on disk\n");
    // The index keeps its own line and gains one for the file that arrived — an unindexed
    // memory would be one the Agent never reads.
    const index = await readIndex();
    expect(index).toContain("- [Keep](keep.md) — mine");
    expect(index).toContain("- [new.md](new.md) — imported");
    expect(body.indexWritten).toBe(true);
  });

  it("refuses overwrite and replace without confirmation, naming what would be lost", async () => {
    await fs.writeFile(path.join(wsDir, "keep.md"), "on disk\n", "utf8");
    const doc = document([topic("keep.md", "from the file")]);

    for (const mode of ["overwrite", "replace"] as const) {
      const res = await runImport(doc, { mode });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("memory_import_confirm_required");
      expect(body.error.message).toContain("overwrite 1");
    }
    expect(await fs.readFile(path.join(wsDir, "keep.md"), "utf8")).toBe("on disk\n");
  });

  it("overwrites same-named memories on confirmation and leaves the rest alone", async () => {
    await fs.writeFile(path.join(wsDir, "keep.md"), "on disk\n", "utf8");
    await fs.writeFile(path.join(wsDir, "untouched.md"), "not in the document\n", "utf8");

    const res = await runImport(document([topic("keep.md", "from the file")]), {
      mode: "overwrite",
      confirm: true,
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as MemoryImportResponse).toMatchObject({
      mode: "overwrite",
      added: [],
      overwritten: ["keep.md"],
      removed: [],
    });
    expect(await fs.readFile(path.join(wsDir, "keep.md"), "utf8")).toContain("from the file");
    // overwrite is a merge: a memory the document does not carry survives.
    expect(await namesOnDisk()).toEqual(["keep.md", "untouched.md"]);
  });

  it("replaces the whole scope on confirmation, deleting what the document does not carry", async () => {
    await fs.writeFile(path.join(wsDir, "keep.md"), "on disk\n", "utf8");
    await fs.writeFile(path.join(wsDir, "gone.md"), "not in the document\n", "utf8");
    await fs.writeFile(
      path.join(wsDir, MEMORY_INDEX_FILENAME),
      "- [Keep](keep.md) — mine\n- [Gone](gone.md) — mine\n",
      "utf8",
    );

    const res = await runImport(document([topic("keep.md", "from the file")]), {
      mode: "replace",
      confirm: true,
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as MemoryImportResponse).toMatchObject({
      mode: "replace",
      overwritten: ["keep.md"],
      removed: ["gone.md"],
      indexWritten: true,
    });
    expect(await namesOnDisk()).toEqual(["keep.md"]);
    // The document's index replaces the old one wholesale; no line survives for a deleted file.
    const index = await readIndex();
    expect(index).toContain("- [keep.md](keep.md) — imported");
    expect(index).not.toContain("gone.md");
  });

  it("prunes the index of a replace whose document carries none", async () => {
    await fs.writeFile(path.join(wsDir, "gone.md"), "x\n", "utf8");
    await fs.writeFile(path.join(wsDir, MEMORY_INDEX_FILENAME), "- [Gone](gone.md) — mine\n");

    const res = await runImport(document([topic("new.md", "n")], null), {
      mode: "replace",
      confirm: true,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MemoryImportResponse).removed).toEqual(["gone.md"]);
    expect(await readIndex()).not.toContain("gone.md");
  });

  it("needs no confirmation for a destructive mode that would destroy nothing", async () => {
    // The gate is what the import would actually cost, not the mode's name: an empty scope
    // loses nothing either way, and a confirmation naming nothing is just a click.
    const res = await runImport(document([topic("new.md", "n")]), { mode: "replace" });
    expect(res.status).toBe(200);
    expect((await res.json()) as MemoryImportResponse).toMatchObject({
      added: ["new.md"],
      removed: [],
      overwritten: [],
    });
  });

  // —— Rejections on the untrusted write path ——

  /** The NUL byte, built rather than typed: an invisible byte in a source file is nobody's friend. */
  const NUL = String.fromCharCode(0);

  /** Posts a document (or a whole raw body) that must be refused with 400, having written nothing. */
  const rejects = async (files: unknown, hint: string): Promise<void> => {
    const res = await runImport(
      Array.isArray(files) ? document(files as MemoryTransferFile[]) : files,
    );
    expect(res.status, hint).toBe(400);
  };

  it("rejects a name that is a path, climbs out, or is not a topic file", async () => {
    const outside = path.join(t.root, "outside-target.md");
    await rejects([topic("../escape.md", "x")], "parent traversal");
    await rejects([topic("..\\escape.md", "x")], "windows traversal");
    await rejects([topic("sub/notes.md", "x")], "nested path");
    await rejects([topic(outside, "x")], "absolute path");
    await rejects([topic(MEMORY_INDEX_FILENAME, "x")], "the index is not a topic file");
    await rejects([topic("memory.md", "x")], "the index under another casing");
    await rejects([topic("notes.txt", "x")], "not markdown");
    await rejects([topic(".workspace", "x")], "the workspace marker");
    await rejects([topic("", "x")], "empty name");
    await rejects([topic(`bad${NUL}.md`, "x")], "NUL in the name");
    // Not one of them reached the filesystem, inside the scope or out.
    expect(await namesOnDisk()).toEqual([]);
    await expect(fs.stat(outside)).rejects.toThrow();
  });

  it("writes nothing at all when one entry in the document is bad", async () => {
    const res = await runImport(document([topic("fine.md", "ok"), topic("../escape.md", "x")]));
    expect(res.status).toBe(400);
    expect(await namesOnDisk()).toEqual([]);
  });

  it("rejects entries that are not text", async () => {
    await rejects([{ name: "n.md", content: 42 }], "number content");
    await rejects([{ name: "n.md", content: { body: "x" } }], "object content");
    await rejects([{ name: "n.md" }], "missing content");
    await rejects([{ name: 7, content: "x" }], "non-string name");
    await rejects(["n.md"], "entry is not an object");
    await rejects([{ name: "n.md", content: `binary${NUL}payload` }], "NUL in the content");
    await rejects({ ...document([topic("n.md", "x")]), index: 5 }, "non-string index");
    expect(await namesOnDisk()).toEqual([]);
  });

  it("rejects absurd counts and sizes", async () => {
    await rejects(
      Array.from({ length: 501 }, (_, i) => topic(`m${i}.md`, "x")),
      "too many entries",
    );
    await rejects([{ name: "huge.md", content: "x".repeat(512 * 1024 + 1) }], "one oversized file");
    // Longer than a path component may be: the write would fail with ENAMETOOLONG, which is a
    // 500 for what is plainly a bad request.
    await rejects([topic(`${"a".repeat(253)}.md`, "x")], "an oversized name");
    // Individually legal, together over the whole-document budget.
    const half = "y".repeat(512 * 1024);
    await rejects(
      Array.from({ length: 17 }, (_, i) => ({ name: `big${i}.md`, content: half })),
      "over the total budget",
    );
    expect(await namesOnDisk()).toEqual([]);
  });

  it("rejects a foreign or future document, and a body with no document at all", async () => {
    await rejects({ ...document([]), format: "some-other-tool" }, "foreign format");
    await rejects({ ...document([]), version: 2 }, "future version");
    await rejects({ ...document([]), files: "not-an-array" }, "files is not an array");
    await rejects([topic("a.md", "1"), topic("a.md", "2")], "the same name twice");
    expect((await owner.post(importPath(), {})).status).toBe(400);
    expect((await owner.post(importPath(), { payload: "text" })).status).toBe(400);
    expect((await owner.post(importPath(), { payload: document([]), mode: "wipe" })).status).toBe(
      400,
    );
  });

  it("replaces a symlink standing at a memory's name instead of writing through it", async () => {
    const outside = path.join(t.root, "outside-secret.md");
    await fs.writeFile(outside, "secret\n", "utf8");
    await fs.symlink(outside, path.join(wsDir, "leak.md"));

    const res = await runImport(document([topic("leak.md", "imported body")]), {
      mode: "overwrite",
      confirm: true,
    });
    expect(res.status).toBe(200);
    // The link is gone, the memory is a real file inside the scope, and the file it pointed at
    // never saw the write.
    expect((await fs.lstat(path.join(wsDir, "leak.md"))).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(wsDir, "leak.md"), "utf8")).toContain("imported body");
    expect(await fs.readFile(outside, "utf8")).toBe("secret\n");
  });

  it("leaves no temporary file behind in the scope directory", async () => {
    expect((await runImport(document([topic("a.md", "x")]))).status).toBe(200);
    expect((await fs.readdir(wsDir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects a bad scope key and a scope smuggled in as a symlink, on both routes", async () => {
    expect((await owner.get(exportPath("..%2Fescape"))).status).toBe(400);
    expect((await runImport(document([]), { key: "..%2Fescape" })).status).toBe(400);
    expect((await owner.get(exportPath("never-run-0badc0de"))).status).toBe(404);
    expect((await runImport(document([]), { key: "never-run-0badc0de" })).status).toBe(404);

    const outside = path.join(t.root, "outside-dir");
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, memoryScopeDir(t.root, projectId, "default_agent", "evil-12345678"));
    expect((await owner.get(exportPath("evil-12345678"))).status).toBe(404);
    expect((await runImport(document([topic("a.md", "x")]), { key: "evil-12345678" })).status).toBe(
      404,
    );
    expect(await fs.readdir(outside)).toEqual([]);
  });

  // —— Authorization ——

  it("lets any member export but only the owner import", async () => {
    await fs.writeFile(path.join(wsDir, "testing-conventions.md"), TOPIC, "utf8");
    // Export is reading Agent State, which every Project member may already do file by file.
    expect((await member.get(exportPath())).status).toBe(200);
    // Import can cost the Agent memories, so it follows the Agent State snapshot's owner gate.
    const denied = await member.post(importPath(), { payload: document([topic("a.md", "x")]) });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe(
      "owner_required",
    );
    expect(await namesOnDisk()).toEqual(["testing-conventions.md"]);
  });

  it("404s both routes for a non-member, without leaking that the scope exists", async () => {
    expect((await outsider.get(exportPath())).status).toBe(404);
    const res = await outsider.post(importPath(), { payload: document([topic("a.md", "x")]) });
    expect(res.status).toBe(404);
    expect(await namesOnDisk()).toEqual([]);
  });
});
