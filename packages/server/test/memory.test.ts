/**
 * Integration tests for the Workspace Memory routes (agent_state/memory/): the overview
 * reports the Agent-level switch and one entry per Workspace directory, topic files can be
 * listed / read / written / renamed / deleted, the shared index is edited through its own
 * endpoint, path traversal in a workspace key or file name is rejected, the switch round-trips
 * through the Agent config without touching any file, and non-members see 404.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_SCOPE_KEY, memoryDir, workspaceMemoryDir } from "@prismshadow/penguin-core";
import type {
  AgentConfigResponse,
  MemoryFileResponse,
  MemoryFilesResponse,
  MemoryIndexResponse,
  MemoryOverviewResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const WORKSPACE_KEY = "my-app-a81f32c4";
const TOPIC = `---
name: Testing conventions
description: how tests are run here
type: feedback
updated_at: 2026-07-30
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
    wsDir = workspaceMemoryDir(t.root, projectId, "default_agent", WORKSPACE_KEY);
    await fs.mkdir(wsDir, { recursive: true });
    await fs.writeFile(path.join(wsDir, ".workspace"), "/home/dev/my-app\n", "utf8");
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const filesPath = (key = WORKSPACE_KEY) => `${memoryPath}/workspaces/${key}/files`;

  it("overview reports the switch, the index, the Agent scope, and one entry per Workspace", async () => {
    await fs.writeFile(path.join(wsDir, "feedback_testing.md"), TOPIC, "utf8");
    await fs.writeFile(
      path.join(memoryDir(t.root, projectId, "default_agent"), "AGENTS.md"),
      `# Memory\n\n## ${WORKSPACE_KEY}\n\n- [Testing](${WORKSPACE_KEY}/feedback_testing.md) — how tests are run here\n`,
      "utf8",
    );

    const body = (await (await owner.get(memoryPath)).json()) as MemoryOverviewResponse;
    expect(body.enabled).toBe(true);
    // A freshly created Agent gets the current default template, which carries {{MEMORY}}.
    expect(body.templateInjects).toBe(true);
    expect(body.memoryDir).toBe(memoryDir(t.root, projectId, "default_agent"));
    expect(body.index).toContain(`## ${WORKSPACE_KEY}`);
    expect(body.workspaces).toHaveLength(2);
    // The Agent scope leads the list and is listed even though nothing created it on disk yet.
    expect(body.workspaces[0]).toMatchObject({
      workspaceKey: AGENT_SCOPE_KEY,
      agentScope: true,
      fileCount: 0,
    });
    expect(body.workspaces[0]?.workspacePath).toBeUndefined();
    expect(body.workspaces[1]).toMatchObject({
      workspaceKey: WORKSPACE_KEY,
      workspacePath: "/home/dev/my-app",
      fileCount: 1,
    });
    expect(body.workspaces[1]?.agentScope).toBeUndefined();
    expect(body.workspaces[1]?.updatedAt).toBeTruthy();
  });

  it("writes an Agent-scope memory into a directory no Session has created yet", async () => {
    // A Workspace directory comes from a Session, but the Agent scope belongs to the Agent, so
    // the first agent-level memory must not have to wait for one.
    await expect(
      fs.stat(workspaceMemoryDir(t.root, projectId, "default_agent", AGENT_SCOPE_KEY)),
    ).rejects.toThrow();

    const written = await owner.put(`${filesPath(AGENT_SCOPE_KEY)}/feedback_style.md`, {
      content: TOPIC,
    });
    expect(written.status).toBe(200);

    const list = (await (
      await owner.get(filesPath(AGENT_SCOPE_KEY))
    ).json()) as MemoryFilesResponse;
    expect(list.files.map((f) => f.name)).toEqual(["feedback_style.md"]);

    const body = (await (await owner.get(memoryPath)).json()) as MemoryOverviewResponse;
    expect(body.workspaces[0]).toMatchObject({ workspaceKey: AGENT_SCOPE_KEY, fileCount: 1 });
  });

  it("still 404s a Workspace key with no directory, so only the Agent scope is auto-created", async () => {
    const res = await owner.get(filesPath("never-run-0badc0de"));
    expect(res.status).toBe(404);
  });

  it("lists and reads topic files with their frontmatter, ignoring the .workspace marker", async () => {
    await fs.writeFile(path.join(wsDir, "feedback_testing.md"), TOPIC, "utf8");

    const list = (await (await owner.get(filesPath())).json()) as MemoryFilesResponse;
    expect(list.files).toHaveLength(1);
    expect(list.files[0]).toMatchObject({
      name: "feedback_testing.md",
      title: "Testing conventions",
      description: "how tests are run here",
      type: "feedback",
      updatedAt: "2026-07-30",
    });

    const read = (await (
      await owner.get(`${filesPath()}/feedback_testing.md`)
    ).json()) as MemoryFileResponse;
    expect(read.content).toBe(TOPIC);
  });

  it("writes, renames and deletes a topic file", async () => {
    const created = await owner.put(`${filesPath()}/project_release.md`, { content: TOPIC });
    expect(created.status).toBe(200);
    expect(((await created.json()) as MemoryFileResponse).file.title).toBe("Testing conventions");

    const renamed = await owner.post(`${filesPath()}/project_release.md/rename`, {
      name: "project_release_process.md",
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as MemoryFileResponse).file.name).toBe(
      "project_release_process.md",
    );
    expect(await fs.readdir(wsDir)).toContain("project_release_process.md");

    // Renaming onto an existing name is refused rather than clobbering it.
    await owner.put(`${filesPath()}/other.md`, { content: "# other\n" });
    const clash = await owner.post(`${filesPath()}/other.md/rename`, {
      name: "project_release_process.md",
    });
    expect(clash.status).toBe(409);

    expect((await owner.delete(`${filesPath()}/project_release_process.md`)).status).toBe(204);
    expect(await fs.readdir(wsDir)).not.toContain("project_release_process.md");
    expect((await owner.delete(`${filesPath()}/project_release_process.md`)).status).toBe(404);
  });

  it("edits the shared index through its own endpoint, creating memory/ when absent", async () => {
    await fs.rm(memoryDir(t.root, projectId, "default_agent"), { recursive: true, force: true });
    expect(
      ((await (await owner.get(`${memoryPath}/index`)).json()) as MemoryIndexResponse).content,
    ).toBe("");

    const put = await owner.put(`${memoryPath}/index`, { content: "# Memory\n" });
    expect(put.status).toBe(200);
    expect(
      await fs.readFile(
        path.join(memoryDir(t.root, projectId, "default_agent"), "AGENTS.md"),
        "utf8",
      ),
    ).toBe("# Memory\n");
  });

  it("rejects traversal and non-Markdown names, and an unknown Workspace", async () => {
    // A key or file name that could climb out of the Memory directory never reaches the filesystem
    // (the separator is percent-encoded, so it arrives as one path segment and is ours to reject).
    expect((await owner.get(filesPath("..%2Fescape"))).status).toBe(400);
    expect((await owner.get(`${filesPath()}/..%2Fescape.md`)).status).toBe(400);
    expect((await owner.put(`${filesPath()}/notes.txt`, { content: "x" })).status).toBe(400);
    // AGENTS.md inside a Workspace directory would shadow the shared index in the UI.
    expect((await owner.put(`${filesPath()}/AGENTS.md`, { content: "x" })).status).toBe(400);
    expect((await owner.get(filesPath("never-seen-0badc0de"))).status).toBe(404);

    const escaped = path.join(path.dirname(wsDir), "escape.md");
    await expect(fs.access(escaped)).rejects.toThrow();
  });

  it("toggles the Agent-level switch through the config route without touching any file", async () => {
    await fs.writeFile(path.join(wsDir, "feedback_testing.md"), TOPIC, "utf8");

    const off = await owner.put(configPath, { config: { memory: { enabled: false } } });
    expect(off.status).toBe(200);
    expect(((await off.json()) as AgentConfigResponse).config.memory.enabled).toBe(false);

    // Turning Memory off keeps the files and the management API working; it only stops Memory
    // from reaching the model's context.
    const body = (await (await owner.get(memoryPath)).json()) as MemoryOverviewResponse;
    expect(body.enabled).toBe(false);
    expect(body.workspaces.find((w) => w.workspaceKey === WORKSPACE_KEY)?.fileCount).toBe(1);

    const on = await owner.put(configPath, { config: { memory: { enabled: true } } });
    expect(((await on.json()) as AgentConfigResponse).config.memory.enabled).toBe(true);
  });

  it("404s for a non-member on every Memory route", async () => {
    expect((await outsider.get(memoryPath)).status).toBe(404);
    expect((await outsider.get(`${memoryPath}/index`)).status).toBe(404);
    expect((await outsider.get(filesPath())).status).toBe(404);
    expect((await outsider.put(`${filesPath()}/x.md`, { content: "x" })).status).toBe(404);
  });
});
