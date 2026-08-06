/**
 * Admin server-settings route tests: permission boundary (non-admin 403), the
 * "use system HTTP proxy" default (absent row reads as on), PUT persistence and
 * validation, and merge semantics (an omitted field keeps its current value).
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
    expect((await api.put("/api/admin/settings", { useSystemProxy: false })).status).toBe(403);
    // The failed PUT changed nothing.
    expect((await getSettings()).settings.useSystemProxy).toBe(true);
  });

  it("useSystemProxy defaults to on while no row exists", async () => {
    expect(t.deps.db.prepare("SELECT COUNT(*) AS n FROM server_settings").get()).toMatchObject({
      n: 0,
    });
    expect((await getSettings()).settings.useSystemProxy).toBe(true);
  });

  it("PUT persists the toggle and echoes the full settings", async () => {
    const off = await admin.put("/api/admin/settings", { useSystemProxy: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as ServerSettingsResponse).settings.useSystemProxy).toBe(false);
    // Round-trips through the repo (the DB row, not process state, is what GET serves).
    expect((await getSettings()).settings.useSystemProxy).toBe(false);
    expect(t.deps.serverSettingsRepo.getUseSystemProxy()).toBe(false);

    const on = await admin.put("/api/admin/settings", { useSystemProxy: true });
    expect(on.status).toBe(200);
    expect((await getSettings()).settings.useSystemProxy).toBe(true);
  });

  it("an omitted field keeps its current value; a non-boolean is 400", async () => {
    await admin.put("/api/admin/settings", { useSystemProxy: false });
    // Empty PUT: no-op, still returns the current settings.
    const noop = await admin.put("/api/admin/settings", {});
    expect(noop.status).toBe(200);
    expect(((await noop.json()) as ServerSettingsResponse).settings.useSystemProxy).toBe(false);
    // Type check: only booleans are accepted, and a rejected write changes nothing.
    expect((await admin.put("/api/admin/settings", { useSystemProxy: "on" })).status).toBe(400);
    expect((await getSettings()).settings.useSystemProxy).toBe(false);
  });
});
