/**
 * The installed-plugins surface: what plugins.json lists, which of those the process is
 * actually running, and that writing the list is an admin operation which does not pretend to
 * load anything (plugins load once per process, in the runtime).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type { InstalledPluginsResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("installed plugins", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  const listFile = () => path.join(t.root, "plugins.json");

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const view = async () =>
    (await (await admin.get("/api/plugins/installed")).json()) as InstalledPluginsResponse;

  it("reports an empty list when nothing is installed", async () => {
    const res = await view();
    expect(res.plugins).toEqual([]);
    expect(res.file).toBe("plugins.json");
    expect(res.restartPending).toBe(false);
  });

  it("says a listed plugin is not active, and why when it cannot even be read", async () => {
    await fs.writeFile(listFile(), JSON.stringify({ plugins: ["@acme/not-installed"] }));
    const res = await view();
    expect(res.plugins).toHaveLength(1);
    expect(res.plugins[0]).toMatchObject({ specifier: "@acme/not-installed", active: false });
    // A specifier that does not resolve is a configuration error, not a pending restart.
    expect(res.plugins[0]!.error).toMatch(/does not resolve/);
    expect(res.restartPending).toBe(false);
  });

  it("rewrites the list for an admin, and refuses everyone else", async () => {
    const saved = await admin.put("/api/plugins/installed", {
      plugins: ["@acme/one", "@acme/one"],
    });
    expect(saved.status).toBe(200);
    // Written once: the file is a set, in the order given.
    expect(JSON.parse(await fs.readFile(listFile(), "utf8"))).toEqual({ plugins: ["@acme/one"] });

    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    expect((await member.put("/api/plugins/installed", { plugins: [] })).status).toBe(403);
    // Reading is not an admin operation: a member sees what the deployment runs.
    expect((await member.get("/api/plugins/installed")).status).toBe(200);
    expect((await admin.put("/api/plugins/installed", { plugins: [""] })).status).toBe(400);
  });

  it("reports a list file that cannot be read, rather than an empty deployment", async () => {
    await fs.writeFile(listFile(), "{ not json");
    const res = await admin.get("/api/plugins/installed");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("plugins.json");
  });
});
