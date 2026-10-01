/**
 * Semantic ids through the create routes: a Project or Agent id is chosen by its creator —
 * a lowercase letter first, then lowercase letters, digits and underscores — and checked for
 * collisions against the DB and the directory (built-in reserved ids included). The hyphen is
 * a reserved separator: a non-admin's Project id is "<username>-<suffix>", an admin's has none.
 *
 * - An admin creates a Project under a valid id (its display name defaulting to the id) and is
 *   refused an invalid one; a DB-taken, directory-only-taken or reserved id is a 409.
 * - A non-admin's Project id must carry their own prefix and a valid suffix.
 * - A Project creation that fails midway rolls back its row and directory, so the same id can
 *   be retried; an Agent creation that fails midway rolls back its directory the same way.
 * - An Agent id is validated the same way, initializes the Agent, collides within its Project
 *   (built-ins included) but not across Projects, and its display name is free-form.
 *
 * Every case creates distinct ids, so one app serves them all.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentCreateResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

// "项目" stays Chinese on purpose: ids must reject CJK (ASCII lowercase only).
const BAD_IDS = ["Foo", "1abc", "a", "-abc", "a-b", "a b", "a.b", "项目", "a".repeat(65)];

describe("semantic ids", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let api: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    api = apiClient(t.app, (await provisionUser(t.app, "ida")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("gives an admin's Project a valid bare id, its name defaulting to the id, and refuses an invalid one", async () => {
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

  it("refuses a DB-taken, directory-only or reserved Project id as taken", async () => {
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

  it("makes a non-admin's Project id carry their own prefix and a valid suffix", async () => {
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

  it("rolls back a Project creation that fails midway, so the same id can be retried", async () => {
    // Inject a config write failure (handleError logs the stack trace: silence it so it doesn't
    // clutter output). The app is shared, so the real writer goes back whatever happens.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const original = t.deps.projectConfigService.writeInitialConfig;
    t.deps.projectConfigService.writeInitialConfig = async () => {
      throw new Error("config write blew up");
    };
    try {
      expect((await admin.post("/api/projects", { projectId: "flaky", name: "x" })).status).toBe(
        500,
      );
    } finally {
      t.deps.projectConfigService.writeInitialConfig = original;
    }
    // No leftovers: neither the directory nor the DB row exist, so the id isn't held by an orphaned directory.
    await expect(fs.access(path.join(t.root, "flaky"))).rejects.toThrow();
    expect(
      t.deps.db.prepare("SELECT 1 AS x FROM projects WHERE project_id = ?").get("flaky"),
    ).toBeUndefined();
    expect((await admin.post("/api/projects", { projectId: "flaky", name: "x" })).status).toBe(201);
  });

  it("rolls back an Agent creation that fails midway, so the same id can be retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const original = t.deps.agentConfigService.updateConfig;
    t.deps.agentConfigService.updateConfig = async () => {
      throw new Error("config write blew up");
    };
    try {
      expect(
        (await api.post("/api/projects/ida-default_project/agents", { agentId: "flaky" })).status,
      ).toBe(500);
    } finally {
      t.deps.agentConfigService.updateConfig = original;
    }
    await expect(
      fs.access(path.join(t.root, "ida-default_project", "agents", "flaky")),
    ).rejects.toThrow();
    expect(
      (await api.post("/api/projects/ida-default_project/agents", { agentId: "flaky" })).status,
    ).toBe(201);
  });

  it("validates an Agent id, initializes the Agent, and checks collisions within its Project only", async () => {
    for (const bad of BAD_IDS) {
      const res = await api.post("/api/projects/ida-default_project/agents", {
        agentId: bad,
        name: "x",
      });
      expect(res.status, `agentId=${bad}`).toBe(400);
    }

    // Unlike ids, display names are free-form — a CJK name must round-trip untouched.
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
        path.join(
          t.root,
          "ida-default_project",
          "agents",
          "crawler",
          "agent_state",
          "system_config.yaml",
        ),
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
