/**
 * A library plugin's server module, brought along when the plugin is installed on an Agent
 * (PRFC-0031), through the real routes, the real loader and the platform's own re-assembly.
 *
 * Built in is what the running build ships: here, the packages a hot push carried (its library
 * and its plugin prefix), as the runtime reports them — the one stand-in. Everything under the
 * data root's `plugins/` is not built in.
 *
 * - A member installs a built-in hybrid plugin: its module runs, this server's own table of the
 *   Project lists it and the shared one does not, the action is `enabled`, and the ledger names
 *   the member, built in.
 * - The same while a Task runs: the Task goes on and ends by itself.
 * - An approval pending before the install is still answerable after it.
 * - A second Project installing the same plugin lists it for itself, with no re-assembly.
 * - A member installing a non-built-in hybrid plugin whose module is off changes no table, asks
 *   the administrator (who hears of it), and the action is `requested`.
 * - A member installing a non-built-in hybrid plugin whose module runs changes nothing at all.
 * - The administrator installing that plugin lists and runs it, recorded as the administrator's.
 * - The administrator approves a member's request without being a member of its Project.
 * - The administrator declines: the member's next install and explicit ask are both blocked.
 * - The administrator stops a built-in listed by two Projects: both own tables lose it, a member's
 *   install does not bring it back, the administrator's explicit ask does.
 * - A shipped package that replaces a node is not automatic: a member's install asks.
 * - A package in the data root's prefix under a shipped name is not built in.
 * - A module that breaks the boot: the install still answers 201, the listing is undone, the
 *   action is `failed`, and the previous App serves.
 * - `skipModules`: the Agent part is written, no table changes, `modules` says how things stand.
 * - Creating an Agent with a `plugins` list enables a built-in module.
 * - The administrator's routes refuse everyone else; the member route refuses a non-member.
 * - A pending request outlives its Project with no Project named, and approving it is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { assistantText, toolCall, usePushedPluginLibrary } from "@prismshadow/penguin-core";
import type { ServerEvent } from "@prismshadow/penguin-library-project";
import type { SessionRow } from "@prismshadow/penguin-library-session/repos/sessions";
import type {
  AgentPluginsInstallResponse,
  InstalledPluginsResponse,
  PluginModuleAskResponse,
  PluginModuleRequestsResponse,
} from "../src/api/types.js";
import { userChannelKey } from "../src/http/routes/events.js";
import type { RuntimeSession, SessionManager } from "../src/runtime/session-manager.js";
import {
  decorators,
  hybridPackageFiles,
  lower,
  shipHybrids,
  writePrefixPackage,
} from "./plugin-fixtures.js";
import type { HybridPackage } from "./plugin-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const HYBRID: HybridPackage = {
  name: "@penguinharness/hybrid",
  module: "Hybrid",
  skills: ["hybrid-skill"],
};
const SWAPPER: HybridPackage = {
  name: "@penguinharness/swapper",
  module: "Swapper",
  skills: ["swapper-skill"],
  replaces: true,
};
const BRITTLE: HybridPackage = {
  name: "@penguinharness/brittle",
  module: "Brittle",
  skills: ["brittle-skill"],
  index: lower(`import { Module } from ${JSON.stringify(decorators)};
    @Module() export class Brittle { setup() { throw new Error("deliberately fails to boot"); } }
    export default { modules: [Brittle] };`),
};
/** Installed under the data root by an administrator: not built in. */
const LINKED: HybridPackage = { name: "@acme/linked", module: "Linked", skills: ["linked-skill"] };

const MEMBER_PROJECT = "member-default_project";
const SID = "session-2026-11-19-10-00-00-aabb0002";

type Client = ReturnType<typeof apiClient>;

describe("a plugin's server module, installed with the plugin on an Agent", () => {
  let t: TestApp;
  let admin: Client;
  let member: Client;

  /** A package an administrator installed under the data root (`<root>/plugins`). */
  const installOnServer = (pkg: HybridPackage) =>
    writePrefixPackage(t.root, pkg.name, hybridPackageFiles(pkg));

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    await shipHybrids(t, HYBRID, SWAPPER, BRITTLE);
  });

  afterEach(async () => {
    usePushedPluginLibrary(null);
    await t.cleanup();
  });

  const install = async (
    client: Client,
    projectId: string,
    names: string[],
    extra: Record<string, unknown> = {},
  ) => {
    const res = await client.post(`/api/projects/${projectId}/agents/default_agent/plugins`, {
      names,
      ...extra,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as AgentPluginsInstallResponse;
  };

  const ask = async (client: Client, projectId: string, plugin: string) => {
    const res = await client.post(`/api/projects/${projectId}/plugins/modules`, { plugin });
    expect(res.status).toBe(200);
    return (await res.json()) as PluginModuleAskResponse;
  };

  const decide = (pkg: string, decision: "enable" | "decline") =>
    admin.post("/api/admin/plugin-modules/decide", { package: pkg, decision });

  const ledger = async () =>
    (await (await admin.get("/api/admin/plugin-modules")).json()) as PluginModuleRequestsResponse;

  /** The Project's plugin list as its members read it: where each package is listed, and whether it runs. */
  const tables = async (client: Client, projectId: string) =>
    (await (
      await client.get(`/api/projects/${projectId}/plugins/installed`)
    ).json()) as InstalledPluginsResponse;

  const rowOf = async (client: Client, projectId: string, pkg: string) =>
    (await tables(client, projectId)).plugins.find((p) => p.specifier === pkg);

  const moduleOf = (body: { modules?: AgentPluginsInstallResponse["modules"] }, plugin: string) =>
    body.modules?.find((m) => m.plugin === plugin);

  /** The server events a user's channel carries from now on. */
  function inbox(userId: string): ServerEvent[] {
    const events: ServerEvent[] = [];
    t.deps.channels.get(userChannelKey(userId)).subscribe((evt) => {
      if (evt.event === "server_event") events.push(JSON.parse(evt.data) as ServerEvent);
    });
    return events;
  }

  async function currentManager(): Promise<SessionManager> {
    const instance = await t.deps.hmr.ensure();
    return instance.api.business()!.api<SessionManager>("SessionRuntimeModule", "Sessions");
  }

  function rowFor(approvalMode: SessionRow["approvalMode"]): SessionRow {
    const at = new Date().toISOString();
    return {
      sessionId: SID,
      projectId: "default_project",
      agentId: "default_agent",
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode,
      title: null,
      createdAt: at,
      lastActiveAt: at,
    };
  }

  /** A Session whose run asks for one approval when `asks`, then stays open until released; it records how it ended. */
  function heldSession(endings: string[], release: Promise<void>, asks: boolean): RuntimeSession {
    return {
      sessionId: SID,
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async *run(_input: AmspRecord[], opts) {
        if (asks) {
          const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-held" });
          yield tc;
          await opts.approve(tc);
        }
        await Promise.race([
          release,
          new Promise<void>((resolve) => opts.signal.addEventListener("abort", () => resolve())),
        ]);
        endings.push(opts.signal.aborted ? "stopped" : "done");
        yield assistantText(opts.signal.aborted ? "stopped" : "done");
      },
      async *compact() {},
    };
  }

  it("a member's install of a built-in hybrid plugin runs its module, listed in this server's own table", async () => {
    const body = await install(member, MEMBER_PROJECT, ["hybrid"]);

    expect(body.moduleActions).toEqual([{ plugin: "hybrid", action: "enabled" }]);
    expect(body.skills.map((s) => s.name)).toContain("hybrid-skill");
    expect(moduleOf(body, "hybrid")).toMatchObject({
      package: HYBRID.name,
      builtin: true,
      state: "running",
      listed: true,
    });
    const view = await tables(member, MEMBER_PROJECT);
    expect(view.plugins.find((p) => p.specifier === HYBRID.name)).toMatchObject({
      active: true,
      everywhere: false,
      machines: [view.machineId],
    });
    expect((await ledger()).requests).toEqual([
      expect.objectContaining({
        package: HYBRID.name,
        projectId: MEMBER_PROJECT,
        agentId: "default_agent",
        requestedBy: "member",
        decision: "enabled",
        decidedBy: "member",
        via: "builtin",
        preinstalled: false,
        state: "running",
      }),
    ]);
  });

  it("a Task running in another Project goes on through the install and ends by itself", async () => {
    const endings: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const before = t.deps.manager;
    before.adopt(rowFor("allow-all"), heldSession(endings, held, false));
    t.deps.sessionsRepo.insert(rowFor("allow-all"));
    await before.startTask(SID, [assistantText("first")]);
    await waitFor(() => before.statusOf(SID) === "running");

    await install(member, MEMBER_PROJECT, ["hybrid"]);

    const after = await currentManager();
    expect(after).not.toBe(before);
    expect(after.statusOf(SID)).toBe("running");
    expect(endings).toEqual([]);
    release();
    await waitFor(() => after.statusOf(SID) === "idle");
    expect(endings).toEqual(["done"]);
  });

  it("an approval pending before the install is still answerable after it", async () => {
    const endings: string[] = [];
    const before = t.deps.manager;
    before.adopt(rowFor("always-ask"), heldSession(endings, Promise.resolve(), true));
    t.deps.sessionsRepo.insert(rowFor("always-ask"));
    await before.startTask(SID, [assistantText("first")]);
    await waitFor(() => before.pendingApprovalCount(SID) === 1);

    await install(member, MEMBER_PROJECT, ["hybrid"]);

    const after = await currentManager();
    expect(after).not.toBe(before);
    expect(after.pendingApprovalCount(SID)).toBe(1);
    expect(after.decideApproval(SID, "tc-held", "allow")).toBe(true);
    await waitFor(() => after.statusOf(SID) === "idle");
    expect(endings).toEqual(["done"]);
  });

  it("a second Project's install lists the running module for itself, with no re-assembly", async () => {
    await install(member, MEMBER_PROJECT, ["hybrid"]);
    const app = t.boot.tree.api("IdentityModule", "Auth");

    const body = await install(admin, "default_project", ["hybrid"]);

    expect(body.moduleActions).toEqual([{ plugin: "hybrid", action: "enabled" }]);
    expect(t.boot.tree.api("IdentityModule", "Auth")).toBe(app);
    expect(await rowOf(admin, "default_project", HYBRID.name)).toMatchObject({
      active: true,
      everywhere: false,
    });
    // The first ask stands in the ledger: the member's, built in.
    expect((await ledger()).requests).toEqual([
      expect.objectContaining({ package: HYBRID.name, requestedBy: "member", via: "builtin" }),
    ]);
  });

  it("a member's install of a non-built-in hybrid plugin whose module is off asks the administrator", async () => {
    await installOnServer(LINKED);
    const adminEvents = inbox("admin");

    const body = await install(member, MEMBER_PROJECT, ["linked"]);

    expect(body.moduleActions).toEqual([{ plugin: "linked", action: "requested" }]);
    expect(moduleOf(body, "linked")).toMatchObject({
      builtin: false,
      state: "off",
      listed: false,
      request: { status: "pending", mine: true },
    });
    expect(body.skills.map((s) => s.name)).toContain("linked-skill");
    expect(await rowOf(member, MEMBER_PROJECT, LINKED.name)).toBeUndefined();
    const { requests, pending } = await ledger();
    expect(pending).toBe(1);
    expect(requests).toEqual([
      expect.objectContaining({
        package: LINKED.name,
        projectId: MEMBER_PROJECT,
        requestedBy: "member",
        decision: null,
        state: "off",
      }),
    ]);
    expect(adminEvents).toContainEqual({ type: "plugin_modules_changed" });
  });

  it("a member's install of a non-built-in hybrid plugin whose module runs changes nothing", async () => {
    await installOnServer(LINKED);
    // The administrator listed it for their own Project: it runs on this server.
    expect(
      (
        await admin.put("/api/projects/default_project/plugins/installed", {
          plugins: [LINKED.name],
        })
      ).status,
    ).toBe(200);

    const body = await install(member, MEMBER_PROJECT, ["linked"]);

    expect(body.moduleActions).toEqual([]);
    expect(moduleOf(body, "linked")).toMatchObject({ state: "running", listed: false });
    expect(await rowOf(member, MEMBER_PROJECT, LINKED.name)).toBeUndefined();
    expect((await ledger()).requests).toEqual([]);
  });

  it("the administrator's install of a non-built-in hybrid plugin lists and runs it, as the administrator's", async () => {
    await installOnServer(LINKED);

    const body = await install(admin, "default_project", ["linked"]);

    expect(body.moduleActions).toEqual([{ plugin: "linked", action: "enabled" }]);
    expect(moduleOf(body, "linked")).toMatchObject({ state: "running", listed: true });
    expect((await ledger()).requests).toEqual([
      expect.objectContaining({ package: LINKED.name, requestedBy: "admin", via: "admin" }),
    ]);
  });

  it("the administrator approves a member's request without being a member of its Project", async () => {
    await installOnServer(LINKED);
    await install(member, MEMBER_PROJECT, ["linked"]);
    // Not a member of it: the administrator's own Project reads are refused there.
    expect((await admin.get(`/api/projects/${MEMBER_PROJECT}/plugins/installed`)).status).toBe(404);

    const res = await decide(LINKED.name, "enable");

    expect(res.status).toBe(200);
    const { requests, pending } = (await res.json()) as PluginModuleRequestsResponse;
    expect(pending).toBe(0);
    expect(requests).toEqual([
      expect.objectContaining({
        package: LINKED.name,
        requestedBy: "member",
        decision: "enabled",
        decidedBy: "admin",
        via: "approval",
        state: "running",
      }),
    ]);
    expect(await rowOf(member, MEMBER_PROJECT, LINKED.name)).toMatchObject({
      active: true,
      everywhere: false,
    });
  });

  it("after the administrator declines, a member's install and explicit ask are both blocked", async () => {
    await installOnServer(LINKED);
    await install(member, MEMBER_PROJECT, ["linked"]);

    expect((await decide(LINKED.name, "decline")).status).toBe(200);

    const again = await install(member, MEMBER_PROJECT, ["linked"]);
    expect(again.moduleActions).toEqual([{ plugin: "linked", action: "blocked" }]);
    expect(moduleOf(again, "linked")?.request).toMatchObject({ status: "declined" });
    expect((await ask(member, MEMBER_PROJECT, "linked")).moduleActions).toEqual([
      { plugin: "linked", action: "blocked" },
    ]);
    expect(await rowOf(member, MEMBER_PROJECT, LINKED.name)).toBeUndefined();
  });

  it("stopping a built-in module takes it out of every Project's own table, until the administrator asks for it", async () => {
    await install(member, MEMBER_PROJECT, ["hybrid"]);
    await install(admin, "default_project", ["hybrid"]);

    const res = await decide(HYBRID.name, "decline");

    expect(res.status).toBe(200);
    const stopped = (await res.json()) as PluginModuleRequestsResponse;
    expect(stopped.requests).toEqual([
      expect.objectContaining({ package: HYBRID.name, decision: "declined", state: "off" }),
    ]);
    expect(stopped.stillListedBy).toBeUndefined();
    expect(await rowOf(member, MEMBER_PROJECT, HYBRID.name)).toBeUndefined();
    expect(await rowOf(admin, "default_project", HYBRID.name)).toBeUndefined();

    const reinstall = await install(member, MEMBER_PROJECT, ["hybrid"]);
    expect(reinstall.moduleActions).toEqual([{ plugin: "hybrid", action: "blocked" }]);
    expect(moduleOf(reinstall, "hybrid")?.state).toBe("off");

    const asked = await ask(admin, "default_project", "hybrid");
    expect(asked.moduleActions).toEqual([{ plugin: "hybrid", action: "enabled" }]);
    expect(moduleOf(asked, "hybrid")).toMatchObject({ state: "running", listed: true });
  });

  it("a shipped package that replaces a platform node is not automatic: a member's install asks", async () => {
    const body = await install(member, MEMBER_PROJECT, ["swapper"]);

    expect(body.moduleActions).toEqual([{ plugin: "swapper", action: "requested" }]);
    expect(moduleOf(body, "swapper")).toMatchObject({ builtin: false, state: "off" });
    expect(await rowOf(member, MEMBER_PROJECT, SWAPPER.name)).toBeUndefined();
  });

  it("a package in the data root's prefix under a shipped name is not built in", async () => {
    // The prefix resolves first, so this copy is what would load.
    await installOnServer(HYBRID);

    const body = await install(member, MEMBER_PROJECT, ["hybrid"]);

    expect(body.moduleActions).toEqual([{ plugin: "hybrid", action: "requested" }]);
    expect(moduleOf(body, "hybrid")).toMatchObject({ builtin: false, state: "off" });
  });

  it("a module that breaks the boot: the install answers, the listing is undone, the previous App serves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const body = await install(member, MEMBER_PROJECT, ["brittle"]);

      expect(body.moduleActions).toEqual([
        { plugin: "brittle", action: "failed", reason: expect.any(String) },
      ]);
      expect(body.skills.map((s) => s.name)).toContain("brittle-skill");
      expect(moduleOf(body, "brittle")).toMatchObject({ state: "off", listed: false });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/deliberately fails to boot/));
    } finally {
      warn.mockRestore();
    }
    expect(await rowOf(member, MEMBER_PROJECT, BRITTLE.name)).toBeUndefined();
    expect((await ledger()).requests).toEqual([]);
  });

  it("skipModules writes the Agent part only, and says how the module stands", async () => {
    const body = await install(member, MEMBER_PROJECT, ["hybrid"], { skipModules: true });

    expect(body.skills.map((s) => s.name)).toContain("hybrid-skill");
    expect(body.moduleActions).toEqual([]);
    expect(moduleOf(body, "hybrid")).toMatchObject({ builtin: true, state: "off", listed: false });
    expect(await rowOf(member, MEMBER_PROJECT, HYBRID.name)).toBeUndefined();
    expect((await ledger()).requests).toEqual([]);
  });

  it("creating an Agent with a plugins list enables a built-in module", async () => {
    const res = await member.post(`/api/projects/${MEMBER_PROJECT}/agents`, {
      agentId: "with_hybrid",
      plugins: ["hybrid"],
    });

    expect(res.status).toBe(201);
    expect(await rowOf(member, MEMBER_PROJECT, HYBRID.name)).toMatchObject({
      active: true,
      everywhere: false,
    });
    expect((await ledger()).requests).toEqual([
      expect.objectContaining({ package: HYBRID.name, agentId: "with_hybrid", via: "builtin" }),
    ]);
  });

  it("the administrator's routes refuse everyone else, and the member route refuses a non-member", async () => {
    expect((await member.get("/api/admin/plugin-modules")).status).toBe(403);
    expect(
      (
        await member.post("/api/admin/plugin-modules/decide", {
          package: HYBRID.name,
          decision: "enable",
        })
      ).status,
    ).toBe(403);
    expect(
      (await member.post("/api/projects/default_project/plugins/modules", { plugin: "hybrid" }))
        .status,
    ).toBe(404);
    expect(await rowOf(admin, "default_project", HYBRID.name)).toBeUndefined();
  });

  it("a pending request outlives its Project with no Project named, and approving it is refused", async () => {
    await installOnServer(LINKED);
    expect((await member.post("/api/projects", { projectId: "member-side" })).status).toBe(201);
    await install(member, "member-side", ["linked"]);

    expect((await member.delete("/api/projects/member-side")).status).toBe(204);

    expect((await ledger()).requests).toEqual([
      expect.objectContaining({ package: LINKED.name, projectId: null, projectName: null }),
    ]);
    const res = await decide(LINKED.name, "enable");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("project_gone");
  });
});
