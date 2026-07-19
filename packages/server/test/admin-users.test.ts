/**
 * Admin users backend integration tests: permission boundary (non-admin 403), account
 * creation validation and rollback, password reset (session invalidation), and user
 * deletion (cascading deletion of owned Project).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdminUsersResponse, MembersResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, loginUser, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("admin 用户后台", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("非管理员访问一律 403", async () => {
    const { cookie } = await provisionUser(t.app, "norm");
    const api = apiClient(t.app, cookie);
    expect((await api.get("/api/admin/users")).status).toBe(403);
    expect(
      (await api.post("/api/admin/users", { userId: "x_user", password: "password-123" })).status,
    ).toBe(403);
    expect(
      (await api.post("/api/admin/users/norm/password", { password: "password-456" })).status,
    ).toBe(403);
    expect((await api.delete("/api/admin/users/norm")).status).toBe(403);
  });

  it("建号校验：非法用户名 / 过短密码 400；重复 409", async () => {
    for (const bad of ["Bob", "1abc", "a", "-abc", "a-b", "a!b", "a".repeat(33)]) {
      const res = await admin.post("/api/admin/users", { userId: bad, password: "password-123" });
      expect(res.status, `userId=${bad}`).toBe(400);
    }
    expect(
      (await admin.post("/api/admin/users", { userId: "ok_user", password: "short" })).status,
    ).toBe(400);
    expect(
      (await admin.post("/api/admin/users", { userId: "ok_user", password: "password-123" }))
        .status,
    ).toBe(201);
    expect(
      (await admin.post("/api/admin/users", { userId: "ok_user", password: "password-123" }))
        .status,
    ).toBe(409);
    expect(
      (await admin.post("/api/admin/users", { userId: "admin", password: "password-123" })).status,
    ).toBe(409);
  });

  it("默认 Project id 被占用时建号失败并回滚用户", async () => {
    // Occupy the frank-default_project directory (simulating CLI creation; no Web-side user can construct another's prefix).
    await fs.mkdir(path.join(t.root, "frank-default_project"), { recursive: true });
    const res = await admin.post("/api/admin/users", { userId: "frank", password: "password-123" });
    expect(res.status).toBe(409);
    // The user row has been rolled back: frank is absent from the list and cannot log in.
    const list = (await (await admin.get("/api/admin/users")).json()) as AdminUsersResponse;
    expect(list.users.map((u) => u.userId)).not.toContain("frank");
  });

  it("用户列表：种子 admin 与新建用户，字段齐全", async () => {
    await provisionUser(t.app, "kate");
    const list = (await (await admin.get("/api/admin/users")).json()) as AdminUsersResponse;
    expect(list.users.map((u) => u.userId)).toEqual(["admin", "kate"]);
    const a = list.users[0]!;
    expect(a.isAdmin).toBe(true);
    expect(a.passwordIsInitial).toBe(true);
    expect(a.createdAt).toBeTruthy();
    expect(list.users[1]!.isAdmin).toBe(false);
  });

  it("重置密码：清空目标用户全部会话，新密码带初始标记", async () => {
    const rex = await provisionUser(t.app, "rex");
    const rexApi = apiClient(t.app, rex.cookie);
    expect((await rexApi.get("/api/me")).status).toBe(200);

    expect(
      (await admin.post("/api/admin/users/ghost/password", { password: "password-456" })).status,
    ).toBe(404);
    expect((await admin.post("/api/admin/users/rex/password", { password: "short" })).status).toBe(
      400,
    );
    expect(
      (await admin.post("/api/admin/users/rex/password", { password: "password-456" })).status,
    ).toBe(204);

    // Both the old session and the old password are invalidated.
    expect((await rexApi.get("/api/me")).status).toBe(401);
    await expect(loginUser(t.app, "rex", "password-123")).rejects.toThrow();
    const again = await loginUser(t.app, "rex", "password-456");
    expect(again.user.passwordIsInitial).toBe(true);
  });

  it("删除用户：owned Project（含目录）连带删除，成员关系随级联清除", async () => {
    const gone = await provisionUser(t.app, "gone");
    const goneApi = apiClient(t.app, gone.cookie);
    expect(
      (await goneApi.post("/api/projects", { projectId: "gone-extra", name: "多余项目" })).status,
    ).toBe(201);
    // gone is also a member of admin's default_project.
    expect(
      (await admin.post("/api/projects/default_project/members", { userId: "gone" })).status,
    ).toBe(201);

    expect((await admin.delete("/api/admin/users/gone")).status).toBe(204);

    // Session and account are invalidated; entry disappears from the list.
    expect((await goneApi.get("/api/me")).status).toBe(401);
    await expect(loginUser(t.app, "gone", "password-123")).rejects.toThrow();
    const list = (await (await admin.get("/api/admin/users")).json()) as AdminUsersResponse;
    expect(list.users.map((u) => u.userId)).toEqual(["admin"]);

    // Both the DB row and the directory for the owned Project are gone.
    const rows = t.deps.db.prepare("SELECT project_id FROM projects ORDER BY project_id").all();
    expect(rows.map((r) => r.project_id)).toEqual(["default_project"]);
    await expect(fs.access(path.join(t.root, "gone-default_project"))).rejects.toThrow();
    await expect(fs.access(path.join(t.root, "gone-extra"))).rejects.toThrow();

    // The membership on default_project has been cascade-cleared.
    const members = (await (
      await admin.get("/api/projects/default_project/members")
    ).json()) as MembersResponse;
    expect(members.members.map((m) => m.userId)).toEqual(["admin"]);
  });

  it("内置 admin 不可删除；未知用户 404", async () => {
    expect((await admin.delete("/api/admin/users/admin")).status).toBe(409);
    expect((await admin.delete("/api/admin/users/ghost")).status).toBe(404);
  });
});
