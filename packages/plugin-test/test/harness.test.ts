/**
 * The harness against the real server: it starts on a scratch root, seeds the admin, lists
 * what the Project it seeded asks for, and stops. A plugin directory whose entry is not built is
 * refused before anything starts, with the fix in the message.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_ADMIN_PASSWORD,
  HarnessApiError,
  defaultServerEntry,
  resolvePluginEntry,
  startHarness,
  type Harness,
} from "../src/index.js";

describe("resolvePluginEntry", () => {
  it("passes a specifier through and resolves a built directory to its entry", async () => {
    expect(await resolvePluginEntry("@someone/plugin")).toBe("@someone/plugin");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-plugin-test-dir-"));
    try {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", main: "./dist/index.js" }),
      );
      await expect(resolvePluginEntry(dir)).rejects.toThrow(/build the package first/);
      await fs.mkdir(path.join(dir, "dist"));
      await fs.writeFile(path.join(dir, "dist", "index.js"), "export default {};");
      expect(await resolvePluginEntry(dir)).toBe(path.join(dir, "dist", "index.js"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("startHarness", () => {
  let harness: Harness;
  beforeAll(async () => {
    // The server's build is what runs; without it there is nothing honest to test against.
    await fs.access(defaultServerEntry());
    harness = await startHarness({ plugins: ["@someone/not-installed"] });
  }, 60_000);
  afterAll(async () => {
    await harness?.stop();
  });

  it("answers as the seeded admin, and lists the plugin it was given", async () => {
    expect(harness.admin).toEqual({ userId: "admin", password: DEFAULT_ADMIN_PASSWORD });
    expect(harness.plugins).toEqual(["@someone/not-installed"]);
    expect(harness.projectId).toBe("default_project");
    const api = await harness.login();
    const me = await api.get<{ user: { userId: string } }>("/api/me");
    expect(me.user.userId).toBe("admin");
    // Listed but not resolvable: the row says so, and the server still boots — the
    // same per-entry tolerance a deployment gets.
    const rows = await harness.installedPlugins();
    expect(rows.map((r) => r.specifier)).toEqual(["@someone/not-installed"]);
    expect(rows[0]!.active).toBe(false);
    expect(rows[0]!.error).toMatch(/not installed on this machine/);
  });

  it("a failed call carries the status and the server's body", async () => {
    const api = await harness.login();
    await expect(api.get("/api/sessions/no-such-session")).rejects.toMatchObject({
      name: "HarnessApiError",
      status: 404,
    });
    const err = await api.get("/api/sessions/no-such-session").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HarnessApiError);
    expect((err as HarnessApiError).body).toMatchObject({ error: { code: "session_not_found" } });
  });
});
