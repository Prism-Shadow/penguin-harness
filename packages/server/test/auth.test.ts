/**
 * Auth flow integration tests (via app.request() injection): admin seeding / login /
 * logout / password change / session / initial Project.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeResponse, ProjectsResponse } from "../src/api/types.js";
import { bootAppDeps } from "../src/app.js";
import { hashPassword, ScryptHasher } from "../src/auth/password.js";
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
  flattenForTests,
  replacementsFor,
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
      'default_model = { provider = "deepseek", model_id = "deepseek-flash" }',
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

  it("two instances on one host stay signed in side by side: a browser's cookie carries the port", async () => {
    // Cookies ignore the port, so a release and a development instance on one host — or two
    // tunnels on a phone — shared `penguin_session`, and signing in to one signed the other out.
    const other = await createTestApp();
    try {
      await provisionUser(t.app, "dana");
      await provisionUser(other.app, "dana");
      const signIn = async (app: TestApp["app"], port: number) => {
        const res = await app.request("/api/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: `phone.example:${port}`,
            origin: `http://phone.example:${port}`,
          },
          body: JSON.stringify({ userId: "dana", password: "password-123" }),
        });
        expect(res.status).toBe(200);
        return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
      };
      const a = await signIn(t.app, 53531);
      const b = await signIn(other.app, 53899);
      expect(a.startsWith("penguin_session_53531=")).toBe(true);
      expect(b.startsWith("penguin_session_53899=")).toBe(true);
      // One jar, both cookies, sent to both — each server finds its own.
      const jar = `${a}; ${b}`;
      const me = (app: TestApp["app"], port: number) =>
        app.request("/api/me", { headers: { cookie: jar, host: `phone.example:${port}` } });
      expect((await me(t.app, 53531)).status).toBe(200);
      expect((await me(other.app, 53899)).status).toBe(200);
      // Signing out of one leaves the other's cookie alone.
      const out = await t.app.request("/api/auth/logout", {
        method: "POST",
        headers: { cookie: jar, host: "phone.example:53531", origin: "http://phone.example:53531" },
      });
      expect(out.status).toBe(204);
      expect(out.headers.get("set-cookie") ?? "").toContain("penguin_session_53531=;");
      expect(out.headers.get("set-cookie") ?? "").not.toContain("penguin_session_53899");
      expect((await me(t.app, 53531)).status).toBe(401);
      expect((await me(other.app, 53899)).status).toBe(200);
    } finally {
      await other.cleanup();
    }
  });

  it("a non-browser sign-in keeps the plain cookie name, and a plain cookie still signs in", async () => {
    // The CLI reads `penguin_session` off the login's Set-Cookie (an older CLI must keep finding
    // it), and sends it back under that name whatever port it talks to.
    await provisionUser(t.app, "erin");
    const res = await t.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:7364" },
      body: JSON.stringify({ userId: "erin", password: "password-123" }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(cookie.startsWith("penguin_session=")).toBe(true);
    const me = await t.app.request("/api/me", { headers: { cookie, host: "localhost:7364" } });
    expect(me.status).toBe(200);
  });

  it("refuses a write a browser made from another origin — another port of this host included", async () => {
    const { cookie } = await provisionUser(t.app, "fay");
    const write = (
      headers: Record<string, string>,
      body: string | Uint8Array = JSON.stringify({ projectId: "fay-one", name: "x" }),
    ) =>
      t.app.request("/api/projects", {
        method: "POST",
        headers: { cookie, host: "localhost:7364", ...headers },
        body,
      });
    const json = { "content-type": "application/json" };
    // `SameSite` lets this one through: same site, different port.
    const sibling = await write({ ...json, origin: "http://localhost:3000" });
    expect(sibling.status).toBe(403);
    expect(((await sibling.json()) as { error: { code: string } }).error.code).toBe(
      "cross_origin_write",
    );
    expect((await write({ ...json, origin: "https://evil.example" })).status).toBe(403);
    expect((await write({ ...json, origin: "null" })).status).toBe(403);
    // This app's own page, and a client that is no browser at all.
    expect((await write({ ...json, origin: "http://localhost:7364" })).status).toBe(201);
    expect(
      (await write({ ...json }, JSON.stringify({ projectId: "fay-two", name: "x" }))).status,
    ).toBe(201);
    // A body with no Content-Type is what `fetch(…, { mode: "no-cors", body: untypedBlob })`
    // sends; the handlers would parse it as JSON without asking, so it is refused outright.
    const bytes = new TextEncoder().encode(JSON.stringify({ projectId: "fay-three", name: "x" }));
    const untyped = await write({ "content-length": String(bytes.byteLength) }, bytes);
    expect(untyped.status).toBe(415);
    // A write with neither a type nor a body is still fine (logout, say).
    expect(
      (await t.app.request("/api/auth/logout", { method: "POST", headers: { cookie } })).status,
    ).toBe(204);
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

  it("ignores x-forwarded-proto for the Secure flag unless the proxy is trusted", async () => {
    // Caller-supplied, and untrusted by default (the stance hmr/routes.ts states). Trusting
    // it would let anyone who can reach a plain-HTTP port make the server hand out a Secure
    // cookie the browser then refuses to send back over that same connection.
    const login = await t.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ userId: "admin", password: TEST_ADMIN_PASSWORD }),
    });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).not.toContain("Secure");

    // With the deployment opting in, the same header is honored.
    const trusting = await createTestApp({ config: { trustProxy: true } });
    try {
      const res = await trusting.app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
        body: JSON.stringify({ userId: "admin", password: TEST_ADMIN_PASSWORD }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toContain("Secure");
    } finally {
      await trusting.cleanup();
    }
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
    const deps = flattenForTests(
      await bootAppDeps(
        { ...testConfig(root), seedAdminPassword: "x" },
        replacementsFor({ log: () => {} }),
      ),
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

  it("answers an unknown username exactly as it answers a wrong password", async () => {
    await provisionUser(t.app, "carol");
    // An account whose stored hash cannot be checked is no different either.
    await provisionUser(t.app, "grace");
    t.deps.db.prepare("UPDATE users SET password_hash = ? WHERE user_id = ?").run("", "grace");
    const attempt = async (userId: string, password: string) => {
      const res = await t.app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, password }),
      });
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers),
        body: await res.text(),
      };
    };
    const wrongPassword = await attempt("carol", "wrong-password");
    expect(wrongPassword.status).toBe(401);
    expect(JSON.parse(wrongPassword.body)).toEqual({
      error: { code: "invalid_credentials", message: "Incorrect username or password." },
    });
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
    expect(await attempt("nobody", "wrong-password")).toEqual(wrongPassword);
    expect(await attempt("grace", "password-123")).toEqual(wrongPassword);
  });

  it("checks an unknown username against a dummy hash made once, by the server's own hasher", async () => {
    const root = await makeTempRoot();
    const hashed: string[] = [];
    const hasher = {
      async hash(password: string): Promise<string> {
        const stored = await hashPassword(password, 2);
        hashed.push(stored);
        return stored;
      },
    };
    const deps = flattenForTests(
      await bootAppDeps(testConfig(root), [
        ...replacementsFor({ log: () => {} }),
        [ScryptHasher, hasher],
      ]),
    );
    const invalid = { status: 401, code: "invalid_credentials" };
    try {
      await deps.authService.seedAdmin();
      expect(hashed).toHaveLength(1);
      // A wrong password on a real account is checked against that account's hash: no dummy.
      await expect(deps.authService.login("admin", "wrong-password")).rejects.toMatchObject(
        invalid,
      );
      expect(hashed).toHaveLength(1);
      // The first unknown username makes the dummy, and every later one reuses it.
      await expect(deps.authService.login("ghost", "whatever-123")).rejects.toMatchObject(invalid);
      expect(hashed).toHaveLength(2);
      await expect(deps.authService.login("phantom", "whatever-123")).rejects.toMatchObject(
        invalid,
      );
      expect(hashed).toHaveLength(2);
    } finally {
      deps.hmr.dispose();
      deps.channels.dispose();
      deps.db.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("adminPasswordIs verifies the pin against the hash, not the config", async () => {
    // Sole consumer is the startup notice gate: a pinned seed normally silences the
    // first-login link, but an offline reset makes the pin stale — the gate must notice.
    expect(await t.deps.authService.adminPasswordIs(TEST_ADMIN_PASSWORD)).toBe(true);
    expect(await t.deps.authService.adminPasswordIs("not-the-password")).toBe(false);
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
