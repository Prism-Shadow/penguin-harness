/**
 * Integration tests for semantic ids: Project / Agent id
 * is chosen by the creator — must start with a lowercase letter and contain
 * only lowercase letters, digits, and underscores; checked for collisions
 * against both the DB and the directory (including built-in reserved ids),
 * returning 409 when taken.
 * The hyphen is a reserved separator: a non-admin's Project id is forced to
 * "<username>-<suffix>"; the admin's Project id contains no hyphen.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCreateResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const BAD_IDS = ["Foo", "1abc", "a", "-abc", "a-b", "a b", "a.b", "项目", "a".repeat(65)];

describe("语义 id", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    api = apiClient(t.app, (await provisionUser(t.app, "ida")).cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("建 Project（admin 无前缀、不含连字符）：非法 id 400；合法 id 落目录，显示名缺省为 id", async () => {
    for (const bad of BAD_IDS) {
      const res = await admin.post("/api/projects", { projectId: bad, name: "x" });
      expect(res.status, `projectId=${bad}`).toBe(400);
    }

    const created = await admin.post("/api/projects", { projectId: "my_proj_2" });
    expect(created.status).toBe(201);
    const { project } = (await created.json()) as ProjectCreateResponse;
    expect(project.projectId).toBe("my_proj_2");
    expect(project.name).toBe("my_proj_2"); // No display name given: defaults to the id
    await expect(fs.access(path.join(t.root, "my_proj_2"))).resolves.toBeUndefined();
  });

  it("建 Project：DB 占用、纯目录占用与保留 id 都是 409", async () => {
    expect((await admin.post("/api/projects", { projectId: "taken", name: "a" })).status).toBe(201);
    expect((await admin.post("/api/projects", { projectId: "taken", name: "b" })).status).toBe(409);
    // A directory that exists but isn't tracked (e.g. created by the CLI) is also considered taken.
    await fs.mkdir(path.join(t.root, "dir_only"), { recursive: true });
    expect((await admin.post("/api/projects", { projectId: "dir_only", name: "c" })).status).toBe(
      409,
    );
    // default_project is already tracked by admin.
    expect(
      (await admin.post("/api/projects", { projectId: "default_project", name: "d" })).status,
    ).toBe(409);
  });

  it("非管理员建 Project：id 强制为 <用户名>-<后缀>，后缀仅小写字母数字下划线", async () => {
    // No prefix / prefix only / suffix with a hyphen or an invalid character: 400.
    for (const bad of ["blog", "ida", "ida-", "idablog", "proj_ida", "ida-sub-x", "ida-Bad"]) {
      const res = await api.post("/api/projects", { projectId: bad, name: "x" });
      expect(res.status, `projectId=${bad}`).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code, `projectId=${bad}`).toBe("project_id_prefix_required");
    }
    // With the prefix: created normally.
    const created = await api.post("/api/projects", { projectId: "ida-blog" });
    expect(created.status).toBe(201);
    await expect(fs.access(path.join(t.root, "ida-blog"))).resolves.toBeUndefined();
  });

  it("创建 Project 中途失败：DB 行与目录回滚，同 id 重试可成功", async () => {
    // Inject a config write failure (handleError logs the stack trace: silence it so it doesn't clutter output).
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = t.deps.projectConfigService.writeInitialConfig.bind(
      t.deps.projectConfigService,
    );
    t.deps.projectConfigService.writeInitialConfig = async () => {
      throw new Error("写配置炸了");
    };
    expect((await admin.post("/api/projects", { projectId: "flaky", name: "x" })).status).toBe(500);
    spy.mockRestore();
    // No leftovers: neither the directory nor the DB row exist, so the id isn't held by an orphaned directory.
    await expect(fs.access(path.join(t.root, "flaky"))).rejects.toThrow();
    expect(
      t.deps.db.prepare("SELECT 1 AS x FROM projects WHERE project_id = ?").get("flaky"),
    ).toBeUndefined();
    t.deps.projectConfigService.writeInitialConfig = original;
    expect((await admin.post("/api/projects", { projectId: "flaky", name: "x" })).status).toBe(201);
  });

  it("创建 Agent 中途失败：目录回滚，同 id 重试可成功", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = t.deps.agentConfigService.updateConfig.bind(t.deps.agentConfigService);
    t.deps.agentConfigService.updateConfig = async () => {
      throw new Error("写配置炸了");
    };
    expect(
      (await api.post("/api/projects/ida-default_project/agents", { agentId: "flaky" })).status,
    ).toBe(500);
    spy.mockRestore();
    await expect(fs.access(path.join(t.root, "ida-default_project", "flaky"))).rejects.toThrow();
    t.deps.agentConfigService.updateConfig = original;
    expect(
      (await api.post("/api/projects/ida-default_project/agents", { agentId: "flaky" })).status,
    ).toBe(201);
  });

  it("建 Agent：非法 id 400；合法 id 初始化；重复与内置 id 409；跨 Project 不冲突", async () => {
    for (const bad of BAD_IDS) {
      const res = await api.post("/api/projects/ida-default_project/agents", {
        agentId: bad,
        name: "x",
      });
      expect(res.status, `agentId=${bad}`).toBe(400);
    }

    const created = await api.post("/api/projects/ida-default_project/agents", {
      agentId: "crawler",
      name: "爬虫",
    });
    expect(created.status).toBe(201);
    const { agent } = (await created.json()) as AgentCreateResponse;
    expect(agent.agentId).toBe("crawler");
    expect(agent.name).toBe("爬虫");
    await expect(
      fs.access(
        path.join(t.root, "ida-default_project", "crawler", "agent_state", "system_config.yaml"),
      ),
    ).resolves.toBeUndefined();

    // Both a duplicate within the same Project and a built-in reserved id are blocked by the collision check.
    expect(
      (
        await api.post("/api/projects/ida-default_project/agents", {
          agentId: "crawler",
          name: "y",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api.post("/api/projects/ida-default_project/agents", {
          agentId: "default_agent",
          name: "y",
        })
      ).status,
    ).toBe(409);

    // Agent id uniqueness is scoped to the Project: another Project can reuse the
    // same id; the name defaults to the id.
    expect((await api.post("/api/projects", { projectId: "ida-other" })).status).toBe(201);
    const noName = await api.post("/api/projects/ida-other/agents", { agentId: "crawler" });
    expect(noName.status).toBe(201);
    expect(((await noName.json()) as AgentCreateResponse).agent.name).toBe("crawler");
  });
});
