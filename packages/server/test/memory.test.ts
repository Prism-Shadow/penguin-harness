/**
 * The Memory routes (agent_state/memory/).
 *
 * Reading and curating:
 * - The overview reports the Agent-level switch and one entry per scope, the user scope first
 *   (created on demand for an Agent that predates Memory; a Workspace key with no directory is
 *   still a 404), accepting a key that starts with an underscore.
 * - Topic files are listed and read with their frontmatter (the `.workspace` marker and the
 *   MEMORY.md index are not topic files, under any casing), a non-ASCII one included; deleting
 *   one prunes its index lines and leaves the others; traversal, non-Markdown names, a symlinked
 *   topic file or scope and an unknown Workspace are refused.
 * - The switch and the memory prompts round-trip through the Agent config without touching a
 *   file; a template missing the {{MEMORY}} placeholder is reported and fixed on request; the
 *   Agent list counts memories across scopes minus the indexes.
 * - A non-member gets 404 on every route.
 *
 * The files a topic keeps (`<topic>/` beside `<topic>.md`, any depth):
 * - A topic lists with the files of its folder and counts once; each file reads back as text, a
 *   dotfile and a symlink inside the folder stay out. A folder with no topic beside it is listed
 *   apart, never dropped.
 * - A kept file over 512 KB or not UTF-8 text is still listed, but reading it is refused with a
 *   reason (413 / 415); a path that hides, climbs or is a single name is refused.
 * - Deleting the topic removes its folder (a symlink inside it is unlinked, never followed) and
 *   its index line; deleting one file removes the folders it leaves empty, the topic stays.
 * - A topic's folder planted as a symlink holds no files: nothing under it is listed, read or
 *   deleted, and deleting the topic leaves the link's target alone.
 *
 * Moving a scope (export/import):
 * - An export is a zip of the scope folder: the index, every topic and every folder's files, as
 *   files, binary ones included, never the `.workspace` marker. A memory with three files exports
 *   and imports into another scope as it was.
 * - Import defaults to skip; overwrite and replace need confirmation that names what would be
 *   lost, unless nothing would be; overwrite replaces a memory's topic and folder; replace deletes
 *   the memories the zip does not carry, a folder no topic keeps included, and prunes the index.
 *   A folder with no topic counts as its memory being there.
 * - The untrusted zip is checked whole before anything is written: an entry that is no memory
 *   file, climbs out or hides, a link, two names one disk takes for one, a non-zip; and so is an
 *   import whose memory folder is not a directory. No temporary file stays.
 * - A version 1 JSON document (exported before the zip) still imports, with its own checks.
 * - Any member exports, only the owner imports, and a non-member learns nothing.
 *
 * One app for the file and one Project per describe; every case works in a plain Agent of its
 * own.
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  ProjectCreateResponse,
} from "../src/api/types.js";
import { MAX_MEMORY_ARCHIVE_FILES } from "../src/services/memory-archive.js";
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILES,
  MAX_IMPORT_NAME_BYTES,
  MAX_IMPORT_TOTAL_BYTES,
} from "../src/services/memory-transfer-document.js";
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "../src/services/skill-import-limits.js";
import { apiClient, canCreateSymlink, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

// Symlink creation needs a privilege or Developer Mode on Windows; canCreateSymlink()
// probes once and caches, so these cases still run where the capability exists.
const itWithSymlinks = it.skipIf(!canCreateSymlink());

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

/** The file's app and its three users; each describe below works in a Project of its own. */
let t: TestApp;
let owner: ReturnType<typeof apiClient>;
let member: ReturnType<typeof apiClient>;
let outsider: ReturnType<typeof apiClient>;

beforeAll(async () => {
  t = await createTestApp();
  const a = await provisionUser(t.app, "owner_a");
  const b = await provisionUser(t.app, "member_b");
  const c = await provisionUser(t.app, "outsider_c");
  owner = apiClient(t.app, a.cookie);
  member = apiClient(t.app, b.cookie);
  outsider = apiClient(t.app, c.cookie);
});
afterAll(async () => {
  await t.cleanup();
});

describe("memory api", () => {
  let projectId: string;
  let memoryPath: string;
  let configPath: string;
  /** The Workspace Memory directory a Session would have created. */
  let wsDir: string;

  // Every case reads and writes the Memory of a plain Agent of its own, in the one Project.
  let agentId: string;
  let agents = 0;
  beforeAll(async () => {
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-memory", name: "memory project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  beforeEach(async () => {
    agents += 1;
    agentId = `memory_${agents}`;
    const made = await owner.post(`/api/projects/${projectId}/agents`, { agentId });
    expect(made.status, await made.text()).toBe(201);
    memoryPath = `/api/projects/${projectId}/agents/${agentId}/memory`;
    configPath = `/api/projects/${projectId}/agents/${agentId}/config`;
    wsDir = memoryScopeDir(t.root, projectId, agentId, WORKSPACE_KEY);
    await fs.mkdir(wsDir, { recursive: true });
    await fs.writeFile(path.join(wsDir, ".workspace"), "/home/dev/my-app\n", "utf8");
  });

  const filesPath = (key = WORKSPACE_KEY) => `${memoryPath}/scopes/${key}/files`;

  /** Writes a file under a folder of the Workspace scope the way the model's write_file would: creating its folders first. */
  const writeKept = async (filePath: string, content: string | Buffer): Promise<void> => {
    await fs.mkdir(path.dirname(path.join(wsDir, filePath)), { recursive: true });
    await fs.writeFile(path.join(wsDir, filePath), content);
  };

  /** csv-tools.md and the three files its folder keeps, one of them a folder down. */
  const writeCsvTools = async (): Promise<void> => {
    await fs.writeFile(path.join(wsDir, "csv-tools.md"), "---\nname: csv-tools\n---\nsee files\n");
    await writeKept("csv-tools/dedupe.py", "print('dedupe')\n");
    await writeKept("csv-tools/lib/io.py", "def read(): pass\n");
    await writeKept("csv-tools/report.sh", "echo report\n");
  };

  it("overview reports the switch, the user scope, and one entry per Workspace", async () => {
    await fs.writeFile(path.join(wsDir, "testing-conventions.md"), TOPIC, "utf8");

    const body = (await (await owner.get(memoryPath)).json()) as MemoryOverviewResponse;
    expect(body.enabled).toBe(true);
    // A freshly created Agent gets the current default template, which carries {{MEMORY}}.
    expect(body.templateHasMemory).toBe(true);
    expect(body.memoryDir).toBe(memoryDir(t.root, projectId, agentId));
    expect(body.scopes).toHaveLength(2);
    // The user scope leads the list (the Agent was initialized with it on disk).
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
    const dir = memoryScopeDir(t.root, projectId, agentId, key);
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

  itWithSymlinks("neither lists nor follows a symlinked topic file", async () => {
    const outside = path.join(t.root, `${agentId}-outside-secret.txt`);
    await fs.writeFile(outside, "secret", "utf8");
    await fs.symlink(outside, path.join(wsDir, "leak.md"));
    const list = (await (await owner.get(filesPath())).json()) as MemoryFilesResponse;
    expect(list.files.map((f) => f.name)).not.toContain("leak.md");
    // Direct addressing must not follow the link either.
    expect((await owner.get(`${filesPath()}/leak.md`)).status).toBe(404);
  });

  itWithSymlinks("404s a scope directory smuggled in as a symlink", async () => {
    const outside = path.join(t.root, `${agentId}-outside-dir`);
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "loot.md"), "---\nname: l\n---\nx\n", "utf8");
    await fs.symlink(outside, memoryScopeDir(t.root, projectId, agentId, "evil-12345678"));
    expect((await owner.get(filesPath("evil-12345678"))).status).toBe(404);
  });

  it("lists the user scope of an Agent that predates Memory, creating it on demand", async () => {
    // A Workspace directory comes from a Session, but the user scope belongs to the Agent.
    await fs.rm(memoryScopeDir(t.root, projectId, agentId, USER_SCOPE_KEY), {
      recursive: true,
      force: true,
    });
    const list = (await (await owner.get(filesPath(USER_SCOPE_KEY))).json()) as MemoryFilesResponse;
    expect(list.files).toHaveLength(0);
    await expect(
      fs.stat(memoryScopeDir(t.root, projectId, agentId, USER_SCOPE_KEY)),
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
    const userDir = memoryScopeDir(t.root, projectId, agentId, USER_SCOPE_KEY);
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(path.join(userDir, "prefers-pnpm.md"), "---\nname: p\n---\nx\n", "utf8");
    // The files a topic keeps are part of that memory, not memories of their own.
    await writeKept("testing-conventions/run.sh", "echo run\n");

    const body = (await (await owner.get(`/api/projects/${projectId}/agents`)).json()) as {
      agents: { agentId: string; memoryCount: number }[];
    };
    const agent = body.agents.find((a) => a.agentId === agentId);
    expect(agent?.memoryCount).toBe(2);
  });

  // —— The files a topic keeps ——

  it("lists a topic with the three files its folder keeps, reads each back, and counts the topic once", async () => {
    await writeCsvTools();
    // What a folder holds besides kept files: a temporary dotfile the Harness's own writes leave.
    await writeKept("csv-tools/.dedupe.py.tmp-1", "half-written");

    const list = (await (await owner.get(filesPath())).json()) as MemoryFilesResponse;
    expect(list.files.map((f) => f.name)).toEqual(["csv-tools.md"]);
    expect(list.files[0]?.files.map((f) => [f.path, f.size])).toEqual([
      ["csv-tools/dedupe.py", 16],
      ["csv-tools/lib/io.py", 17],
      ["csv-tools/report.sh", 12],
    ]);
    expect(list.orphanFiles).toEqual([]);

    const read = (await (
      await owner.get(`${filesPath()}/csv-tools/lib/io.py`)
    ).json()) as MemoryFileResponse;
    expect(read.content).toBe("def read(): pass\n");
    expect(read.file.name).toBe("csv-tools/lib/io.py");
    // Reading the topic brings its files along, for a detail view that shows both.
    const topic = (await (
      await owner.get(`${filesPath()}/csv-tools.md`)
    ).json()) as MemoryFileResponse;
    expect(topic.file.files).toHaveLength(3);

    const overview = (await (await owner.get(memoryPath)).json()) as MemoryOverviewResponse;
    expect(overview.scopes.find((sc) => sc.scopeKey === WORKSPACE_KEY)?.fileCount).toBe(1);
  });

  it("lists the files of a folder with no topic beside it apart, rather than dropping them", async () => {
    await fs.writeFile(path.join(wsDir, "kept.md"), "---\nname: kept\n---\nx\n");
    await writeKept("leftover/old.py", "print('old')\n");

    const list = (await (await owner.get(filesPath())).json()) as MemoryFilesResponse;
    expect(list.files.map((f) => [f.name, f.files])).toEqual([["kept.md", []]]);
    expect(list.orphanFiles.map((f) => f.path)).toEqual(["leftover/old.py"]);
    expect((await owner.get(`${filesPath()}/leftover/old.py`)).status).toBe(200);
  });

  it("lists a kept file over 512 KB and one that is not text, but refuses to read either, saying why", async () => {
    await fs.writeFile(path.join(wsDir, "big.md"), "---\nname: big\n---\nx\n");
    await writeKept("big/huge.py", "x".repeat(512 * 1024 + 1));
    // Valid UTF-8 with a NUL byte: an import would refuse it, so it is not shown as text either.
    await writeKept("big/nul.txt", "bin\u0000ary");

    const list = (await (await owner.get(filesPath())).json()) as MemoryFilesResponse;
    expect(list.files[0]?.files.map((f) => f.path)).toEqual(["big/huge.py", "big/nul.txt"]);

    const huge = await owner.get(`${filesPath()}/big/huge.py`);
    expect(huge.status).toBe(413);
    expect(((await huge.json()) as { error: { code: string } }).error.code).toBe(
      "memory_file_too_large",
    );
    const nul = await owner.get(`${filesPath()}/big/nul.txt`);
    expect(nul.status).toBe(415);
    expect(((await nul.json()) as { error: { code: string } }).error.code).toBe(
      "memory_file_not_text",
    );
  });

  it("deletes a topic with its folder and its index line, leaving another topic's folder alone", async () => {
    await writeCsvTools();
    await fs.writeFile(path.join(wsDir, "other.md"), "---\nname: other\n---\nx\n");
    await writeKept("other/keep.sh", "echo keep\n");
    await fs.writeFile(
      path.join(wsDir, MEMORY_INDEX_FILENAME),
      "- [CSV tools](csv-tools.md) — dedupe and report\n- [Other](other.md) — other\n",
    );

    expect((await owner.delete(`${filesPath()}/csv-tools.md`)).status).toBe(204);
    const left = (await fs.readdir(wsDir)).sort();
    expect(left).not.toContain("csv-tools.md");
    expect(left).not.toContain("csv-tools");
    expect(await fs.readdir(path.join(wsDir, "other"))).toEqual(["keep.sh"]);
    expect(await fs.readFile(path.join(wsDir, MEMORY_INDEX_FILENAME), "utf8")).toBe(
      "- [Other](other.md) — other\n",
    );
  });

  it("deletes one kept file and the folders it leaves empty, keeping the topic", async () => {
    await writeCsvTools();

    expect((await owner.delete(`${filesPath()}/csv-tools/lib/io.py`)).status).toBe(204);
    expect((await fs.readdir(path.join(wsDir, "csv-tools"))).sort()).toEqual([
      "dedupe.py",
      "report.sh",
    ]);
    expect((await owner.delete(`${filesPath()}/csv-tools/dedupe.py`)).status).toBe(204);
    expect((await owner.delete(`${filesPath()}/csv-tools/report.sh`)).status).toBe(204);
    // The topic's last file took its folder with it; the topic itself is the model's to remove.
    const left = await fs.readdir(wsDir);
    expect(left).toContain("csv-tools.md");
    expect(left).not.toContain("csv-tools");
    expect((await owner.delete(`${filesPath()}/csv-tools/report.sh`)).status).toBe(404);
  });

  it("refuses a kept file's path that hides or climbs out, and 404s one that is not there", async () => {
    await writeCsvTools();
    await writeKept("csv-tools/.env", "SECRET=1\n");
    expect((await owner.get(`${filesPath()}/csv-tools/.env`)).status).toBe(400);
    expect((await owner.delete(`${filesPath()}/csv-tools/.env`)).status).toBe(400);
    expect((await owner.get(`${filesPath()}/csv-tools/..%2F..%2Fescape.py`)).status).toBe(400);
    expect((await owner.get(`${filesPath()}/csv-tools/a%5Cb.py`)).status).toBe(400);
    expect((await owner.get(`${filesPath()}/csv-tools/missing.py`)).status).toBe(404);
    expect(await fs.readdir(path.join(wsDir, "csv-tools"))).toContain(".env");
  });

  itWithSymlinks(
    "neither lists, reads nor deletes through a topic folder planted as a symlink",
    async () => {
      const outside = path.join(t.root, `${agentId}-outside-folder`);
      await fs.mkdir(outside, { recursive: true });
      await fs.writeFile(path.join(outside, "loot.py"), "secret\n", "utf8");
      await fs.writeFile(path.join(wsDir, "tools.md"), "---\nname: tools\n---\nx\n");
      await fs.symlink(outside, path.join(wsDir, "tools"));

      const list = (await (await owner.get(filesPath())).json()) as MemoryFilesResponse;
      expect(list.files.map((f) => [f.name, f.files])).toEqual([["tools.md", []]]);
      expect(list.orphanFiles).toEqual([]);
      expect((await owner.get(`${filesPath()}/tools/loot.py`)).status).toBe(404);
      expect((await owner.delete(`${filesPath()}/tools/loot.py`)).status).toBe(404);
      // The topic goes; what the link points at is not its folder and is never touched.
      expect((await owner.delete(`${filesPath()}/tools.md`)).status).toBe(204);
      expect(await fs.readdir(outside)).toEqual(["loot.py"]);
    },
  );

  itWithSymlinks(
    "skips a symlink inside a topic's folder, and deleting the topic unlinks it without following it",
    async () => {
      const outside = path.join(t.root, `${agentId}-outside-lib`);
      await fs.mkdir(outside, { recursive: true });
      await fs.writeFile(path.join(outside, "secret.py"), "secret\n", "utf8");
      await writeCsvTools();
      await fs.symlink(outside, path.join(wsDir, "csv-tools", "vendor"));

      const list = (await (await owner.get(filesPath())).json()) as MemoryFilesResponse;
      expect(list.files[0]?.files.map((f) => f.path)).not.toContain("csv-tools/vendor/secret.py");
      expect((await owner.get(`${filesPath()}/csv-tools/vendor/secret.py`)).status).toBe(404);

      expect((await owner.delete(`${filesPath()}/csv-tools.md`)).status).toBe(204);
      expect(await fs.readdir(wsDir)).not.toContain("csv-tools");
      expect(await fs.readdir(outside)).toEqual(["secret.py"]);
    },
  );

  it("404s for a non-member on every Memory route", async () => {
    expect((await outsider.get(memoryPath)).status).toBe(404);
    expect((await outsider.post(`${memoryPath}/template-placeholder`, {})).status).toBe(404);
    expect((await outsider.get(filesPath())).status).toBe(404);
    expect((await outsider.get(`${filesPath()}/x.md`)).status).toBe(404);
    expect((await outsider.delete(`${filesPath()}/x.md`)).status).toBe(404);
    expect((await outsider.get(`${filesPath()}/x/run.sh`)).status).toBe(404);
    expect((await outsider.delete(`${filesPath()}/x/run.sh`)).status).toBe(404);
  });
});

describe("memory scope export/import", () => {
  let projectId: string;
  let memoryPath: string;
  let wsDir: string;
  let userDir: string;

  // Every case moves memories in and out of a plain Agent of its own, in the one Project.
  let agentId: string;
  let agents = 0;
  beforeAll(async () => {
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-transfer", name: "transfer" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });
  beforeEach(async () => {
    agents += 1;
    agentId = `transfer_${agents}`;
    const made = await owner.post(`/api/projects/${projectId}/agents`, { agentId });
    expect(made.status, await made.text()).toBe(201);
    memoryPath = `/api/projects/${projectId}/agents/${agentId}/memory`;
    wsDir = memoryScopeDir(t.root, projectId, agentId, WORKSPACE_KEY);
    userDir = memoryScopeDir(t.root, projectId, agentId, USER_SCOPE_KEY);
    await fs.mkdir(wsDir, { recursive: true });
    await fs.writeFile(path.join(wsDir, ".workspace"), "/home/dev/my-app\n", "utf8");
  });

  const exportPath = (key = WORKSPACE_KEY) => `${memoryPath}/scopes/${key}/export`;
  const importPath = (key = WORKSPACE_KEY) => `${memoryPath}/scopes/${key}/import`;

  /** A topic file's text, with the frontmatter name the listing reads. */
  const topicText = (name: string, body: string): string => `---\nname: ${name}\n---\n${body}\n`;

  /** A zip holding the given files at its root, base64 — what the Memory tab uploads. */
  const zipOf = (files: Record<string, string | Uint8Array>): string =>
    Buffer.from(
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([name, data]) => [
            name,
            typeof data === "string" ? strToU8(data) : data,
          ]),
        ),
      ),
    ).toString("base64");

  /** Writes files into a scope directory, creating their folders. */
  const writeFiles = async (dir: string, files: Record<string, string>): Promise<void> => {
    for (const [rel, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), content, "utf8");
    }
  };

  /** The export's entries, by name, as text. */
  const exported = async (key = WORKSPACE_KEY): Promise<Record<string, string>> => {
    const res = await owner.get(exportPath(key));
    expect(res.status).toBe(200);
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    return Object.fromEntries(Object.entries(entries).map(([n, d]) => [n, strFromU8(d)]));
  };

  /** Posts a zip (base64 string) or a version 1 document (an object) to the import route. */
  const runImport = async (
    upload: string | object,
    opts: { mode?: MemoryImportMode; confirm?: boolean; key?: string } = {},
  ) =>
    owner.post(importPath(opts.key), {
      ...(typeof upload === "string" ? { dataBase64: upload } : { payload: upload }),
      ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
      ...(opts.confirm !== undefined ? { confirm: opts.confirm } : {}),
    });

  /** Every regular file under a scope directory, by its path in the scope, sorted; dotfiles left out. */
  const onDisk = async (dir = wsDir): Promise<string[]> => {
    const found: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const child = rel === "" ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) await walk(child);
        else found.push(child);
      }
    };
    await walk("");
    return found.sort();
  };

  const readIndex = (dir = wsDir): Promise<string> =>
    fs.readFile(path.join(dir, MEMORY_INDEX_FILENAME), "utf8");

  const CSV_TOOLS = {
    "csv-tools.md": topicText("csv-tools", "- [dedupe.py](csv-tools/dedupe.py) — drops duplicates"),
    "csv-tools/dedupe.py": "print('dedupe')\n",
    "csv-tools/lib/io.py": "def read(): pass\n",
    "csv-tools/report.sh": "echo report\n",
  };

  it("exports the scope folder as a zip: the index, every topic and every folder's files, as files", async () => {
    await writeFiles(wsDir, {
      ...CSV_TOOLS,
      "项目背景.md": topicText("项目背景", "正文"),
      "leftover/old.py": "print('old')\n",
      [MEMORY_INDEX_FILENAME]: "- [CSV](csv-tools.md) — tools\n",
    });
    // Not text at all: a zip carries it as the file it is.
    await fs.writeFile(path.join(wsDir, "csv-tools", "data.bin"), Buffer.from([0xff, 0x00, 0x41]));

    const res = await owner.get(exportPath());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    // Named for the Agent and the scope, as a zip; the rest of the name is the server's to choose.
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "");
    const fileName = decodeURIComponent(encoded?.[1] ?? "");
    expect(fileName.startsWith(`${agentId}-${WORKSPACE_KEY}-`)).toBe(true);
    expect(fileName.endsWith(".zip")).toBe(true);
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      "MEMORY.md",
      "csv-tools.md",
      "csv-tools/data.bin",
      "csv-tools/dedupe.py",
      "csv-tools/lib/io.py",
      "csv-tools/report.sh",
      "leftover/old.py",
      "项目背景.md",
    ]);
    expect([...entries["csv-tools/data.bin"]!]).toEqual([0xff, 0x00, 0x41]);
    expect(strFromU8(entries["csv-tools.md"]!)).toBe(CSV_TOOLS["csv-tools.md"]);
  });

  it("exports an empty scope's index alone, and no index for a scope that has none", async () => {
    // A provisioned Agent starts with an empty user index on disk; this Workspace scope, created
    // by hand above, has no MEMORY.md at all.
    expect(await exported(USER_SCOPE_KEY)).toEqual({ "MEMORY.md": "" });
    expect(await exported()).toEqual({});
  });

  it("moves a memory that keeps three files into another scope, files and all", async () => {
    await writeFiles(wsDir, {
      ...CSV_TOOLS,
      [MEMORY_INDEX_FILENAME]: "- [CSV tools](csv-tools.md) — dedupe and report\n",
    });
    const res = await owner.get(exportPath());
    const zip = Buffer.from(await res.arrayBuffer()).toString("base64");
    await fs.writeFile(path.join(userDir, MEMORY_INDEX_FILENAME), "- [Mine](mine.md) — mine\n");

    const imported = await runImport(zip, { key: USER_SCOPE_KEY });
    expect(imported.status).toBe(200);
    expect((await imported.json()) as MemoryImportResponse).toMatchObject({
      scopeKey: USER_SCOPE_KEY,
      mode: "skip",
      added: ["csv-tools.md"],
      indexWritten: true,
    });
    expect(await onDisk(userDir)).toEqual(Object.keys(CSV_TOOLS).concat("MEMORY.md").sort());
    expect(await fs.readFile(path.join(userDir, "csv-tools", "lib", "io.py"), "utf8")).toBe(
      "def read(): pass\n",
    );
    // The index gains the memory's one line; its files are listed in its own text, not here.
    expect(await readIndex(userDir)).toBe(
      "- [Mine](mine.md) — mine\n- [CSV tools](csv-tools.md) — dedupe and report\n",
    );
    const listed = (await (
      await owner.get(`${memoryPath}/scopes/${USER_SCOPE_KEY}/files`)
    ).json()) as MemoryFilesResponse;
    expect(listed.files.find((f) => f.name === "csv-tools.md")?.files).toHaveLength(3);
  });

  it("still imports a version 1 JSON document, exported before the zip", async () => {
    const v1 = {
      format: "penguin-memory-scope",
      version: 1,
      scopeKey: WORKSPACE_KEY,
      kind: "workspace",
      exportedAt: "2026-08-20T00:00:00.000Z",
      index: "- [Old](old.md) — from an older export\n",
      files: [{ name: "old.md", content: topicText("old", "body") }],
    };
    const res = await runImport(v1);
    expect(res.status).toBe(200);
    expect(((await res.json()) as MemoryImportResponse).added).toEqual(["old.md"]);
    expect(await onDisk()).toEqual(["MEMORY.md", "old.md"]);
    expect(await readIndex()).toBe("- [Old](old.md) — from an older export\n");
  });

  // —— The collision policy, branch by branch ——

  it("defaults to skip: a memory here is kept whole, a folder with no topic counts as one, the newcomer is indexed", async () => {
    await writeFiles(wsDir, {
      "keep.md": "on disk\n",
      "keep/mine.py": "mine\n",
      "leftover/old.py": "old\n",
      [MEMORY_INDEX_FILENAME]: "- [Keep](keep.md) — mine\n",
    });
    const res = await runImport(
      zipOf({
        "keep.md": topicText("keep", "from the file"),
        "keep/theirs.py": "theirs\n",
        "leftover.md": topicText("leftover", "from the file"),
        "new.md": topicText("new", "n"),
        [MEMORY_INDEX_FILENAME]: "- [New](new.md) — imported\n- [Keep](keep.md) — theirs\n",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as MemoryImportResponse;
    expect(body).toMatchObject({ added: ["new.md"], overwritten: [], removed: [] });
    expect(body.skipped.sort()).toEqual(["keep.md", "leftover/"]);
    expect(await onDisk()).toEqual([
      "MEMORY.md",
      "keep.md",
      "keep/mine.py",
      "leftover/old.py",
      "new.md",
    ]);
    expect(await fs.readFile(path.join(wsDir, "keep.md"), "utf8")).toBe("on disk\n");
    expect(await readIndex()).toBe("- [Keep](keep.md) — mine\n- [New](new.md) — imported\n");
  });

  it("refuses overwrite and replace without confirmation, naming what would be lost", async () => {
    await writeFiles(wsDir, {
      "keep.md": "on disk\n",
      "gone.md": "x\n",
      [MEMORY_INDEX_FILENAME]: "- [Keep](keep.md) — mine\n",
    });
    const zip = zipOf({
      "keep.md": topicText("keep", "from the file"),
      [MEMORY_INDEX_FILENAME]: "- [Keep](keep.md) — theirs\n",
    });

    const overwrite = await runImport(zip, { mode: "overwrite" });
    expect(overwrite.status).toBe(409);
    const refused = (await overwrite.json()) as {
      error: { code: string; details: Record<string, string> };
    };
    expect(refused.error.code).toBe("memory_import_confirm_required");
    expect(JSON.parse(refused.error.details.overwritten!)).toEqual(["keep.md"]);
    expect(JSON.parse(refused.error.details.removed!)).toEqual([]);
    // A merge extends the index rather than taking the zip's.
    expect(refused.error.details.replacesIndex).toBe("false");

    const replace = (await (await runImport(zip, { mode: "replace" })).json()) as {
      error: { details: Record<string, string> };
    };
    expect(JSON.parse(replace.error.details.removed!)).toEqual(["gone.md"]);
    expect(replace.error.details.replacesIndex).toBe("true");
    expect(await onDisk()).toEqual(["MEMORY.md", "gone.md", "keep.md"]);
    expect(await readIndex()).toBe("- [Keep](keep.md) — mine\n");
    expect(await fs.readFile(path.join(wsDir, "keep.md"), "utf8")).toBe("on disk\n");
  });

  it("overwrite replaces a memory's topic and folder with the zip's, leaving the rest alone", async () => {
    await writeFiles(wsDir, {
      "tools.md": "on disk\n",
      "tools/run.py": "old run\n",
      "tools/lib/stale.py": "stale\n",
      "untouched.md": "not in the zip\n",
    });
    const res = await runImport(
      zipOf({ "tools.md": topicText("tools", "from the file"), "tools/run.py": "new run\n" }),
      { mode: "overwrite", confirm: true },
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as MemoryImportResponse).toMatchObject({
      added: [],
      overwritten: ["tools.md"],
      removed: [],
    });
    // The topic's text describes the zip's files, so those are its whole folder now.
    expect(await onDisk()).toEqual(["tools.md", "tools/run.py", "untouched.md"]);
    expect(await fs.readFile(path.join(wsDir, "tools", "run.py"), "utf8")).toBe("new run\n");
  });

  it("replace deletes every memory the zip does not carry, a folder with no topic included, and takes its index", async () => {
    await writeFiles(wsDir, {
      "keep.md": "on disk\n",
      "gone.md": "not in the zip\n",
      "gone/run.sh": "echo gone\n",
      "leftover/old.py": "old\n",
      [MEMORY_INDEX_FILENAME]: "- [Keep](keep.md) — mine\n- [Gone](gone.md) — mine\n",
    });
    const res = await runImport(
      zipOf({
        "keep.md": topicText("keep", "from the file"),
        [MEMORY_INDEX_FILENAME]: "- [Keep](keep.md) — imported\n",
      }),
      { mode: "replace", confirm: true },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as MemoryImportResponse;
    expect(body.overwritten).toEqual(["keep.md"]);
    expect(body.removed.sort()).toEqual(["gone.md", "leftover/"]);
    expect(body.indexWritten).toBe(true);
    expect(await onDisk()).toEqual(["MEMORY.md", "keep.md"]);
    expect(await readIndex()).toBe("- [Keep](keep.md) — imported\n");
  });

  it("lands a folder the zip carries with no topic as a folder no memory keeps, and one that drops a topic here deletes it", async () => {
    await writeFiles(wsDir, {
      "tools.md": "on disk\n",
      "tools/run.py": "old run\n",
      [MEMORY_INDEX_FILENAME]: "- [Tools](tools.md) — mine\n",
    });
    const res = await runImport(
      zipOf({ "leftover/old.py": "old\n", "tools/run.py": "new run\n" }),
      {
        mode: "overwrite",
        confirm: true,
      },
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as MemoryImportResponse).toMatchObject({
      added: ["leftover/"],
      overwritten: ["tools.md"],
    });
    // The zip's version of `tools` has no topic, so the topic here and its index line go.
    expect(await onDisk()).toEqual(["MEMORY.md", "leftover/old.py", "tools/run.py"]);
    expect(await readIndex()).not.toContain("tools.md");
    const listed = (await (
      await owner.get(`${memoryPath}/scopes/${WORKSPACE_KEY}/files`)
    ).json()) as MemoryFilesResponse;
    expect(listed.orphanFiles.map((f) => f.path)).toEqual(["leftover/old.py", "tools/run.py"]);
  });

  it("a merge extends the index with only the lines it lacks, an index with no final newline included", async () => {
    await writeFiles(wsDir, {
      "old.md": "on disk\n",
      [MEMORY_INDEX_FILENAME]: "- [Old](old.md) — mine",
    });
    const res = await runImport(
      zipOf({
        "old.md": topicText("old", "from the file"),
        "new.md": topicText("new", "n"),
        "unlisted.md": topicText("unlisted", "u"),
        [MEMORY_INDEX_FILENAME]: "- [Old](old.md) — theirs\n- [New](new.md) — theirs\n",
      }),
      { mode: "overwrite", confirm: true },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as MemoryImportResponse).indexWritten).toBe(true);
    // The line the index already had stays as it was; a topic the zip's index does not list gets none.
    expect(await readIndex()).toBe("- [Old](old.md) — mine\n- [New](new.md) — theirs\n");
  });

  it("prunes the index of a replace whose zip carries none", async () => {
    await writeFiles(wsDir, {
      "gone.md": "x\n",
      [MEMORY_INDEX_FILENAME]: "- [Gone](gone.md) — mine\n",
    });
    const res = await runImport(zipOf({ "new.md": topicText("new", "n") }), {
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
    const res = await runImport(zipOf({ "new.md": topicText("new", "n") }), { mode: "replace" });
    expect(res.status).toBe(200);
    expect((await res.json()) as MemoryImportResponse).toMatchObject({
      added: ["new.md"],
      removed: [],
      overwritten: [],
    });
  });

  // —— Rejections on the untrusted write path ——

  /** Posts an upload (or a whole raw body) that must be refused with 400, having written nothing. */
  const rejects = async (upload: string | object, hint: string): Promise<void> => {
    const res = await runImport(upload);
    expect(res.status, hint).toBe(400);
  };

  it("refuses a zip entry that is no memory file, climbs out or hides, writing nothing", async () => {
    const outside = path.join(t.root, `${agentId}-outside-target.md`);
    await rejects(zipOf({ "../escape.md": "x" }), "parent traversal");
    await rejects(zipOf({ "a\\b.md": "x" }), "a backslash");
    await rejects(zipOf({ [outside]: "x" }), "absolute path");
    await rejects(zipOf({ "notes.txt": "x" }), "a file at the root that is no topic");
    await rejects(zipOf({ "memory.md": "x" }), "the index under another casing");
    await rejects(zipOf({ ".workspace": "/elsewhere\n" }), "the workspace marker");
    await rejects(zipOf({ "t.md": "x", "t/.env": "SECRET=1\n" }), "a hidden kept file");
    await rejects(zipOf({ "t.md": "x", "t/.cache/x": "x" }), "a hidden folder on the way");
    await rejects(zipOf({ "a.md": "x", "A.md": "y" }), "two names one disk takes for one");
    await rejects(zipOf({ "t.md": "x", "t/a\u0007b.py": "x" }), "a control character in a name");
    await rejects(
      zipOf({ [`${"a".repeat(MAX_IMPORT_NAME_BYTES)}.md`]: "x" }),
      "a name longer than a disk keeps",
    );
    await rejects(
      zipOf({ "t.md": "x", "t/ok.py": "x", "t/ok.py/x": "y" }),
      "a file that is a folder",
    );
    await rejects(
      zipOf({ [MEMORY_INDEX_FILENAME]: new Uint8Array([0xff, 0xfe]) }),
      "an index that is not text",
    );
    await rejects(Buffer.from("not a zip at all").toString("base64"), "not a zip");
    await rejects(zipOf({ "fine.md": "ok", "../escape.md": "x" }), "one bad entry among good ones");
    expect(await onDisk()).toEqual([]);
    await expect(fs.stat(outside)).rejects.toThrow();
  });

  it("refuses a zip holding a link, whatever it points at", async () => {
    // A Unix zipper records a symlink as host 3 with S_IFLNK in the external attributes; its data
    // is the target path, which fflate would otherwise hand back as an ordinary file.
    const link = Buffer.from(
      zipSync({
        "t.md": strToU8("x"),
        "t/loot.py": [strToU8("/etc/passwd"), { os: 3, attrs: 0o120777 << 16 }],
      }),
    ).toString("base64");
    await rejects(link, "a symlink entry");
    expect(await onDisk()).toEqual([]);
  });

  it("refuses an import whose memory folder is not a directory, writing nothing", async () => {
    await fs.writeFile(path.join(wsDir, "tools"), "not a directory\n", "utf8");
    const res = await runImport(
      zipOf({ "a.md": "x", "tools.md": topicText("tools", "x"), "tools/run.py": "print(1)\n" }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "memory_folder_not_a_directory",
    );
    expect(await onDisk()).toEqual(["tools"]);
  });

  itWithSymlinks(
    "refuses an import whose memory folder is a symlink, never writing through it",
    async () => {
      const outside = path.join(t.root, `${agentId}-outside-import`);
      await fs.mkdir(outside, { recursive: true });
      await fs.symlink(outside, path.join(wsDir, "tools"));
      const res = await runImport(
        zipOf({ "tools.md": topicText("tools", "x"), "tools/run.py": "print(1)\n" }),
      );
      expect(res.status).toBe(409);
      expect(await fs.readdir(outside)).toEqual([]);
    },
  );

  it("asks for exactly one of a zip and a version 1 document", async () => {
    expect((await owner.post(importPath(), {})).status).toBe(400);
    const both = await owner.post(importPath(), {
      dataBase64: zipOf({ "a.md": "x" }),
      payload: { format: "penguin-memory-scope", version: 1, files: [] },
    });
    expect(both.status).toBe(400);
    expect((await owner.post(importPath(), { dataBase64: 7 })).status).toBe(400);
    expect(
      (await owner.post(importPath(), { dataBase64: zipOf({ "a.md": "x" }), mode: "wipe" })).status,
    ).toBe(400);
  });

  // —— The version 1 document's own checks ——

  /** NUL, built rather than typed: an invisible byte in a source file is nobody's friend. */
  const NUL = String.fromCharCode(0);

  /** A version 1 document carrying the given entries. */
  const v1Doc = (files: unknown[], extra: object = {}) => ({
    format: "penguin-memory-scope",
    version: 1,
    scopeKey: WORKSPACE_KEY,
    kind: "workspace",
    exportedAt: "2026-08-20T00:00:00.000Z",
    index: null,
    files,
    ...extra,
  });

  it("a malformed version 1 document is refused and nothing is written", async () => {
    const entry = (name: string, content: unknown = "x") => ({ name, content });
    // Individually legal, together over the whole-document budget.
    const half = "y".repeat(MAX_IMPORT_FILE_BYTES);
    const overBudget = Array.from(
      { length: Math.floor(MAX_IMPORT_TOTAL_BYTES / MAX_IMPORT_FILE_BYTES) + 1 },
      (_, i) => entry(`big${i}.md`, half),
    );
    const malformed: [string, unknown][] = [
      ["not an object", "text"],
      ["a list", [v1Doc([])]],
      ["a foreign format", v1Doc([], { format: "some-other-tool" })],
      ["a version that was never written", v1Doc([], { version: 2 })],
      ["files that are not a list", v1Doc([], { files: "nope" })],
      ["an index that is not text", v1Doc([], { index: 5 })],
      ["an entry that is not an object", v1Doc(["n.md"])],
      ["a name that is not text", v1Doc([{ name: 7, content: "x" }])],
      ["content that is not text", v1Doc([entry("n.md", 42)])],
      ["NUL in the content", v1Doc([entry("n.md", `bin${NUL}ary`)])],
      ["NUL in the name", v1Doc([entry(`bad${NUL}.md`)])],
      ["parent traversal", v1Doc([entry("../escape.md")])],
      ["a nested path", v1Doc([entry("sub/notes.md")])],
      ["not markdown", v1Doc([entry("notes.txt")])],
      ["the same name twice", v1Doc([entry("a.md", "1"), entry("a.md", "2")])],
      [
        "a name longer than a disk keeps",
        v1Doc([entry(`${"a".repeat(MAX_IMPORT_NAME_BYTES)}.md`)]),
      ],
      [
        "too many entries",
        v1Doc(Array.from({ length: MAX_IMPORT_FILES + 1 }, (_, i) => entry(`m${i}.md`))),
      ],
      ["one oversized file", v1Doc([entry("huge.md", "x".repeat(MAX_IMPORT_FILE_BYTES + 1))])],
      ["over the whole-document budget", v1Doc(overBudget)],
    ];
    for (const [hint, payload] of malformed) {
      const res = await owner.post(importPath(), { payload });
      expect(res.status, hint).toBe(400);
    }
    expect(await onDisk()).toEqual([]);
  });

  it("refuses a zip over the archive caps, writing nothing, and an export past them is 413", async () => {
    const tooMany = zipOf(
      Object.fromEntries(
        Array.from({ length: MAX_MEMORY_ARCHIVE_FILES + 1 }, (_, i) => [`m${i}.md`, "x"]),
      ),
    );
    await rejects(tooMany, "more files than a memory zip holds");
    // Zeros deflate to almost nothing, so the declared sizes, not the upload, break the caps.
    await rejects(
      zipOf({ "t.md": "x", "t/huge.bin": new Uint8Array(MAX_FILE_BYTES + 1) }),
      "one file over the per-file cap",
    );
    const perFile = new Uint8Array(MAX_FILE_BYTES);
    const overTotal = Object.fromEntries(
      Array.from({ length: Math.floor(MAX_TOTAL_BYTES / MAX_FILE_BYTES) + 1 }, (_, i) => [
        `t/part${i}.bin`,
        perFile,
      ]),
    );
    await rejects(zipOf({ "t.md": "x", ...overTotal }), "over the total cap");
    expect(await onDisk()).toEqual([]);

    // A scope grown past the caps on disk exports nothing the import would refuse.
    await writeFiles(wsDir, { "t.md": "x" });
    await fs.mkdir(path.join(wsDir, "t"));
    await fs.writeFile(path.join(wsDir, "t", "huge.bin"), new Uint8Array(MAX_FILE_BYTES + 1));
    const res = await owner.get(exportPath());
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("memory_too_large");
  });

  itWithSymlinks(
    "replaces a symlink standing at a memory's name instead of writing through it",
    async () => {
      const outside = path.join(t.root, `${agentId}-outside-secret.md`);
      await fs.writeFile(outside, "secret\n", "utf8");
      await fs.symlink(outside, path.join(wsDir, "leak.md"));

      const res = await runImport(zipOf({ "leak.md": "imported body\n" }), {
        mode: "overwrite",
        confirm: true,
      });
      expect(res.status).toBe(200);
      // The link is gone, the memory is a real file inside the scope, and the file it pointed at
      // never saw the write.
      expect((await fs.lstat(path.join(wsDir, "leak.md"))).isSymbolicLink()).toBe(false);
      expect(await fs.readFile(path.join(wsDir, "leak.md"), "utf8")).toBe("imported body\n");
      expect(await fs.readFile(outside, "utf8")).toBe("secret\n");
    },
  );

  it("leaves no temporary file behind in the scope directory", async () => {
    expect((await runImport(zipOf({ "a.md": "x", "a/run.sh": "echo\n" }))).status).toBe(200);
    expect((await fs.readdir(wsDir)).filter((n) => n.includes(".tmp"))).toEqual([]);
    expect((await fs.readdir(path.join(wsDir, "a"))).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  itWithSymlinks(
    "rejects a bad scope key and a scope smuggled in as a symlink, on both routes",
    async () => {
      expect((await owner.get(exportPath("..%2Fescape"))).status).toBe(400);
      expect((await runImport(zipOf({}), { key: "..%2Fescape" })).status).toBe(400);
      expect((await owner.get(exportPath("never-run-0badc0de"))).status).toBe(404);
      expect((await runImport(zipOf({}), { key: "never-run-0badc0de" })).status).toBe(404);

      const outside = path.join(t.root, `${agentId}-outside-dir`);
      await fs.mkdir(outside, { recursive: true });
      await fs.symlink(outside, memoryScopeDir(t.root, projectId, agentId, "evil-12345678"));
      expect((await owner.get(exportPath("evil-12345678"))).status).toBe(404);
      expect((await runImport(zipOf({ "a.md": "x" }), { key: "evil-12345678" })).status).toBe(404);
      expect(await fs.readdir(outside)).toEqual([]);
    },
  );

  // —— Authorization ——

  it("lets any member export but only the owner import", async () => {
    await fs.writeFile(path.join(wsDir, "testing-conventions.md"), TOPIC, "utf8");
    // Export is reading Agent State, which every Project member may already do file by file.
    expect((await member.get(exportPath())).status).toBe(200);
    // Import can cost the Agent memories, so it follows the Agent State snapshot's owner gate.
    const denied = await member.post(importPath(), { dataBase64: zipOf({ "a.md": "x" }) });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe(
      "owner_required",
    );
    expect(await onDisk()).toEqual(["testing-conventions.md"]);
  });

  it("404s both routes for a non-member, without leaking that the scope exists", async () => {
    expect((await outsider.get(exportPath())).status).toBe(404);
    const res = await outsider.post(importPath(), { dataBase64: zipOf({ "a.md": "x" }) });
    expect(res.status).toBe(404);
    expect(await onDisk()).toEqual([]);
  });
});
