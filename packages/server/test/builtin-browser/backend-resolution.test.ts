/**
 * Which browser a call drives, in the real platform tree.
 *
 * - Given a server without the desktop shell, every user's backend is their own Chrome, and
 *   choosing the built-in browser is refused (405 `not_supported`).
 * - Given the desktop, an admin starts on the built-in browser and may switch to Chrome; the
 *   choice is kept per user and their windows hear it.
 * - A member never drives the built-in browser: their backend is Chrome, choosing built-in is
 *   403, and a built-in preference written behind the route's back is 403 too.
 * - Chrome that cannot be driven says why: not paired, paired but not connected, or switched off
 *   by the admin — and never falls back to the built-in browser.
 * - A switch waits for the agent's action in flight on the backend being left (409
 *   `action_in_flight`).
 * - An agent's call (the admin API token naming its session) acts for the person who last
 *   started a run in that session, else the session's Project owner — so it drives their Chrome.
 * - Only the person chooses: the API token can neither switch backends nor mint a pairing code,
 *   and a prefs write cannot set the backend.
 * - The built-in browser's history, import and data are not Chrome's: 405 on chrome.
 */
import { assistantText } from "@prismshadow/penguin-core";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BrowserBackendResponse,
  BrowserExtensionPairResponse,
  BrowserExtensionPairingResponse,
  BuiltinBrowserServerEvent,
  BuiltinBrowserStatus,
} from "../../src/api/types.js";
import { hashPassword } from "../../src/auth/password.js";
import { userChannelKey } from "../../src/http/routes/events.js";
import type { Users } from "../../src/mechanisms/identity.js";
import { adoptSession, fakeSession, uniqueSessionId } from "../fixtures/session.js";
import {
  apiClient,
  createDesktopApp,
  createTestApp,
  desktopLoginCookie,
  loginAdmin,
  loginUser,
  provisionUser,
  waitFor,
} from "../helpers.js";
import type { TestApp } from "../helpers.js";
import { FakeShell, tab } from "./fake-shell.js";

let t: TestApp | null = null;
afterEach(async () => {
  await t?.cleanup();
  t = null;
});

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const errorOf = async (res: Response) =>
  (await res.json()) as { error: { code: string; reason?: string } };

/** Pairs a Chrome to the cookie's user through the two pairing routes; it never connects. */
async function pair(app: TestApp["app"], cookie: string): Promise<BrowserExtensionPairResponse> {
  const minted = await apiClient(app, cookie).post("/api/builtin-browser/extension/pairings");
  const { code } = await json<BrowserExtensionPairingResponse>(minted);
  const res = await app.request("/api/builtin-browser/extension/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name: "Chrome 130 on Linux", version: "0.2.13" }),
  });
  expect(res.status).toBe(200);
  return json<BrowserExtensionPairResponse>(res);
}

describe("a server without the desktop shell", () => {
  it("drives every user's own Chrome, and has no built-in browser to choose", async () => {
    t = await createTestApp();
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect(
      await json<BrowserBackendResponse>(await admin.get("/api/builtin-browser/backend")),
    ).toEqual({ backend: "chrome", choices: ["chrome"] });
    const refused = await admin.put("/api/builtin-browser/backend", { backend: "builtin" });
    expect(refused.status).toBe(405);
    expect((await errorOf(refused)).error.code).toBe("not_supported");
  });

  it("says why Chrome cannot be driven: not paired, then not connected, then switched off", async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "bob");
    const bob = apiClient(t.app, cookie);
    const reasonOf = async () =>
      (await json<BuiltinBrowserStatus>(await bob.get("/api/builtin-browser/status"))).reason;
    const actionReason = async () => {
      const res = await bob.post("/api/builtin-browser/tabs", {});
      expect(res.status).toBe(503);
      return (await errorOf(res)).error.reason;
    };

    expect(await reasonOf()).toBe("extension_not_paired");
    expect(await actionReason()).toBe("extension_not_paired");
    await pair(t.app, cookie);
    expect(await reasonOf()).toBe("extension_disconnected");
    expect(await actionReason()).toBe("extension_disconnected");

    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    await admin.put("/api/admin/settings", { browserExtensionsEnabled: false });
    expect(await reasonOf()).toBe("extension_disabled");
    expect(await actionReason()).toBe("extension_disabled");
    const minted = await bob.post("/api/builtin-browser/extension/pairings");
    expect(minted.status).toBe(503);
    expect((await errorOf(minted)).error.reason).toBe("extension_disabled");
    // Turned on again, the pairing is still there.
    await admin.put("/api/admin/settings", { browserExtensionsEnabled: true });
    expect(await reasonOf()).toBe("extension_disconnected");
  });

  it("answers the built-in browser's history, import and data with not_supported", async () => {
    t = await createTestApp();
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    for (const res of [
      await admin.get("/api/builtin-browser/history"),
      await admin.get("/api/builtin-browser/import/sources"),
      await admin.post("/api/builtin-browser/import", { sourceId: "chrome" }),
      await admin.post("/api/builtin-browser/clear-data", { storages: ["cookies"] }),
    ]) {
      expect(res.status).toBe(405);
      expect((await errorOf(res)).error.code).toBe("not_supported");
    }
  });
});

describe("the desktop", () => {
  it("starts an admin on the built-in browser, switches them to Chrome, and tells their windows", async () => {
    const shell = new FakeShell();
    t = await createDesktopApp({ browserShellPort: shell.port });
    const events: BuiltinBrowserServerEvent[] = [];
    t.deps.channels
      .get(userChannelKey("admin"))
      .subscribe((evt) => events.push(JSON.parse(evt.data) as BuiltinBrowserServerEvent));
    const admin = apiClient(t.app, await desktopLoginCookie(t.app));

    expect(
      await json<BrowserBackendResponse>(await admin.get("/api/builtin-browser/backend")),
    ).toEqual({ backend: "builtin", choices: ["builtin", "chrome"] });
    const switched = await admin.put("/api/builtin-browser/backend", { backend: "chrome" });
    expect(await json<BrowserBackendResponse>(switched)).toEqual({
      backend: "chrome",
      choices: ["builtin", "chrome"],
    });
    expect(events).toContainEqual({ type: "builtin_browser_backend", backend: "chrome" });
    // No fallback: Chrome is not paired, and the built-in browser is not used instead.
    const status = await json<BuiltinBrowserStatus>(await admin.get("/api/builtin-browser/status"));
    expect(status).toMatchObject({
      backend: "chrome",
      available: false,
      reason: "extension_not_paired",
    });
    expect((await admin.post("/api/builtin-browser/tabs", {})).status).toBe(503);
    // Back to built-in: the shell answers again.
    await admin.put("/api/builtin-browser/backend", { backend: "builtin" });
    expect(
      await json<BuiltinBrowserStatus>(await admin.get("/api/builtin-browser/status")),
    ).toMatchObject({ backend: "builtin", available: true });
  });

  it("never lets a member drive the built-in browser", async () => {
    const shell = new FakeShell();
    t = await createDesktopApp({ browserShellPort: shell.port });
    // The desktop manages no accounts, but its data root may hold one `penguin web` created.
    t.deps.tree.api<Users>("IdentityModule", "Users").insert({
      userId: "bob",
      passwordHash: await hashPassword("password-123", 2),
      isAdmin: false,
      passwordIsInitial: false,
      displayName: null,
      avatar: null,
      createdAt: new Date().toISOString(),
    });
    const bob = apiClient(t.app, (await loginUser(t.app, "bob", "password-123")).cookie);
    expect(
      await json<BrowserBackendResponse>(await bob.get("/api/builtin-browser/backend")),
    ).toEqual({ backend: "chrome", choices: ["chrome"] });
    const status = await json<BuiltinBrowserStatus>(await bob.get("/api/builtin-browser/status"));
    expect(status.backends.map((b) => b.backend)).toEqual(["chrome"]);
    const chosen = await bob.put("/api/builtin-browser/backend", { backend: "builtin" });
    expect(chosen.status).toBe(403);
    expect((await errorOf(chosen)).error.code).toBe("admin_required");

    // A built-in preference that got into the store anyway buys nothing.
    t.deps.prefsRepo.set("bob", JSON.stringify({ browserBackend: "builtin" }));
    const refused = await bob.get("/api/builtin-browser/status");
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).error.code).toBe("admin_required");
    expect((await bob.post("/api/builtin-browser/tabs/active/scan", {})).status).toBe(403);
  });

  it("refuses a switch while an agent acts in the browser being left", async () => {
    const shell = new FakeShell();
    shell.guests.set(3, tab(3));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    shell.cdp = async (_tabId, method) => {
      if (method === "Page.getLayoutMetrics") await gate;
      return {};
    };
    t = await createDesktopApp({ browserShellPort: shell.port });
    const admin = apiClient(t.app, await desktopLoginCookie(t.app));
    await admin.get("/api/builtin-browser/status");

    const acting = admin.post("/api/builtin-browser/tabs/3/cdp", {
      method: "Page.getLayoutMetrics",
    });
    await waitFor(() => shell.commands.some((c) => c.op === "cdp"));
    const refused = await admin.put("/api/builtin-browser/backend", { backend: "chrome" });
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).error.code).toBe("action_in_flight");

    release();
    expect((await acting).status).toBe(200);
    expect((await admin.put("/api/builtin-browser/backend", { backend: "chrome" })).status).toBe(
      200,
    );
  });
});

describe("an agent's call", () => {
  it("drives the Chrome of the person who started its session's run, else the Project owner's", async () => {
    t = await createTestApp();
    const adminLogin = await loginAdmin(t.app);
    const admin = apiClient(t.app, adminLogin.cookie);
    // The admin's Chrome is paired (not connected); bob, a member of the admin's Project, has none.
    await pair(t.app, adminLogin.cookie);
    const bob = apiClient(t.app, (await provisionUser(t.app, "bob")).cookie);
    expect(
      (await admin.post("/api/projects/default_project/members", { userId: "bob" })).status,
    ).toBe(201);
    const prompted = uniqueSessionId();
    adoptSession(
      t.deps,
      fakeSession(prompted, {
        async *run() {
          yield assistantText("done");
        },
      }),
      { projectId: "default_project" },
    );
    const untouched = uniqueSessionId();
    adoptSession(t.deps, fakeSession(untouched), { projectId: "default_project" });
    const run = await bob.post(`/api/sessions/${prompted}/tasks`, {
      input: [{ type: "text", text: "look this up" }],
    });
    expect(run.status).toBe(202);
    await waitFor(() => t!.deps.manager.statusOf(prompted) === "idle");

    const token = t.deps.authService.localApiToken();
    const agent = async (sessionId?: string) => {
      const query = sessionId !== undefined ? `?sessionId=${sessionId}` : "";
      const res = await t!.app.request(`/api/builtin-browser/status${query}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      return (await json<BuiltinBrowserStatus>(res)).reason;
    };
    expect(await agent(prompted)).toBe("extension_not_paired");
    expect(await agent(untouched)).toBe("extension_disconnected");
    expect(await agent()).toBe("extension_disconnected");
    // In a body, as the CLI sends it.
    const action = await t.app.request("/api/builtin-browser/tabs", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sessionId: prompted }),
    });
    expect((await errorOf(action)).error.reason).toBe("extension_not_paired");
  });

  it("can neither switch backends nor mint a pairing code; nor can a prefs write", async () => {
    t = await createTestApp();
    const token = t.deps.authService.localApiToken();
    const asAgent = (method: string, path: string, body?: unknown) =>
      t!.app.request(path, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    for (const res of [
      await asAgent("PUT", "/api/builtin-browser/backend", { backend: "chrome" }),
      await asAgent("POST", "/api/builtin-browser/extension/pairings"),
    ]) {
      expect(res.status).toBe(403);
      expect((await errorOf(res)).error.code).toBe("human_required");
    }
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const prefs = await admin.put("/api/me/prefs", { browserBackend: "chrome" });
    expect(prefs.status).toBe(400);
  });
});
