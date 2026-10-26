/**
 * The auth flow through the routes: admin seeding, login, logout, password change, the session
 * cookie, the initial Project and the account's UI preferences.
 *
 * - A protected API answers 401 without a session; registration does not exist.
 * - The seeded admin owns default_project with its default Agent, carries the initial-password
 *   flag, and a second seed neither duplicates the account nor rerolls its password.
 * - An admin-created account gets `<userId>-default_project`, named after the user, with the
 *   preset default model.
 * - Login, /api/me and logout round-trip; a wrong password is 401.
 * - Changing one's own password checks the old one and the policy, keeps the current session,
 *   clears the initial flag, and retires the old password.
 * - The Secure cookie flag follows x-forwarded-proto only when the proxy is trusted.
 * - A write from another origin is refused — the Agent API's keyed request excepted — while a
 *   domain's case and a scheme's default port name the same origin; a browser's cookie carries
 *   the port it reached the server on.
 * - A write with a non-JSON Content-Type is refused (CSRF defense).
 * - A seed password below the policy is refused before any account is created.
 * - Login failures back off per username, unknown usernames identically, and a success resets
 *   the counter; an unknown username, a wrong password and an uncheckable hash answer alike.
 * - An unknown username is checked against one dummy hash, made once by the server's hasher.
 * - The admin-password check reads the stored hash, not the configured pin.
 * - Generated initial passwords are 24 base64url characters and never repeat.
 * - Preferences start empty, and each PUT merges without clobbering another writer's fields.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentApiKeyCreateResponse, MeResponse, ProjectsResponse } from "../src/api/types.js";
import { bootAppDeps } from "../src/app.js";
import { hashPassword, ScryptHasher } from "../src/auth/password.js";
import {
  isOwnOrigin,
  parseCookieHeader,
  sessionCookieName,
  sameOriginWrites,
  jsonOnlyWrites,
} from "../src/auth/middleware.js";
import { Hono } from "hono";
import { identityFrom } from "../src/terminal/identity.js";
import { mediaType } from "../src/http/media-type.js";
import { handleError } from "../src/http/errors.js";
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
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";

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
        const res = await app.request(`http://phone.example:${port}/api/auth/login`, {
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
        app.request(`http://phone.example:${port}/api/me`, {
          headers: { cookie: jar, host: `phone.example:${port}` },
        });
      expect((await me(t.app, 53531)).status).toBe(200);
      expect((await me(other.app, 53899)).status).toBe(200);
      // Signing out of one leaves the other's cookie alone.
      const out = await t.app.request("http://phone.example:53531/api/auth/logout", {
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
      t.app.request("http://localhost:7364/api/projects", {
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

  it("lets a cross-origin Agent API write through to its key gate, and never takes a cookie there", async () => {
    // The Agent API answers any origin's preflight and sends `Access-Control-Allow-Origin: *`
    // to a request carrying `Authorization` (the server-api page states it): a page outside this
    // app calls it with the Agent's key. The same-origin guard must not refuse that write before
    // the group's own gate has read the key…
    const admin = await loginAdmin(t.app);
    const api = apiClient(t.app, admin.cookie);
    const base = "/api/projects/default_project/agents/default_agent/api";
    expect((await api.put(base, { enabled: true })).status).toBe(200);
    const key = (
      (await (
        await api.post(`${base}/keys`, { name: "cross-origin suite" })
      ).json()) as AgentApiKeyCreateResponse
    ).secret;
    const sessionId = uniqueSessionId();
    adoptSession(t.deps, fakeSession(sessionId), {
      projectId: "default_project",
      agentId: "default_agent",
      client: "api",
    });
    const abort = (headers: Record<string, string>) =>
      t.app.request(`http://localhost:7364/api/amsp/v1/sessions/${sessionId}/abort`, {
        method: "POST",
        headers: { host: "localhost:7364", ...headers },
      });

    const keyed = await abort({
      origin: "http://elsewhere.example",
      authorization: `Bearer ${key}`,
    });
    expect(keyed.status).toBe(204);
    expect(keyed.headers.get("access-control-allow-origin")).toBe("*");
    // …and a wrong key is the gate's own 401, not the guard's 403: proof it reached the group.
    const wrong = await abort({
      origin: "http://elsewhere.example",
      authorization: "Bearer no-key",
    });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
    expect(wrong.headers.get("access-control-allow-origin")).toBe("*");

    // A cookie is no credential at the Agent API: from another origin the guard refuses the
    // write, and from this one the gate answers the 401 that a missing key earns.
    const { cookie } = await provisionUser(t.app, "gina");
    const withCookie = await abort({ origin: "http://elsewhere.example", cookie });
    expect(withCookie.status).toBe(403);
    expect(((await withCookie.json()) as { error: { code: string } }).error.code).toBe(
      "cross_origin_write",
    );
    expect((await abort({ origin: "http://elsewhere.example" })).status).toBe(403);
    expect((await abort({ origin: "http://localhost:7364", cookie })).status).toBe(401);

    // A keyed call from this origin, and one from a client that is no browser, are as before.
    expect(
      (await abort({ origin: "http://localhost:7364", authorization: `Bearer ${key}` })).status,
    ).toBe(204);
    expect((await abort({ authorization: `Bearer ${key}` })).status).toBe(204);
  });

  it("reads an origin normalized: a domain's case and a scheme's default port name one origin", async () => {
    const { cookie } = await provisionUser(t.app, "hugo");
    const write = (host: string, origin: string, projectId: string) =>
      t.app.request(`${new URL(origin).protocol}//${host}/api/projects`, {
        method: "POST",
        headers: { cookie, host, origin, "content-type": "application/json" },
        body: JSON.stringify({ projectId, name: "x" }),
      });
    // A Host that spells out the scheme's default port, whichever side writes it.
    expect((await write("example.com:80", "http://example.com", "hugo-one")).status).toBe(201);
    expect((await write("example.com", "http://example.com:80", "hugo-two")).status).toBe(201);
    expect((await write("example.com:443", "https://example.com", "hugo-three")).status).toBe(201);
    // A domain name is case-insensitive.
    expect((await write("EXAMPLE.com:7364", "http://Example.COM:7364", "hugo-four")).status).toBe(
      201,
    );
    // Any other port is a different origin, whichever side spells it. A Host with no port means
    // the scheme's default, so it does not admit an Origin that names a port at all.
    expect((await write("example.com:443", "http://example.com", "hugo-five")).status).toBe(403);
    expect((await write("example.com:81", "http://example.com:80", "hugo-six")).status).toBe(403);
    expect((await write("example.com", "http://example.com:8443", "hugo-seven")).status).toBe(403);
    expect((await write("example.com:8443", "http://example.com", "hugo-eight")).status).toBe(403);
  });

  it("names a browser's cookie after the normalized request URL port", async () => {
    await provisionUser(t.app, "iris");
    const signIn = (host: string, origin: string) =>
      t.app.request(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", host, origin },
        body: JSON.stringify({ userId: "iris", password: "password-123" }),
      });
    // Default ports normalize away on both issue and lookup.
    const plain = await signIn("example.com:80", "http://example.com");
    expect(plain.status).toBe(200);
    const plainCookie = (plain.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(plainCookie.startsWith("penguin_session=")).toBe(true);
    expect(
      (await t.app.request("/api/me", { headers: { cookie: plainCookie, host: "example.com:80" } }))
        .status,
    ).toBe(200);
    // Any other port keeps a name of its own, whatever case the browser spells the host in.
    const keyed = await signIn("Example.COM:7364", "http://example.com:7364");
    expect(keyed.status).toBe(200);
    const keyedCookie = (keyed.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(keyedCookie.startsWith("penguin_session_7364=")).toBe(true);
    expect(
      (
        await t.app.request("http://example.com:7364/api/me", {
          headers: { cookie: keyedCookie, host: "example.com:7364" },
        })
      ).status,
    ).toBe(200);
  });

  it("uses normalized platform URLs for origin checks and terminal identity", async () => {
    expect(isOwnOrigin("http://example.com", new URL("https://example.com"))).toBe(false);
    expect(isOwnOrigin("https://example.com", new URL("https://example.com:443"))).toBe(true);
    expect(isOwnOrigin("http://[0:0:0:0:0:0:0:1]:7364", new URL("http://[::1]:7364"))).toBe(true);
    expect(isOwnOrigin("http://[::1]:7365", new URL("http://[::1]:7364"))).toBe(false);
    expect(isOwnOrigin("http://example.com:8443", new URL("http://example.com"))).toBe(false);
    expect(isOwnOrigin("null", new URL("http://example.com"))).toBe(false);
    expect(isOwnOrigin(undefined, new URL("http://example.com"))).toBe(true);
    for (const url of ["http://example.com:80", "https://example.com:443"]) {
      expect(sessionCookieName(url, true)).toBe("penguin_session");
    }
    for (const [url, port] of [
      ["http://example.com:443", "443"],
      ["https://example.com:80", "80"],
      ["http://[::1]:7364", "7364"],
    ]) {
      expect(sessionCookieName(url!, true)).toBe(`penguin_session_${port}`);
    }
    const identity = identityFrom({
      authenticateWithMeta: (token) => (token === "live" ? { user: { userId: "alice" } } : null),
    });
    for (const url of ["http://example.com:80", "https://example.com:443", "http://[::1]:7364"]) {
      const name = sessionCookieName(url, true);
      expect(await identity(new Request(url, { headers: { cookie: `${name}=live` } }))).toEqual({
        userId: "alice",
      });
    }
    // A conflicting Host no longer overrides the adapter's request URL.
    expect(
      await identity(
        new Request("http://example.com:7364", {
          headers: { host: "example.com:9999", cookie: "penguin_session_7364=live" },
        }),
      ),
    ).toEqual({ userId: "alice" });
  });

  it("uses normalized URL cookie names in the Node upgrade path", async () => {
    for (const [host, origin, name] of [
      ["example.com:80", "http://example.com", "penguin_session"],
      ["[::1]:7364", "http://[::1]:7364", "penguin_session_7364"],
    ]) {
      const server = new EventEmitter();
      attachTerminalWebSocket(server as unknown as Server, {
        hmr: t.deps.hmr,
        authService: t.deps.authService,
        log: () => {},
      });
      const { token } = await t.deps.authService.login("admin", TEST_ADMIN_PASSWORD);
      const reply = await new Promise<string>((resolve) => {
        const socket = { write: (value: string) => resolve(value), destroy: () => {} };
        server.emit(
          "upgrade",
          {
            url: "/api/terminals/missing/stream",
            headers: { host, origin, cookie: `${name}=${token}` },
            socket,
          },
          socket,
          Buffer.alloc(0),
        );
      });
      // 404 proves both the origin and the normalized cookie passed, without creating a pty.
      expect(reply).toContain("404 Not Found");
    }
  });

  it("uses forwarded schemes only behind a trusted proxy and rejects malformed values", async () => {
    for (const trustProxy of [false, true]) {
      const app = new Hono();
      app.onError(handleError);
      app.use("*", sameOriginWrites(trustProxy));
      app.post("/", (c) => c.body(null, 204));
      const write = (forwarded: string, origin = "https://example.com") =>
        app.request("http://example.com/", {
          method: "POST",
          headers: {
            host: "example.com",
            origin,
            "x-forwarded-proto": forwarded,
            "content-type": "application/json",
          },
        });
      // Node sees the HTTP proxy hop; its sanitized external scheme is authoritative only
      // when the deployment explicitly trusts that proxy.
      expect((await write("https")).status).toBe(trustProxy ? 204 : 403);
      expect((await write("https,http")).status).toBe(403);
      expect((await write("ftp")).status).toBe(403);
      expect((await write("http", "http://example.com:8443")).status).toBe(403);
    }
  });

  it("parses media types rather than accepting JSON-looking prefixes", async () => {
    const app = new Hono();
    app.onError(handleError);
    app.use("*", jsonOnlyWrites());
    app.post("/", (c) => c.body(null, 204));
    for (const type of [
      "Application/JSON; charset=utf-8",
      "application/gzip",
      "application/octet-stream",
    ]) {
      expect(
        (await app.request("/", { method: "POST", headers: { "content-type": type } })).status,
      ).toBe(204);
    }
    for (const type of [
      "application/jsonp",
      "application/json-extra",
      "application/gzipfoo",
      "not a media type",
    ]) {
      expect(
        (await app.request("/", { method: "POST", headers: { "content-type": type } })).status,
      ).toBe(415);
    }
    expect(mediaType('Application/Problem+JSON; profile="a;b"')?.subtype).toBe("problem+json");
    expect(mediaType(undefined)).toBeNull();
    expect(mediaType("invalid")).toBeNull();
  });

  it("uses Hono's first duplicate and tolerates malformed cookie escapes", async () => {
    const { cookie } = await loginAdmin(t.app);
    const token = cookie.slice(cookie.indexOf("=") + 1);
    expect(parseCookieHeader(`penguin_session=bad; penguin_session=${token}`).penguin_session).toBe(
      "bad",
    );
    expect(parseCookieHeader("penguin_session=%ZZ").penguin_session).toBe("%ZZ");
    expect(parseCookieHeader('a="hello%20world"').a).toBe("hello world");
    expect(
      (await t.app.request("/api/me", { headers: { cookie: `penguin_session=bad; ${cookie}` } }))
        .status,
    ).toBe(401);
    expect(
      (await t.app.request("/api/me", { headers: { cookie: `${cookie}; penguin_session=bad` } }))
        .status,
    ).toBe(200);
    expect(
      (await t.app.request("/api/me", { headers: { cookie: "penguin_session=%ZZ" } })).status,
    ).toBe(401);
  });

  it("refuses a write that declares a chunked body with no Content-Type", async () => {
    // A page can send a body without a length (`fetch` with a stream), which no HTML form can:
    // the content-type rule has to see the body, not just a content-length that is missing.
    const { cookie } = await provisionUser(t.app, "jane");
    const res = await t.app.request("http://localhost:7364/api/projects", {
      method: "POST",
      headers: {
        cookie,
        host: "localhost:7364",
        origin: "http://localhost:7364",
        "transfer-encoding": "chunked",
      },
      body: JSON.stringify({ projectId: "jane-one", name: "x" }),
    });
    expect(res.status).toBe(415);
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
      // The booted App goes first, as createTestApp's cleanup does: its timers outlive the
      // case otherwise, and in a worker shared across files (isolate: false) the machines'
      // minute look-over then reads this closed database while another file runs.
      deps.hmr.dispose();
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

  it("starts preferences empty, and merges each PUT without clobbering other writers", async () => {
    const { cookie } = await provisionUser(t.app, "fred");
    const api = apiClient(t.app, cookie);
    const prefs = async () =>
      ((await (await api.get("/api/me/prefs")).json()) as { prefs: unknown }).prefs;
    expect(await prefs()).toEqual({});
    // Two independent writers: switching Project writes lastProjectId, onboarding writes
    // credentialGuideSeen. The second write must not erase the first's field (a full replace
    // would drop lastProjectId and bring onboarding back again and again).
    await api.put("/api/me/prefs", { lastProjectId: "p-1" });
    await api.put("/api/me/prefs", { credentialGuideSeen: true });
    expect(await prefs()).toEqual({ lastProjectId: "p-1", credentialGuideSeen: true });
    await api.put("/api/me/prefs", { lastProjectId: "p-2" });
    expect(await prefs()).toEqual({ lastProjectId: "p-2", credentialGuideSeen: true });
  });
});
