/**
 * Initial-admin-password persistence and reminder notice: file roundtrip, notice shape,
 * and the app wiring that drops the stored plaintext the moment it goes stale (self
 * change / admin reset of the admin), while other users' password events leave it alone.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initialAdminPasswordPath,
  readInitialAdminPassword,
  renderInitialPasswordNotice,
  storeInitialAdminPassword,
  clearInitialAdminPassword,
} from "../src/initial-password.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  provisionUser,
  TEST_ADMIN_PASSWORD,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("initial password file", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("stores, reads back and clears the plaintext in the data root", () => {
    expect(readInitialAdminPassword(t.root)).toBeNull();
    storeInitialAdminPassword(t.root, "penguin-1234");
    expect(fs.existsSync(path.join(t.root, "initial-admin-password"))).toBe(true);
    expect(readInitialAdminPassword(t.root)).toBe("penguin-1234");
    clearInitialAdminPassword(t.root);
    expect(readInitialAdminPassword(t.root)).toBeNull();
    // Idempotent on an already-missing file.
    clearInitialAdminPassword(t.root);
    expect(readInitialAdminPassword(t.root)).toBeNull();
  });

  it("treats an empty or whitespace-only file as absent", () => {
    fs.writeFileSync(initialAdminPasswordPath(t.root), "  \n");
    expect(readInitialAdminPassword(t.root)).toBeNull();
  });

  it("self password change drops the stored plaintext for admin", async () => {
    storeInitialAdminPassword(t.root, t.adminPassword);
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).put("/api/me/password", {
      oldPassword: TEST_ADMIN_PASSWORD,
      newPassword: "changed-password-1",
    });
    expect(res.status).toBe(204);
    expect(readInitialAdminPassword(t.root)).toBeNull();
    expect(t.deps.authService.adminPasswordIsInitial()).toBe(false);
  });

  it("admin password reset of the admin drops the stored plaintext; resets of other users keep it", async () => {
    storeInitialAdminPassword(t.root, t.adminPassword);
    const admin = await loginAdmin(t.app);
    await provisionUser(t.app, "alice", "password-123");
    // Resetting ANOTHER user leaves the admin's stored seed in place.
    const other = await apiClient(t.app, admin.cookie).post("/api/admin/users/alice/password", {
      password: "password-456",
    });
    expect(other.status).toBe(204);
    expect(readInitialAdminPassword(t.root)).toBe(t.adminPassword);
    // Resetting the ADMIN itself replaces the password with an admin-chosen value the
    // file no longer matches: the stale plaintext must go, even though the initial FLAG
    // is re-armed by the reset.
    const self = await apiClient(t.app, admin.cookie).post(
      `/api/admin/users/${admin.user.userId}/password`,
      { password: "password-789" },
    );
    expect(self.status).toBe(204);
    expect(readInitialAdminPassword(t.root)).toBeNull();
    expect(t.deps.authService.adminPasswordIsInitial()).toBe(true);
  });
});

describe("renderInitialPasswordNotice", () => {
  it("frames the credentials and the reminder in an aligned ASCII box", () => {
    const notice = renderInitialPasswordNotice("admin", "penguin-1234");
    const lines = notice.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines[0]).toMatch(/^\+-+\+$/);
    expect(lines.at(-1)).toBe(lines[0]);
    // Every row is exactly as wide as the frame, so the right edge lines up.
    for (const line of lines) expect(line.length).toBe(lines[0]!.length);
    for (const line of lines.slice(1, -1)) expect(line).toMatch(/^\|.*\|$/);
    expect(notice).toContain("admin / penguin-1234");
    expect(notice).toContain("change it soon");
    // Plain ASCII only: box-drawing characters misrender on legacy code pages.
    expect([...notice].every((ch) => ch.codePointAt(0)! < 128)).toBe(true);
  });

  it("widens with a long pinned password instead of breaking the frame", () => {
    const long = "a-very-long-pinned-password-for-automation-use-only";
    const lines = renderInitialPasswordNotice("admin", long).split("\n");
    for (const line of lines) expect(line.length).toBe(lines[0]!.length);
    expect(lines.some((line) => line.includes(long))).toBe(true);
  });
});
