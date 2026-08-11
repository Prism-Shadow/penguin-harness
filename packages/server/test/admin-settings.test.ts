/**
 * Admin server-settings route tests: permission boundary (non-admin 403), the proxy
 * defaults (absent rows read as both switches on, no explicit address), adoption of the
 * legacy single-switch key, PUT persistence and validation (proxy-address normalization
 * and rejection), and merge semantics (an omitted field keeps its current value; a
 * rejected PUT writes nothing).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerSettingsResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("admin server settings", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const getSettings = async (api: ReturnType<typeof apiClient> = admin) => {
    const res = await api.get("/api/admin/settings");
    expect(res.status).toBe(200);
    return (await res.json()) as ServerSettingsResponse;
  };

  it("non-admin access is always 403", async () => {
    const { cookie } = await provisionUser(t.app, "norm");
    const api = apiClient(t.app, cookie);
    expect((await api.get("/api/admin/settings")).status).toBe(403);
    expect((await api.put("/api/admin/settings", { proxyForApp: false })).status).toBe(403);
    // The failed PUT changed nothing.
    expect((await getSettings()).settings.proxyForApp).toBe(true);
  });

  it("defaults while no rows exist: both switches on, no explicit address", async () => {
    expect(t.deps.db.prepare("SELECT COUNT(*) AS n FROM server_settings").get()).toMatchObject({
      n: 0,
    });
    const { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(true);
    expect(settings.proxyForAgent).toBe(true);
    expect(settings.proxyUrl).toBeNull();
  });

  it("adopts the legacy use_system_proxy row as the default for BOTH switches", async () => {
    // The single switch shipped only on unreleased main (#225): a deployment that had
    // toggled it off must keep that choice for both new switches, with no migration —
    // the legacy key is read as a fallback, never rewritten.
    t.deps.serverSettingsRepo.set("use_system_proxy", "false");
    let { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(false);
    expect(settings.proxyForAgent).toBe(false);
    // Setting one NEW switch writes only its own key: the other still follows legacy.
    await admin.put("/api/admin/settings", { proxyForApp: true });
    ({ settings } = await getSettings());
    expect(settings.proxyForApp).toBe(true);
    expect(settings.proxyForAgent).toBe(false);
    // The legacy row itself was never touched.
    expect(t.deps.serverSettingsRepo.get("use_system_proxy")).toBe("false");
  });

  it("PUT persists the switches independently and echoes the full settings", async () => {
    const appOff = await admin.put("/api/admin/settings", { proxyForApp: false });
    expect(appOff.status).toBe(200);
    const afterAppOff = ((await appOff.json()) as ServerSettingsResponse).settings;
    expect(afterAppOff.proxyForApp).toBe(false);
    expect(afterAppOff.proxyForAgent).toBe(true);
    // Round-trips through the repo (the DB rows, not process state, are what GET serves).
    expect(t.deps.serverSettingsRepo.getProxyForApp()).toBe(false);
    expect(t.deps.serverSettingsRepo.getProxyForAgent()).toBe(true);

    const agentOff = await admin.put("/api/admin/settings", { proxyForAgent: false });
    expect(agentOff.status).toBe(200);
    const { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(false);
    expect(settings.proxyForAgent).toBe(false);
  });

  it("an omitted field keeps its current value; a non-boolean is 400", async () => {
    await admin.put("/api/admin/settings", { proxyForApp: false });
    // Empty PUT: no-op, still returns the current settings.
    const noop = await admin.put("/api/admin/settings", {});
    expect(noop.status).toBe(200);
    expect(((await noop.json()) as ServerSettingsResponse).settings.proxyForApp).toBe(false);
    // Type check: only booleans are accepted, and a rejected write changes nothing.
    expect((await admin.put("/api/admin/settings", { proxyForApp: "on" })).status).toBe(400);
    expect((await admin.put("/api/admin/settings", { proxyForAgent: 1 })).status).toBe(400);
    const { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(false);
    expect(settings.proxyForAgent).toBe(true);
  });

  const putProxyUrl = async (proxyUrl: unknown) => admin.put("/api/admin/settings", { proxyUrl });

  it("PUT normalizes the proxy address and stores/echoes only the normalized form", async () => {
    // Bare host[:port] shorthand → http://.
    const bare = await putProxyUrl("proxy.corp.example:8080");
    expect(bare.status).toBe(200);
    expect(((await bare.json()) as ServerSettingsResponse).settings.proxyUrl).toBe(
      "http://proxy.corp.example:8080",
    );
    expect((await getSettings()).settings.proxyUrl).toBe("http://proxy.corp.example:8080");
    expect(t.deps.serverSettingsRepo.getProxyUrl()).toBe("http://proxy.corp.example:8080");
    // https passes through; surrounding whitespace is trimmed.
    const https = await putProxyUrl("  https://proxy.corp.example:3128  ");
    expect(https.status).toBe(200);
    expect(((await https.json()) as ServerSettingsResponse).settings.proxyUrl).toBe(
      "https://proxy.corp.example:3128",
    );
  });

  it("PUT rejects a bad proxy address with invalid_proxy_url and stores nothing", async () => {
    await putProxyUrl("http://proxy.corp.example:8080");
    for (const bad of ["socks5://proxy.corp.example:1080", "not a proxy", 42]) {
      const res = await putProxyUrl(bad);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_proxy_url");
    }
    expect((await getSettings()).settings.proxyUrl).toBe("http://proxy.corp.example:8080");
  });

  it("a rejected combined PUT leaves the other fields untouched too", async () => {
    // Validation happens before any write: the valid switch halves of a PUT whose
    // proxyUrl is garbage must not land either — the PUT is atomic.
    const res = await admin.put("/api/admin/settings", {
      proxyForApp: false,
      proxyForAgent: false,
      proxyUrl: "not a proxy",
    });
    expect(res.status).toBe(400);
    const { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(true);
    expect(settings.proxyForAgent).toBe(true);
    expect(settings.proxyUrl).toBeNull();
  });

  it("empty string and null both clear the address back to follow-the-environment", async () => {
    for (const clear of ["", "   ", null]) {
      await putProxyUrl("http://proxy.corp.example:8080");
      const res = await putProxyUrl(clear);
      expect(res.status).toBe(200);
      expect(((await res.json()) as ServerSettingsResponse).settings.proxyUrl).toBeNull();
      expect(t.deps.serverSettingsRepo.getProxyUrl()).toBeNull();
    }
  });

  it("partial PUTs keep the other fields: address-only keeps the switches and vice versa", async () => {
    await admin.put("/api/admin/settings", { proxyForApp: false, proxyForAgent: false });
    await putProxyUrl("proxy.corp.example:8080");
    let { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(false);
    expect(settings.proxyForAgent).toBe(false);
    expect(settings.proxyUrl).toBe("http://proxy.corp.example:8080");
    await admin.put("/api/admin/settings", { proxyForApp: true, proxyForAgent: true });
    ({ settings } = await getSettings());
    expect(settings.proxyForApp).toBe(true);
    expect(settings.proxyForAgent).toBe(true);
    expect(settings.proxyUrl).toBe("http://proxy.corp.example:8080");
  });
});
