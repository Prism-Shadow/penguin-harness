/**
 * Auth flow integration tests (via app.request() injection): admin seeding / login /
 * logout / password change / session / initial Project.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeResponse, ProjectsResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, loginUser, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("auth", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("未登录访问受保护 API 返回 401", async () => {
    const res = await t.app.request("/api/projects");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("不开放注册：register 接口不存在", async () => {
    // Not logged in: no such route under /api/auth, falls into the protected-section 401.
    const anon = await t.app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice", password: "password-123" }),
    });
    expect(anon.status).toBe(401);
    // Logged in: falls through to notFound -> 404, proving the route has indeed been removed.
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).post("/api/auth/register", {
      userId: "alice",
      password: "password-123",
    });
    expect(res.status).toBe(404);
  });

  it("种子 admin 纳管 default_project；初始密码带标记", async () => {
    const admin = await loginAdmin(t.app);
    expect(admin.user.isAdmin).toBe(true);
    expect(admin.user.passwordIsInitial).toBe(true);
    const api = apiClient(t.app, admin.cookie);
    const projects = (await (await api.get("/api/projects")).json()) as ProjectsResponse;
    expect(projects.projects.map((p) => p.projectId)).toContain("default_project");
    expect(projects.projects[0]!.role).toBe("owner");
    // default_agent has been initialized (directory exists).
    await expect(
      fs.access(path.join(t.root, "default_project", "default_agent", "agent_state")),
    ).resolves.toBeUndefined();
    // Seeding is idempotent: re-seeding does not create a duplicate account.
    await t.deps.authService.seedAdmin();
    expect(t.deps.db.prepare("SELECT COUNT(*) AS n FROM users").get()?.n).toBe(1);
  });

  it("管理员建号：默认 Project 为 <用户名>-default_project，显示名缺省为用户名", async () => {
    const bob = await provisionUser(t.app, "bob");
    expect(bob.user.isAdmin).toBe(false);
    expect(bob.user.passwordIsInitial).toBe(true);
    const api = apiClient(t.app, bob.cookie);
    const projects = (await (await api.get("/api/projects")).json()) as ProjectsResponse;
    expect(projects.projects).toHaveLength(1);
    const p = projects.projects[0]!;
    expect(p.projectId).toBe("bob-default_project");
    expect(p.name).toBe("bob");
    expect(p.role).toBe("owner");
    expect(p.ownerUserId).toBe("bob");
    // The initial Project's .project_config.toml carries the display name and preset model config (the default model is written along with it).
    const toml = await fs.readFile(
      path.join(t.root, "bob-default_project", ".project_config.toml"),
      "utf8",
    );
    expect(toml).toContain('name = "bob"');
    expect(toml).toContain(
      'default_model = { provider = "deepseek", model_id = "deepseek-v4-pro" }',
    );
  });

  it("登录 / me / 登出闭环；错误密码 401", async () => {
    await provisionUser(t.app, "carol");
    const wrong = await t.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "carol", password: "wrong-password" }),
    });
    expect(wrong.status).toBe(401);

    const { cookie } = await loginUser(t.app, "carol", "password-123");
    expect(cookie.startsWith("penguin_session=")).toBe(true);

    const api = apiClient(t.app, cookie);
    const me = (await (await api.get("/api/me")).json()) as MeResponse;
    expect(me.user.userId).toBe("carol");

    const logout = await api.post("/api/auth/logout");
    expect(logout.status).toBe(204);
    const after = await api.get("/api/me");
    expect(after.status).toBe(401);
  });

  it("本人改密：旧密码校验、新密码生效、初始密码标记清除", async () => {
    const { cookie } = await provisionUser(t.app, "dave");
    const api = apiClient(t.app, cookie);

    const wrongOld = await api.put("/api/me/password", {
      oldPassword: "not-the-password",
      newPassword: "new-password-1",
    });
    expect(wrongOld.status).toBe(400);
    const tooShort = await api.put("/api/me/password", {
      oldPassword: "password-123",
      newPassword: "short",
    });
    expect(tooShort.status).toBe(400);

    const ok = await api.put("/api/me/password", {
      oldPassword: "password-123",
      newPassword: "new-password-1",
    });
    expect(ok.status).toBe(204);
    // After the password change, the current session remains valid and the initial-password flag is cleared.
    const me = (await (await api.get("/api/me")).json()) as MeResponse;
    expect(me.user.passwordIsInitial).toBe(false);
    // The old password is invalidated, and the new password can log in.
    const oldLogin = await t.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "dave", password: "password-123" }),
    });
    expect(oldLogin.status).toBe(401);
    await loginUser(t.app, "dave", "new-password-1");
  });

  it("写请求拒绝非 JSON Content-Type（CSRF 防线）", async () => {
    const res = await t.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "userId=a&password=b",
    });
    expect(res.status).toBe(415);
  });

  it("ui prefs 读写", async () => {
    const { cookie } = await provisionUser(t.app, "erin");
    const api = apiClient(t.app, cookie);
    const empty = (await (await api.get("/api/me/prefs")).json()) as { prefs: unknown };
    expect(empty.prefs).toEqual({});
    await api.put("/api/me/prefs", { theme: "dark", lastProjectId: "default_project" });
    const got = (await (await api.get("/api/me/prefs")).json()) as {
      prefs: { theme: string };
    };
    expect(got.prefs.theme).toBe("dark");
  });

  it("PUT prefs 浅合并，不覆盖其他写入方的字段", async () => {
    const { cookie } = await provisionUser(t.app, "fred");
    const api = apiClient(t.app, cookie);
    // Simulate two independent writers: switching Project writes lastProjectId, and onboarding writes credentialGuideSeen.
    await api.put("/api/me/prefs", { lastProjectId: "p-1" });
    await api.put("/api/me/prefs", { credentialGuideSeen: true });
    const one = (await (await api.get("/api/me/prefs")).json()) as {
      prefs: { lastProjectId?: string; credentialGuideSeen?: boolean };
    };
    // The second write must not erase the fields from the first (a prior full replace would drop lastProjectId, causing onboarding to reappear repeatedly).
    expect(one.prefs).toEqual({ lastProjectId: "p-1", credentialGuideSeen: true });
    // Switch Project again: credentialGuideSeen is still present.
    await api.put("/api/me/prefs", { lastProjectId: "p-2" });
    const two = (await (await api.get("/api/me/prefs")).json()) as {
      prefs: { lastProjectId?: string; credentialGuideSeen?: boolean };
    };
    expect(two.prefs).toEqual({ lastProjectId: "p-2", credentialGuideSeen: true });
  });
});
