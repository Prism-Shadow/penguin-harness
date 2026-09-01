/**
 * Sandbox settings: what the admin surface reports, what it accepts, and that a rejected
 * request changes nothing — a half-applied confinement policy is worse than none.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SandboxSettingsResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("sandbox settings", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const view = async () =>
    (await (await admin.get("/api/admin/sandbox")).json()) as SandboxSettingsResponse;

  it("starts unconfined, with the backends this deployment has", async () => {
    const res = await view();
    expect(res.settings.mode).toBe("danger-full-access");
    // No sandbox plugin in a test app: the page has to be able to say nothing enforces.
    expect(res.backends).toEqual([]);
  });

  it("applies a confining policy and reads it back", async () => {
    const saved = await admin.put("/api/admin/sandbox", {
      mode: "workspace-write",
      network: "none",
      maskPaths: [" /etc/secrets ", "/etc/secrets", ""],
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as SandboxSettingsResponse;
    // Trimmed, de-duplicated, empties dropped.
    expect(body.settings).toEqual({
      mode: "workspace-write",
      network: "none",
      maskPaths: ["/etc/secrets"],
    });
    expect((await view()).settings.mode).toBe("workspace-write");
  });

  it("refuses an unknown mode or a bad mask list, leaving the policy untouched", async () => {
    await admin.put("/api/admin/sandbox", { mode: "read-only" });
    expect((await admin.put("/api/admin/sandbox", { mode: "wide-open" })).status).toBe(400);
    expect(
      (await admin.put("/api/admin/sandbox", { mode: "read-only", maskPaths: [7] })).status,
    ).toBe(400);
    expect((await view()).settings).toEqual({ mode: "read-only" });
  });

  it("is admin-only", async () => {
    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    expect((await member.get("/api/admin/sandbox")).status).toBe(403);
    expect((await member.put("/api/admin/sandbox", { mode: "read-only" })).status).toBe(403);
  });
});
