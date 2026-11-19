/**
 * Preinstalled built-in modules (PRFC-0030): a built-in plugin whose card says
 * `preinstall: true` is written into Project config — listed in every Project created, and once
 * in the Projects a server already had when its build first shipped the plugin — through the
 * real routes, the real loader and the platform's own boots.
 *
 * Built in is what the running build ships: the packages a hot push carried, as the runtime
 * reports them (shipHybrids, the one stand-in). A boot is the App's own re-assembly, which boots
 * a generation the way a push does.
 *
 * - The first boot of a build that ships it lists it in this server's own table of every existing
 *   Project and runs it; the shared table and another machine's table stay as they were. A boot
 *   of a build without it lists nothing, and a built-in module whose card says nothing, or says
 *   `preinstall: false`, is listed nowhere.
 * - A Project created afterwards lists it with no re-assembly, and so does a new user's own Project.
 * - The administrator removes it from a Project: later boots leave it out there.
 * - Removed from every Project it stops; the next Project created lists it and it runs again.
 * - Installing it on an Agent after the listing changes nothing.
 * - The administrator sees it enabled, built in, by nobody, as every Project's; stopping it keeps
 *   every Project, new ones and boots included, from listing it; enabling it lists it in every
 *   Project again and tells their users.
 * - An administrator's stop from before the package was preinstalled holds.
 * - A Project whose config cannot be read at that boot gets it at a later boot; one whose config
 *   is not TOML is passed over for good.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import {
  projectConfigPath,
  usePushedPluginLibrary,
  type PluginTables,
} from "@prismshadow/penguin-core";
import type { ServerEvent } from "@prismshadow/penguin-library-project";
import type {
  AgentPluginsInstallResponse,
  InstalledPluginsResponse,
  PluginModuleRequestsResponse,
} from "../src/api/types.js";
import type { Reassembly } from "../src/hmr/capabilities.js";
import { userChannelKey } from "../src/http/routes/events.js";
import { shipHybrids, type HybridPackage } from "./plugin-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PRE: HybridPackage = {
  name: "@penguinharness/pre",
  module: "Pre",
  skills: ["pre-skill"],
  card: { preinstall: true },
};
/** The same package as a build before it declared the preinstall carried it. */
const PRE_UNDECLARED: HybridPackage = { ...PRE, card: undefined };
const PLAIN: HybridPackage = {
  name: "@penguinharness/plain",
  module: "Plain",
  skills: ["plain-skill"],
};
const OPTED_OUT: HybridPackage = {
  name: "@penguinharness/opted-out",
  module: "OptedOut",
  skills: ["opted-out-skill"],
  card: { preinstall: false },
};

const MEMBER_PROJECT = "member-default_project";
/** Another machine of the fleet, as a Project's own table for it names it. */
const OTHER_MACHINE = "OtherMachine0001";

type Client = ReturnType<typeof apiClient>;

describe("a preinstalled built-in module, listed in Project config", () => {
  let t: TestApp;
  let admin: Client;
  let machineId: string;

  beforeEach(async () => {
    t = await createTestApp({
      // Taking a shipped package out of every table asks for it to leave the disk; no npm here.
      pluginPackages: {
        install: () => Promise.reject(new Error("not used")),
        installFiles: () => Promise.reject(new Error("not used")),
        remove: async () => {},
      },
    });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    machineId = (await view(admin, "default_project")).machineId;
  });

  afterEach(async () => {
    usePushedPluginLibrary(null);
    await t.cleanup();
  });

  /** A generation boots, as a push or a restart boots one; answers whether it took. */
  const boot = () => t.boot.tree.api<Reassembly>("RuntimeModule", "Reassembly").reassemble();

  /** The Project's plugin tables as its config file stores them. */
  const stored = (projectId: string): Promise<PluginTables> =>
    t.deps.projectConfigService.getPluginTables(projectId);

  /** This server's own table of the Project, as stored. */
  const own = async (projectId: string) => (await stored(projectId)).machines[machineId];

  const view = async (client: Client, projectId: string) =>
    (await (
      await client.get(`/api/projects/${projectId}/plugins/installed`)
    ).json()) as InstalledPluginsResponse;

  const stateOf = async (projectId: string, pkg: string) =>
    (await view(admin, projectId)).modules?.find((m) => m.package === pkg)?.state;

  const ledger = async () =>
    (await (await admin.get("/api/admin/plugin-modules")).json()) as PluginModuleRequestsResponse;

  const decide = (pkg: string, decision: "enable" | "decline") =>
    admin.post("/api/admin/plugin-modules/decide", { package: pkg, decision });

  const createProject = async (projectId: string) =>
    expect((await admin.post("/api/projects", { projectId })).status).toBe(201);

  /** The App of the moment: the same object until a re-assembly replaces the tree. */
  const currentApp = () => t.boot.tree.api("IdentityModule", "Auth");

  /** The server events a user's channel carries from now on. */
  function inbox(userId: string): ServerEvent[] {
    const events: ServerEvent[] = [];
    t.deps.channels.get(userChannelKey(userId)).subscribe((evt) => {
      if (evt.event === "server_event") events.push(JSON.parse(evt.data) as ServerEvent);
    });
    return events;
  }

  it("the first boot of a build that ships it lists it in this server's own table of every Project, and runs it", async () => {
    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    await t.deps.projectConfigService.setPluginTables(MEMBER_PROJECT, {
      all: {},
      machines: { [OTHER_MACHINE]: { "@acme/elsewhere": {} } },
    });
    // A build without it: nothing to list.
    expect(await boot()).toBe(true);
    expect(await stored("default_project")).toEqual({ all: {}, machines: {} });

    await shipHybrids(t, PRE, PLAIN, OPTED_OUT);
    expect(await boot()).toBe(true);

    expect(await stored("default_project")).toEqual({
      all: {},
      machines: { [machineId]: { [PRE.name]: {} } },
    });
    expect(await stored(MEMBER_PROJECT)).toEqual({
      all: {},
      machines: { [OTHER_MACHINE]: { "@acme/elsewhere": {} }, [machineId]: { [PRE.name]: {} } },
    });
    expect(
      (await view(member, MEMBER_PROJECT)).plugins.find((p) => p.specifier === PRE.name),
    ).toMatchObject({ active: true, everywhere: false, machines: [machineId] });
    expect(await stateOf("default_project", PRE.name)).toBe("running");
    expect(await stateOf("default_project", PLAIN.name)).toBe("off");
    expect(await stateOf("default_project", OPTED_OUT.name)).toBe("off");
  });

  it("a Project created afterwards lists it with no re-assembly, and so does a new user's own Project", async () => {
    await shipHybrids(t, PRE);
    await boot();
    const app = currentApp();

    await createProject("later");
    await provisionUser(t.app, "newcomer");

    expect(currentApp()).toBe(app);
    expect(await own("later")).toEqual({ [PRE.name]: {} });
    expect(await own("newcomer-default_project")).toEqual({ [PRE.name]: {} });
    expect(await stateOf("later", PRE.name)).toBe("running");
  });

  it("a Project the administrator took it out of stays without it through later boots", async () => {
    await provisionUser(t.app, "member");
    await shipHybrids(t, PRE);
    await boot();

    const res = await admin.delete(
      `/api/projects/default_project/plugins/installed?specifier=${encodeURIComponent(PRE.name)}&machineId=${machineId}`,
    );
    expect(res.status).toBe(200);
    expect(await boot()).toBe(true);
    expect(await boot()).toBe(true);

    expect(await stored("default_project")).toEqual({ all: {}, machines: {} });
    expect(await own(MEMBER_PROJECT)).toEqual({ [PRE.name]: {} });
  });

  it("taken out of every Project it stops, and the next Project created lists it and runs it again", async () => {
    await shipHybrids(t, PRE);
    await boot();
    await admin.delete(
      `/api/projects/default_project/plugins/installed?specifier=${encodeURIComponent(PRE.name)}`,
    );
    expect(await stateOf("default_project", PRE.name)).toBe("off");
    const app = currentApp();

    await createProject("later");

    expect(currentApp()).not.toBe(app);
    expect(await own("later")).toEqual({ [PRE.name]: {} });
    expect(await stateOf("later", PRE.name)).toBe("running");
    expect(await stored("default_project")).toEqual({ all: {}, machines: {} });
  });

  it("installing it on an Agent after the listing changes nothing", async () => {
    await shipHybrids(t, PRE);
    await boot();
    const before = await ledger();
    const app = currentApp();

    const res = await admin.post("/api/projects/default_project/agents/default_agent/plugins", {
      names: ["pre"],
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentPluginsInstallResponse;
    expect(body.skills.map((s) => s.name)).toContain("pre-skill");
    expect(body.moduleActions).toEqual([]);
    expect(currentApp()).toBe(app);
    expect(await ledger()).toEqual(before);
  });

  it("the administrator sees it enabled as built in, can stop it everywhere, and enabling it lists it everywhere again", async () => {
    await provisionUser(t.app, "member");
    await shipHybrids(t, PRE);
    await boot();
    expect((await ledger()).requests).toEqual([
      expect.objectContaining({
        package: PRE.name,
        plugin: "pre",
        projectId: null,
        requestedBy: "",
        decision: "enabled",
        via: "builtin",
        builtin: true,
        preinstalled: true,
        state: "running",
      }),
    ]);

    expect((await decide(PRE.name, "decline")).status).toBe(200);
    await createProject("later");
    expect(await boot()).toBe(true);

    expect(await own("default_project")).toBeUndefined();
    expect(await own(MEMBER_PROJECT)).toBeUndefined();
    expect(await own("later")).toBeUndefined();
    expect(await stateOf("default_project", PRE.name)).toBe("off");
    const memberEvents = inbox("member");

    const res = await decide(PRE.name, "enable");

    expect(res.status).toBe(200);
    expect(((await res.json()) as PluginModuleRequestsResponse).requests).toEqual([
      expect.objectContaining({
        package: PRE.name,
        decision: "enabled",
        decidedBy: "admin",
        via: "admin",
        state: "running",
      }),
    ]);
    for (const projectId of ["default_project", MEMBER_PROJECT, "later"]) {
      expect(await own(projectId)).toEqual({ [PRE.name]: {} });
    }
    expect(memberEvents).toContainEqual({ type: "plugin_modules_changed" });
  });

  it("an administrator's stop from before the package was preinstalled holds", async () => {
    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    await shipHybrids(t, PRE_UNDECLARED);
    // Built in, so a member's install lists it (PRFC-0031); then the administrator stops it.
    const install = await member.post(
      `/api/projects/${MEMBER_PROJECT}/agents/default_agent/plugins`,
      { names: ["pre"] },
    );
    expect(install.status).toBe(201);
    expect((await decide(PRE.name, "decline")).status).toBe(200);

    // The next build declares the preinstall.
    await shipHybrids(t, PRE);
    expect(await boot()).toBe(true);
    await createProject("later");

    expect(await own(MEMBER_PROJECT)).toBeUndefined();
    expect(await own("default_project")).toBeUndefined();
    expect(await own("later")).toBeUndefined();
    expect(await stateOf("default_project", PRE.name)).toBe("off");
  });

  it("a Project whose config cannot be read at that boot gets it later; one that is not TOML is passed over for good", async () => {
    await createProject("unreadable");
    await createProject("garbled");
    const unreadable = projectConfigPath(t.root, "unreadable");
    const garbled = projectConfigPath(t.root, "garbled");
    const good = await fs.readFile(garbled, "utf8");
    // A read that fails (a directory where the file should be: EISDIR everywhere), and a file
    // that is not TOML.
    await fs.rename(unreadable, `${unreadable}.aside`);
    await fs.mkdir(unreadable);
    await fs.writeFile(garbled, "this is = = not toml");
    await shipHybrids(t, PRE);
    expect(await boot()).toBe(true);
    expect(await own("default_project")).toEqual({ [PRE.name]: {} });

    await fs.rmdir(unreadable);
    await fs.rename(`${unreadable}.aside`, unreadable);
    await fs.writeFile(garbled, good);
    expect(await boot()).toBe(true);

    expect(await own("unreadable")).toEqual({ [PRE.name]: {} });
    expect(await own("garbled")).toBeUndefined();
  });
});
