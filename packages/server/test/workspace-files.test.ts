/**
 * Unit tests for the Workspace files service: directory-listing order, read/write,
 * path confinement (`..` traversal and symlink escape), size-limit protection,
 * batch existence checks (files/stat); and the Agent delete route (default_agent
 * cannot be deleted, owner-only, directory and index cleanup).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceFilesService } from "../src/services/workspace-files-service.js";
import type {
  AgentCreateResponse,
  ProjectCreateResponse,
  SessionCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, makeTempRoot, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("workspace-files-service", () => {
  let ws: string;
  let outside: string;
  const svc = new WorkspaceFilesService();

  beforeEach(async () => {
    ws = await makeTempRoot();
    outside = await makeTempRoot();
    await fs.mkdir(path.join(ws, "sub"));
    await fs.writeFile(path.join(ws, "b.txt"), "hello");
    await fs.writeFile(path.join(ws, "sub", "c.md"), "# md");
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
  });
  afterEach(async () => {
    await fs.rm(ws, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("列目录：dir 在前、按名称排序；子目录路径生效", async () => {
    const root = await svc.list(ws, "");
    expect(root.entries.map((e) => `${e.kind}:${e.name}`)).toEqual(["dir:sub", "file:b.txt"]);
    const sub = await svc.list(ws, "sub");
    expect(sub.entries.map((e) => e.name)).toEqual(["c.md"]);
  });

  it("读文件：内容与 content-type；目录/不存在报错", async () => {
    const file = await svc.read(ws, "sub/c.md");
    expect(file.data.toString()).toBe("# md");
    expect(file.contentType).toContain("markdown");
    await expect(svc.read(ws, "sub")).rejects.toMatchObject({ status: 400 });
    await expect(svc.read(ws, "nope.txt")).rejects.toMatchObject({ status: 404 });
  });

  it("写文件：覆盖写入；父目录缺失时自动补建（上传文件夹保留目录结构）", async () => {
    await svc.write(ws, "sub/new.txt", Buffer.from("data"));
    expect(await fs.readFile(path.join(ws, "sub", "new.txt"), "utf8")).toBe("data");
    await svc.write(ws, "missing/deep/x.txt", Buffer.from("d"));
    expect(await fs.readFile(path.join(ws, "missing", "deep", "x.txt"), "utf8")).toBe("d");
  });

  it("路径限域：`..` 穿越与绝对路径均拒绝", async () => {
    await expect(svc.list(ws, "../")).rejects.toMatchObject({ status: 400 });
    await expect(svc.read(ws, `../${path.basename(outside)}/secret.txt`)).rejects.toMatchObject({
      status: 400,
    });
    await expect(svc.write(ws, "../escape.txt", Buffer.from("x"))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("Workspace 为文件系统根：子目录可正常下钻（前缀拼接 '//' 回归）", async () => {
    const root = path.parse(ws).root;
    const sub = await svc.list(root, path.relative(root, path.join(ws, "sub")));
    expect(sub.entries.map((e) => e.name)).toEqual(["c.md"]);
  });

  it("指向 Workspace 内目录的符号链接：kind 为 dir 且可下钻", async () => {
    await fs.symlink(path.join(ws, "sub"), path.join(ws, "link-sub"));
    const root = await svc.list(ws, "");
    expect(root.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      "dir:link-sub",
      "dir:sub",
      "file:b.txt",
    ]);
    const viaLink = await svc.list(ws, "link-sub");
    expect(viaLink.entries.map((e) => e.name)).toEqual(["c.md"]);
  });

  it("符号链接逃逸：链接指向 Workspace 外时读写均拒绝", async () => {
    await fs.symlink(outside, path.join(ws, "link-out"));
    await expect(svc.list(ws, "link-out")).rejects.toMatchObject({ status: 400 });
    await expect(svc.read(ws, "link-out/secret.txt")).rejects.toMatchObject({ status: 400 });
    // Writing outside via a directory symlink: caught by the parent-directory realpath check.
    await expect(svc.write(ws, "link-out/evil.txt", Buffer.from("x"))).rejects.toMatchObject({
      status: 400,
    });
    // Auto-creation under a missing path is equally restricted: if the nearest
    // existing ancestor is a symlink pointing outside, mkdir must not be used to escape.
    await expect(svc.write(ws, "link-out/new/evil.txt", Buffer.from("x"))).rejects.toMatchObject({
      status: 400,
    });
    expect(
      await fs
        .stat(path.join(outside, "new"))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it("末段符号链接写入：O_NOFOLLOW 拒绝借刀覆盖域外文件", async () => {
    // The Agent has a symlink inside the Workspace pointing to an outside file; an upload attempts to overwrite it.
    const victim = path.join(outside, "secret.txt");
    await fs.symlink(victim, path.join(ws, "report.pdf"));
    await expect(svc.write(ws, "report.pdf", Buffer.from("PWNED"))).rejects.toMatchObject({
      status: 400,
    });
    // The outside file's content is unchanged.
    expect(await fs.readFile(victim, "utf8")).toBe("secret");
  });
});

describe("files/stat 路由（批量存在性检查）", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let sessionId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    const b = await provisionUser(t.app, "outsider");
    owner = apiClient(t.app, a.cookie);
    outsider = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-stat", name: "项目" })
    ).json()) as ProjectCreateResponse;
    const projectId = created.project.projectId;
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    const sess = (await (
      await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})
    ).json()) as SessionCreateResponse;
    sessionId = sess.session.sessionId;
    await fs.mkdir(path.join(sess.session.workspace, "sub"));
    await fs.writeFile(path.join(sess.session.workspace, "a.txt"), "A");
    await fs.writeFile(path.join(sess.session.workspace, "sub", "b.md"), "B");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("存在的文件保序去重返回；不存在 / 目录 / 越界一律按不存在计且恒 200", async () => {
    const res = await owner.post(`/api/sessions/${sessionId}/files/stat`, {
      paths: ["sub/b.md", "a.txt", "sub/b.md", "nope.txt", "sub", "../escape.txt", "/etc/passwd"],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ existing: ["sub/b.md", "a.txt"] });

    const empty = await owner.post(`/api/sessions/${sessionId}/files/stat`, { paths: [] });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ existing: [] });
  });

  it("非法 body → 400：非数组 / 非字符串项 / 超量 / 超长", async () => {
    const url = `/api/sessions/${sessionId}/files/stat`;
    expect((await owner.post(url, { paths: "a.txt" })).status).toBe(400);
    expect((await owner.post(url, { paths: [1] })).status).toBe(400);
    const tooMany = Array.from({ length: 101 }, () => "a.txt");
    expect((await owner.post(url, { paths: tooMany })).status).toBe(400);
    expect((await owner.post(url, { paths: ["x".repeat(513)] })).status).toBe(400);
  });

  it("外人访问 → 404（不泄露存在性）", async () => {
    const res = await outsider.post(`/api/sessions/${sessionId}/files/stat`, {
      paths: ["a.txt"],
    });
    expect(res.status).toBe(404);
  });
});

describe("agent 删除路由", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    const b = await provisionUser(t.app, "outsider");
    owner = apiClient(t.app, a.cookie);
    outsider = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-ws", name: "项目" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("owner 删除 Agent：204，目录与列表项消失；default_agent 409；外人 404", async () => {
    const created = (await (
      await owner.post(`/api/projects/${projectId}/agents`, { agentId: "temp_agent", name: "临时" })
    ).json()) as AgentCreateResponse;
    const agentId = created.agent.agentId;
    const dir = path.join(t.root, projectId, "agents", agentId);
    await fs.access(dir); // directory exists after creation

    const outsiderRes = await outsider.delete(`/api/projects/${projectId}/agents/${agentId}`);
    expect(outsiderRes.status).toBe(404); // no access → don't leak existence

    const res = await owner.delete(`/api/projects/${projectId}/agents/${agentId}`);
    expect(res.status).toBe(204);
    await expect(fs.access(dir)).rejects.toThrow();
    const list = (await (await owner.get(`/api/projects/${projectId}/agents`)).json()) as {
      agents: Array<{ agentId: string }>;
    };
    expect(list.agents.some((x) => x.agentId === agentId)).toBe(false);

    const def = await owner.delete(`/api/projects/${projectId}/agents/default_agent`);
    expect(def.status).toBe(409);
  });
});
