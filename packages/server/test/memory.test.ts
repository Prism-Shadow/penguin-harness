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
    // A freshly created Agent gets the current default template, which carries # Memory.
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
    // Nor can the index be fetched or deleted as a topic file.
    expect((await owner.get(`${filesPath()}/${MEMORY_INDEX_FILENAME}`)).status).toBe(400);
    expect((await owner.delete(`${filesPath()}/${MEMORY_INDEX_FILENAME}`)).status).toBe(400);
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
      type: "feedback",
      updatedAt: "2026-08-07",
    });

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
      "- [Testing](testing-conventions.md) — how tests are run here\n" +
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

  it("reports a template without the Memory section and inserts the default one on request", async () => {
    // Simulate an Agent from before Memory: replace the template with one lacking the section.
    const put = await owner.put(configPath, {
      config: { systemPrompt: "# Role\nDo things.\n# Environment" },
    });
    expect(put.status).toBe(200);
    let body = (await (await owner.get(memoryPath)).json()) as MemoryOverviewResponse;
    expect(body.templateHasMemory).toBe(false);

    const inserted = await owner.post(`${memoryPath}/template-section`, {});
    expect(inserted.status).toBe(200);
    body = (await inserted.json()) as MemoryOverviewResponse;
    expect(body.templateHasMemory).toBe(true);

    const cfg = (await (await owner.get(configPath)).json()) as AgentConfigResponse;
    expect(cfg.config.systemPrompt).toContain("# Memory");
    // Inserted at the position the default template gives it: before # Environment.
    expect(cfg.config.systemPrompt.indexOf("# Memory")).toBeLessThan(
      cfg.config.systemPrompt.indexOf("# Environment"),
    );

    // Idempotent: a second call changes nothing and still succeeds.
    const again = await owner.post(`${memoryPath}/template-section`, {});
    expect(again.status).toBe(200);
    const cfgAgain = (await (await owner.get(configPath)).json()) as AgentConfigResponse;
    expect(cfgAgain.config.systemPrompt).toBe(cfg.config.systemPrompt);
  });

  it("404s for a non-member on every Memory route", async () => {
    expect((await outsider.get(memoryPath)).status).toBe(404);
    expect((await outsider.post(`${memoryPath}/template-section`, {})).status).toBe(404);
    expect((await outsider.get(filesPath())).status).toBe(404);
    expect((await outsider.get(`${filesPath()}/x.md`)).status).toBe(404);
    expect((await outsider.delete(`${filesPath()}/x.md`)).status).toBe(404);
  });
});
