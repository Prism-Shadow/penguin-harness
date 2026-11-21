/**
 * A module behind a system app (plugin/system-app-modules.ts): a preinstalled built-in plugin
 * whose module declares `SystemAppModule.apps` cannot be stopped, through the real routes, the
 * real loader and the platform's own boots. The packages a hot push carried stand in for the
 * build (shipHybrids).
 *
 * - It runs, and the administrator's ledger marks it a system app. A stop answers 409
 *   `system_app_module_locked`, and so do a removal from every table of a Project and a removal
 *   from this server's own table; the config file stays as it was.
 * - A build that turns a stopped preinstalled module into a system app's enables it again and
 *   lists it in every Project at its boot, and a later boot lists it again in a Project whose
 *   config lost it by hand.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePushedPluginLibrary, type PluginTables } from "@prismshadow/penguin-core";
import type { InstalledPluginsResponse, PluginModuleRequestsResponse } from "../src/api/types.js";
import type { Reassembly } from "../src/hmr/capabilities.js";
import { shipHybrids, type HybridPackage } from "./plugin-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SYSTEM: HybridPackage = {
  name: "@penguinharness/sysapp",
  module: "SysApp",
  skills: ["sysapp-skill"],
  card: { preinstall: true },
  contributes: { "SystemAppModule.apps": [{ id: "sysapp.app", app: "sysapp" }] },
};
/** The same package as a build before it declared its system app carried it. */
const SYSTEM_UNDECLARED: HybridPackage = { ...SYSTEM, contributes: undefined };

const MEMBER_PROJECT = "member-default_project";

type Client = ReturnType<typeof apiClient>;

describe("a module behind a system app", () => {
  let t: TestApp;
  let admin: Client;
  let machineId: string;

  beforeEach(async () => {
    t = await createTestApp({
      pluginPackages: {
        install: () => Promise.reject(new Error("not used")),
        installFiles: () => Promise.reject(new Error("not used")),
        remove: async () => {},
      },
    });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    machineId = (
      (await (
        await admin.get("/api/projects/default_project/plugins/installed")
      ).json()) as InstalledPluginsResponse
    ).machineId;
  });

  afterEach(async () => {
    usePushedPluginLibrary(null);
    await t.cleanup();
  });

  const boot = () => t.boot.tree.api<Reassembly>("RuntimeModule", "Reassembly").reassemble();

  const stored = (projectId: string): Promise<PluginTables> =>
    t.deps.projectConfigService.getPluginTables(projectId);

  const own = async (projectId: string) => (await stored(projectId)).machines[machineId];

  const ledger = async () =>
    (await (await admin.get("/api/admin/plugin-modules")).json()) as PluginModuleRequestsResponse;

  const decide = (pkg: string, decision: "enable" | "decline") =>
    admin.post("/api/admin/plugin-modules/decide", { package: pkg, decision });

  const remove = (query: string) =>
    admin.delete(
      `/api/projects/default_project/plugins/installed?specifier=${encodeURIComponent(SYSTEM.name)}${query}`,
    );

  it("runs, and neither a stop nor a removal from a Project's tables takes it out", async () => {
    await shipHybrids(t, SYSTEM);
    expect(await boot()).toBe(true);
    expect((await ledger()).requests).toEqual([
      expect.objectContaining({
        package: SYSTEM.name,
        decision: "enabled",
        preinstalled: true,
        systemApp: true,
        state: "running",
      }),
    ]);
    const before = await stored("default_project");

    for (const res of [
      await decide(SYSTEM.name, "decline"),
      await remove(""),
      await remove(`&machineId=${machineId}`),
    ]) {
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "system_app_module_locked",
      );
    }

    expect(await stored("default_project")).toEqual(before);
    expect(await own("default_project")).toEqual({ [SYSTEM.name]: {} });
    expect((await ledger()).requests[0]).toMatchObject({ decision: "enabled", state: "running" });
  });

  it("is enabled again by the build that makes it a system app's, and every boot lists it where it went missing", async () => {
    await provisionUser(t.app, "member");
    await shipHybrids(t, SYSTEM_UNDECLARED);
    await boot();
    expect((await decide(SYSTEM.name, "decline")).status).toBe(200);
    expect(await own("default_project")).toBeUndefined();

    await shipHybrids(t, SYSTEM);
    expect(await boot()).toBe(true);

    for (const projectId of ["default_project", MEMBER_PROJECT]) {
      expect(await own(projectId)).toEqual({ [SYSTEM.name]: {} });
    }
    expect((await ledger()).requests[0]).toMatchObject({
      decision: "enabled",
      via: "builtin",
      systemApp: true,
      state: "running",
    });

    // A hand edit of the file, which no route would take.
    await t.deps.projectConfigService.setPluginTables(MEMBER_PROJECT, { all: {}, machines: {} });
    expect(await boot()).toBe(true);

    expect(await own(MEMBER_PROJECT)).toEqual({ [SYSTEM.name]: {} });
  });
});
