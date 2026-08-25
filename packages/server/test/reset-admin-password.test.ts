/**
 * Offline admin-password reset: the full rescue round-trip (fresh initial password,
 * re-armed flag, cleared admin sessions, stored plaintext), the live-server refusal,
 * and the nothing-to-reset outcomes (no database — none created as a side effect —
 * and an unseeded database).
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { ADMIN_USER_ID } from "../src/auth/service.js";
import { openDatabase } from "../src/db/database.js";
import { UsersRepo } from "../src/db/repos/users.js";
import { initialAdminPasswordPath } from "../src/initial-password.js";
import { acquireServerLock } from "../src/lock.js";
import { resetAdminPassword } from "../src/reset-admin-password.js";
import { makeTempRoot } from "./helpers.js";

describe("resetAdminPassword", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  async function tempRoot(): Promise<string> {
    const root = await makeTempRoot();
    roots.push(root);
    return root;
  }

  /** Seeds a web.db with the admin (password "old-password-1", already changed) plus a bystander user, each holding one login session. */
  async function seedDatabase(root: string): Promise<string> {
    const dbPath = path.join(root, "web.db");
    const db = openDatabase(dbPath);
    const users = new UsersRepo(db);
    const createdAt = "2026-01-01T00:00:00.000Z";
    users.insert({
      userId: ADMIN_USER_ID,
      passwordHash: await hashPassword("old-password-1"),
      isAdmin: true,
      passwordIsInitial: false,
      createdAt,
      sessionsNotBefore: null,
    });
    users.insert({
      userId: "alice",
      passwordHash: await hashPassword("alice-password-1"),
      isAdmin: false,
      passwordIsInitial: false,
      createdAt,
      sessionsNotBefore: null,
    });
    db.close();
    return dbPath;
  }

  it("returns the admin to the unclaimed state, producing no plaintext at all", async () => {
    const root = await tempRoot();
    const dbPath = await seedDatabase(root);
    // A plaintext an older build left behind must not survive the rescue.
    fs.writeFileSync(initialAdminPasswordPath(root), "penguin-0000\n");

    const result = await resetAdminPassword(root);
    expect(result).toEqual({ outcome: "reset" });
    // Nothing to write down and nothing left on disk: the next server start prints a
    // first-login link, and claiming it is what sets a real password.
    expect(fs.existsSync(initialAdminPasswordPath(root))).toBe(false);

    const db = openDatabase(dbPath);
    try {
      const admin = new UsersRepo(db).findById(ADMIN_USER_ID);
      expect(admin?.passwordIsInitial).toBe(true);
      // The old password no longer works, and the new one is a value nobody holds.
      expect(await verifyPassword("old-password-1", admin!.passwordHash)).toBe(false);
      expect(await verifyPassword("old-password-1", admin!.passwordHash)).toBe(false);
      // The admin's sessions are revoked by the not-before mark; bystanders are untouched.
      expect(admin!.sessionsNotBefore).not.toBeNull();
      expect(new UsersRepo(db).findById("alice")!.sessionsNotBefore).toBeNull();
      const alice = new UsersRepo(db).findById("alice");
      expect(await verifyPassword("alice-password-1", alice!.passwordHash)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("refuses while a live server owns the data root and changes nothing", async () => {
    const root = await tempRoot();
    const dbPath = await seedDatabase(root);
    const srv = net.createServer();
    const port = await new Promise<number>((resolve) => {
      srv.listen(0, "127.0.0.1", () => resolve((srv.address() as net.AddressInfo).port));
    });
    try {
      acquireServerLock(root, { pid: process.pid, port, startedAt: "2026-01-01T00:00:00Z" });
      const result = await resetAdminPassword(root);
      expect(result).toMatchObject({ outcome: "server_running", lock: { port } });
      const db = openDatabase(dbPath);
      try {
        const admin = new UsersRepo(db).findById(ADMIN_USER_ID);
        expect(await verifyPassword("old-password-1", admin!.passwordHash)).toBe(true);
      } finally {
        db.close();
      }
      expect(fs.existsSync(initialAdminPasswordPath(root))).toBe(false);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });

  it("reports a missing database without creating one", async () => {
    const root = await tempRoot();
    const dbPath = path.join(root, "web.db");
    const result = await resetAdminPassword(root);
    expect(result).toEqual({ outcome: "no_database", dbPath });
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("reports an unseeded database (admin never created)", async () => {
    const root = await tempRoot();
    const db = openDatabase(path.join(root, "web.db"));
    db.close();
    expect(await resetAdminPassword(root)).toEqual({ outcome: "no_admin" });
  });
});
