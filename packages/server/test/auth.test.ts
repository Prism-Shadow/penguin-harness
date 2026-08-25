/**
 * Auth flow integration tests (via app.request() injection): admin seeding / login /
 * logout / password change / session / initial Project.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeResponse, ProjectsResponse } from "../src/api/types.js";
import { bootAppDeps } from "../src/app.js";
import { generateInitialAdminPassword } from "../src/auth/service.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  loginUser,
  makeTempRoot,
  provisionUser,
  TEST_ADMIN_PASSWORD,
  testConfig,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("auth", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("accessing a protected API while not logged in returns 401", async () => {
    const res = await t.app.request("/api/projects");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("registration is closed: no register endpoint", async () => {
    // /api/auth is the runtime's own public namespace (the business platform declines it
    // wholesale), so an unknown path in it is an honest 404, logged in or not.
    const anon = await t.app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice", password: "password-123" }),
    });
    expect(anon.status).toBe(404);
    // Logged in: same 404, proving the route has indeed been removed.
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).post("/api/auth/register", {
      userId: "alice",
      password: "password-123",
    });
    expect(res.status).toBe(404);
  });

  it("seeded admin manages default_project; initial password carries the flag", async () => {
    const admin = await loginAdmin(t.app);
    expect(admin.user.isAdmin).toBe(true);
    expect(admin.user.passwordIsInitial).toBe(true);
    const api = apiClient(t.app, admin.cookie);
    const projects = (await (await api.get("/api/projects")).json()) as ProjectsResponse;
    expect(projects.projects.map((p) => p.projectId)).toContain("default_project");
    expect(projects.projects[0]!.role).toBe("owner");
    // default_agent has been initialized (directory exists).
    await expect(
      fs.access(path.join(t.root, "default_project", "agents", "default_agent", "agent_state")),
    ).resolves.toBeUndefined();
    // Seeding is idempotent: re-seeding neither duplicates the account nor rerolls its
    // password — the original still signs in.
    await t.deps.authService.seedAdmin();
    expect(t.deps.db.prepare("SELECT COUNT(*) AS n FROM users").get()?.n).toBe(1);
    await loginAdmin(t.app);
  });

  it("admin-created: default Project is <userId>-default_project, name defaults", async () => {
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
      'default_model = { provider = "deepseek", model_id = "deepseek-v4-flash" }',
    );
  });

  it("login / me / logout round trip; wrong password 401", async () => {
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

  it("self password change: old checked, new takes effect, initial flag cleared", async () => {
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

  it("write requests reject non-JSON Content-Type (CSRF defense)", async () => {
    const res = await t.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "userId=a&password=b",
    });
    expect(res.status).toBe(415);
  });

  it("ui prefs read/write", async () => {
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

  it("seedAdmin rejects an override below the password policy before creating the account", async () => {
    const root = await makeTempRoot();
    const deps = await bootAppDeps(
      { ...testConfig(root), seedAdminPassword: "x" },
      { log: () => {} },
    );
    try {
      await expect(deps.authService.seedAdmin()).rejects.toThrow(/at least 8 characters/);
      // Rejected before any insert: no half-created privileged account to retry around.
      expect(deps.db.prepare("SELECT COUNT(*) AS n FROM users").get()?.n).toBe(0);
    } finally {
      deps.channels.dispose();
      deps.db.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("throttles login failures per username with exponential backoff and resets on success", async () => {
    let clock = Date.parse("2026-08-03T00:00:00Z");
    const fresh = await createTestApp({ now: () => new Date(clock) });
    try {
      const attempt = (password: string) =>
        fresh.app.request("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: "admin", password }),
        });
      // Five free failures, and the sixth still reaches verification (backoff starts after it).
      for (let i = 0; i < 6; i++) expect((await attempt("wrong-password")).status).toBe(401);
      // Inside the 1s window: rejected without touching credentials — even the CORRECT password.
      const throttled = await attempt("wrong-password");
      expect(throttled.status).toBe(429);
      const body = (await throttled.json()) as { error: { code: string } };
      expect(body.error.code).toBe("too_many_attempts");
      expect((await attempt(TEST_ADMIN_PASSWORD)).status).toBe(429);
      // Past the window, the correct password signs in and clears the counter…
      clock += 1100;
      await loginUser(fresh.app, "admin", TEST_ADMIN_PASSWORD);
      // …so the next failure is an ordinary 401 again, not a 429.
      expect((await attempt("wrong-password")).status).toBe(401);
    } finally {
      await fresh.cleanup();
    }
  });

  it("throttles unknown usernames identically (no account-existence oracle)", async () => {
    let clock = Date.parse("2026-08-03T00:00:00Z");
    const fresh = await createTestApp({ now: () => new Date(clock) });
    try {
      const attempt = () =>
        fresh.app.request("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: "ghost", password: "whatever-123" }),
        });
      for (let i = 0; i < 6; i++) expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(429);
      // The window expires on the same schedule as for real accounts.
      clock += 1100;
      expect((await attempt()).status).toBe(401);
    } finally {
      await fresh.cleanup();
    }
  });

  it("generateInitialAdminPassword is 24 base64url characters, and never repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) {
      const password = generateInitialAdminPassword();
      expect(password).toMatch(/^[A-Za-z0-9_-]{24}$/);
      seen.add(password);
    }
    // Drawn from randomBytes, not from a small printable space that a login endpoint could
    // be walked through.
    expect(seen.size).toBe(64);
  });

  it("PUT prefs shallow-merges without clobbering other writers' fields", async () => {
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
