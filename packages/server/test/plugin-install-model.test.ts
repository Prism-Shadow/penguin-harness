/**
 * A plugin's server install and its Agent installs (05 「插件库」 「安装模型」 「安装从不卡住」).
 *
 * An install never hangs, and says why it failed:
 * - Given the registry has the name, when an admin installs it, then the registry is asked first
 *   (the stream says so) and the install runs after.
 * - Given npm answers that the name is not published and the build carries an offline archive of
 *   it, when an admin installs it by name, then it installs from the archive, and the answer and
 *   the stream say so.
 * - Given the registry does not answer, the same install also comes from the archive.
 * - In both, the registry check says so and the install by name never starts.
 * - Given the archive's bytes do not match the sha512 recorded with them, nothing installs and the
 *   refusal says the archive was not used.
 * - Given npm answers 404 and there is no archive, the refusal is `plugin_not_published`, naming
 *   the package; given the registry does not answer, it is `plugin_source_unreachable`.
 * - Given an install that runs longer than the stream's heartbeat, the stream sends a `ping`
 *   before its result, so the idle cut never takes a running install's stream.
 * - Given a module whose start runs for minutes, the install answers after a minute that it is
 *   still starting, and the App takes the module once its start ends.
 *
 * Uninstalling from the server uninstalls from every Agent:
 * - Given a plugin on two Agents in two Projects, the holders name both; uninstalling it from the
 *   server removes it from both Agents, then from the server, and the library no longer lists it.
 * - Given a Project's shared table lists it, the uninstall is refused (`plugin_shared`) and
 *   nothing is removed; a plugin the build ships is refused (`plugin_shipped`); a member may
 *   neither read the holders nor uninstall.
 *
 * A member's Agent install of a plugin not on the server yet is a request:
 * - Given a member asks for a package the server does not have, a pending request is recorded
 *   that says the package is not on the server; enabling it is refused until it is installed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  InstalledPluginsResponse,
  PluginHoldersResponse,
  PluginLibraryResponse,
  PluginModuleRequestsResponse,
  PluginServerUninstallResponse,
} from "../src/api/types.js";
import { contentTable, decorators, lower, writeClassPackage } from "./plugin-fixtures.js";
import { fakeNpm, type Files } from "./fake-npm.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const NOTES = "@acme/notes";

/** A built package of one Skill: what a registry, a link or an archive would install. */
const notesPackage = (version = "1.0.0"): Files => ({
  "package.json": JSON.stringify({ name: NOTES, version }),
  "ifaces.json": contentTable(NOTES, { skills: ["notes"] }),
  "skills/notes/SKILL.md": "---\nname: notes\ndescription: keeps notes\n---\n\nKeeps notes.\n",
});

describe("a plugin's server and Agent installs", () => {
  const programEntry = process.argv[1];
  let t: TestApp;
  let npm: ReturnType<typeof fakeNpm>;
  let admin: ReturnType<typeof apiClient>;
  let cookie: string;

  const boot = async () => {
    npm = fakeNpm();
    t = await createTestApp({ pluginPackages: npm });
    cookie = (await loginAdmin(t.app)).cookie;
    admin = apiClient(t.app, cookie);
  };

  afterEach(async () => {
    vi.useRealTimers();
    if (programEntry !== undefined) process.argv[1] = programEntry;
    await t.cleanup();
  });

  /**
   * The build's offline archive of `@acme/notes`, staged in the installation's builtin prefix the
   * way scripts/build-plugins.mjs stages it (the program entry points into that installation).
   */
  const carryOffline = async (opts: { integrity?: string } = {}) => {
    const prefix = path.join(t.root, "install", "plugins");
    process.argv[1] = path.join(t.root, "install", "bin", "server.js");
    const offline = path.join(prefix, "offline");
    await fs.mkdir(path.join(offline, "notes"), { recursive: true });
    await fs.writeFile(path.join(prefix, "package.json"), '{"name":"prefix","private":true}');
    const tarball = Buffer.from("the bytes npm pack wrote");
    await fs.writeFile(path.join(offline, "acme-notes-1.0.0.tgz"), tarball);
    const files = notesPackage();
    await fs.writeFile(path.join(offline, "notes", "package.json"), files["package.json"]!);
    await fs.writeFile(path.join(offline, "notes", "ifaces.json"), files["ifaces.json"]!);
    const integrity =
      opts.integrity ?? `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    await fs.writeFile(
      path.join(offline, "index.json"),
      JSON.stringify([
        { name: NOTES, version: "1.0.0", file: "acme-notes-1.0.0.tgz", integrity, meta: "notes" },
      ]),
    );
    npm.tarballs.set("acme-notes-1.0.0.tgz", files);
  };

  /** The `event:`/`data:` pairs of an SSE text, in order. */
  const parseSSE = (text: string) =>
    text
      .split("\n\n")
      .filter((block) => block.includes("event:"))
      .map((block) => ({
        event: block
          .split("\n")
          .find((line) => line.startsWith("event:"))!
          .slice("event:".length)
          .trim(),
        data: block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim())
          .join("\n"),
      }));

  const postStream = (specifier: string) =>
    t.app.request("/api/projects/default_project/plugins/installed", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ specifier }),
    });

  const libraryNames = async (client = admin) =>
    ((await (await client.get("/api/plugins")).json()) as PluginLibraryResponse).groups.flatMap(
      (g) => g.plugins.map((p) => p.name),
    );

  const agentSkills = async (client: ReturnType<typeof apiClient>, p: string, a: string) =>
    (
      (await (await client.get(`/api/projects/${p}/agents/${a}/plugins`)).json()) as {
        skills: Array<{ name: string }>;
      }
    ).skills.map((s) => s.name);

  describe("an install never hangs", () => {
    it("asks the registry about a name first, then installs it", async () => {
      await boot();
      npm.links.set(NOTES, notesPackage());
      const events = parseSSE(await (await postStream(NOTES)).text());
      expect(events.filter((e) => e.event === "stage").map((e) => JSON.parse(e.data))).toEqual([
        { stage: "checking" },
        { stage: "installing", source: "registry" },
      ]);
      expect(events.at(-1)!.event).toBe("result");
      expect(npm.checks).toEqual([NOTES]);
      expect(npm.calls).toEqual([NOTES]);
    });

    it("installs from the build's offline archive when the registry has not published it", async () => {
      await boot();
      npm.registry.says404 = true;
      await carryOffline();
      const events = parseSSE(await (await postStream(NOTES)).text());
      expect(events.map((e) => e.event)).toEqual(["npm", "stage", "stage", "result"]);
      expect(events.slice(1, 3).map((e) => JSON.parse(e.data))).toEqual([
        { stage: "checking" },
        { stage: "installing", source: "offline" },
      ]);
      const result = JSON.parse(events.at(-1)!.data) as InstalledPluginsResponse;
      expect(result.installed).toMatchObject({ name: NOTES, version: "1.0.0", from: "offline" });
      expect(npm.checks).toEqual([NOTES]);
      expect(npm.calls).toEqual(["<tarball acme-notes-1.0.0.tgz>"]);
      expect(await libraryNames()).toContain("notes");
    });

    it("installs from the offline archive when the registry does not answer", async () => {
      await boot();
      npm.registry.down = true;
      await carryOffline();
      const res = await admin.post("/api/projects/default_project/plugins/installed", {
        specifier: NOTES,
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as InstalledPluginsResponse).installed).toMatchObject({
        from: "offline",
      });
      expect(npm.calls).toEqual(["<tarball acme-notes-1.0.0.tgz>"]);
    });

    it("refuses an offline archive whose bytes do not match its recorded sha512", async () => {
      await boot();
      npm.registry.says404 = true;
      await carryOffline({ integrity: "sha512-AAAA" });
      const res = await admin.post("/api/projects/default_project/plugins/installed", {
        specifier: NOTES,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: {
          code: "plugin_not_published",
          message: expect.stringContaining("does not match the sha512 recorded with it"),
        },
      });
      expect(npm.calls).toEqual([]);
      expect(await libraryNames()).not.toContain("notes");
    });

    it("says a package is not published, or that the registry did not answer", async () => {
      await boot();
      npm.registry.says404 = true;
      const missing = await admin.post("/api/projects/default_project/plugins/installed", {
        specifier: NOTES,
      });
      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({
        error: {
          code: "plugin_not_published",
          message: expect.stringMatching(/^@acme\/notes is not published on .+ yet\./),
        },
      });
      npm.registry.down = true;
      const down = await admin.post("/api/projects/default_project/plugins/installed", {
        specifier: NOTES,
      });
      expect(await down.json()).toMatchObject({
        error: {
          code: "plugin_source_unreachable",
          message: expect.stringMatching(/^registry\.npmjs\.org did not answer\./),
        },
      });
      expect(npm.calls).toEqual([]);
    });

    it("keeps a long install's stream alive with a ping before its result", async () => {
      await boot();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const install = npm.install;
      npm.links.set(NOTES, notesPackage());
      npm.install = async (root, source) => {
        await gate;
        return install(root, source);
      };
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const res = await postStream(NOTES);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      const readUntil = async (marker: string) => {
        while (!text.includes(marker)) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
      };
      await readUntil("event: stage");
      await vi.advanceTimersByTimeAsync(21_000);
      await readUntil("event: ping");
      release();
      await readUntil("event: result");
      const names = parseSSE(text).map((e) => e.event);
      expect(names.indexOf("ping")).toBeGreaterThan(-1);
      expect(names.indexOf("ping")).toBeLessThan(names.indexOf("result"));
    });
  });

  it("answers that a module is still starting when its start runs for minutes, and loads it after", async () => {
    await boot();
    // Shipped the way the build ships a module: asking for it is a list edit and a re-assembly.
    const prefix = path.join(t.root, "install", "plugins");
    process.argv[1] = path.join(t.root, "install", "bin", "server.js");
    await fs.mkdir(prefix, { recursive: true });
    await fs.writeFile(
      path.join(prefix, "package.json"),
      JSON.stringify({ name: "prefix", private: true, dependencies: { "@acme/slow": "0.0.0" } }),
    );
    await writeClassPackage(path.join(prefix, "node_modules", "@acme", "slow"), {
      name: "@acme/slow",
      module: "SlowStart",
      index: lower(`import { Module } from ${JSON.stringify(decorators)};
        @Module() export class SlowStart {
          async setup() { await new Promise((resolve) => setTimeout(resolve, 5 * 60_000)); }
        }
        export default { modules: [SlowStart] };`),
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Simulated time moves a second at a time while the install runs, the real event loop turning
    // between steps so the install's file work (and the plugin's import) reaches each timer it
    // sets. Once it has answered, only the module's own five-minute start is left to wait out,
    // in larger steps: each step there asks the server over HTTP, and a slow runner cannot make
    // three hundred of those inside the real-time bound.
    const tick = async (step: number) => {
      await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(step);
    };
    let settled = false;
    const answer = Promise.resolve(
      admin.post("/api/projects/default_project/plugins/installed", { specifier: "@acme/slow" }),
    ).finally(() => (settled = true));
    // Real time bounds the wait (Date is not faked): the install's file work takes what it takes.
    const until = async (done: () => boolean | Promise<boolean>, step = 1_000) => {
      const deadline = Date.now() + 20_000;
      while (!(await done()) && Date.now() < deadline) await tick(step);
    };
    await until(() => settled);
    const res = await answer;
    expect(res.status).toBe(200);
    const body = (await res.json()) as InstalledPluginsResponse;
    expect(body.loading).toBe(true);
    // The module's start ends five minutes in; the App then runs it.
    const active = async () =>
      (
        (await (
          await admin.get("/api/projects/default_project/plugins/installed")
        ).json()) as InstalledPluginsResponse
      ).plugins.find((p) => p.specifier === "@acme/slow")?.active === true;
    await until(active, 15_000);
    expect(await active()).toBe(true);
  }, 60_000);

  describe("uninstalling from the server uninstalls from every Agent", () => {
    /** Notes on the server, on the admin's default Agent, and on a member's Agent in her own Project. */
    const notesEverywhere = async () => {
      await boot();
      npm.links.set(NOTES, notesPackage());
      expect(
        (await admin.post("/api/projects/default_project/plugins/installed", { specifier: NOTES }))
          .status,
      ).toBe(200);
      expect(
        (
          await admin.post("/api/projects/default_project/agents/default_agent/plugins", {
            names: ["notes"],
          })
        ).status,
      ).toBe(201);
      const mia = apiClient(t.app, (await provisionUser(t.app, "mia")).cookie);
      expect(
        (await mia.post("/api/projects", { projectId: "mia-own", name: "Mia's" })).status,
      ).toBe(201);
      expect(
        (await mia.post("/api/projects/mia-own/agents", { agentId: "helper", plugins: ["notes"] }))
          .status,
      ).toBe(201);
      return mia;
    };

    it("keeps a cached market package on its selected Agents when a new Project or Agent is created", async () => {
      const mia = await notesEverywhere();
      expect(await agentSkills(mia, "mia-own", "default_agent")).not.toContain("notes");
      expect(
        (await mia.post("/api/projects/mia-own/agents", { agentId: "plain", name: "Plain" }))
          .status,
      ).toBe(201);
      expect(await agentSkills(mia, "mia-own", "plain")).not.toContain("notes");
      expect(await agentSkills(mia, "mia-own", "helper")).toContain("notes");
      expect(await agentSkills(admin, "default_project", "default_agent")).toContain("notes");
    });

    it("names every Agent that has it, then takes it from each before leaving the server", async () => {
      const mia = await notesEverywhere();
      const holders = (await (
        await admin.get(`/api/admin/plugins/holders?package=${encodeURIComponent(NOTES)}`)
      ).json()) as PluginHoldersResponse;
      expect(holders).toMatchObject({
        plugin: "notes",
        onServer: true,
        shipped: false,
        shared: [],
      });
      expect(holders.agents.map((a) => [a.projectId, a.agentId, a.projectName])).toEqual([
        ["default_project", "default_agent", expect.any(String)],
        ["mia-own", "helper", "Mia's"],
      ]);

      const res = await admin.delete(`/api/admin/plugins?package=${encodeURIComponent(NOTES)}`);
      expect(res.status).toBe(200);
      const done = (await res.json()) as PluginServerUninstallResponse;
      expect(done.agents.map((a) => a.agentId)).toEqual(["default_agent", "helper"]);
      expect(done.agents.every((a) => a.failed === undefined)).toBe(true);
      expect(await agentSkills(admin, "default_project", "default_agent")).not.toContain("notes");
      expect(await agentSkills(mia, "mia-own", "helper")).not.toContain("notes");
      expect(npm.removed).toEqual([NOTES]);
      expect(await libraryNames()).not.toContain("notes");
    });

    it("refuses while a Project's shared table lists it, and removes nothing", async () => {
      const mia = await notesEverywhere();
      // Listed in the shared table by hand, as an admin edits the Project's config.
      const file = path.join(t.root, "projects", "default_project", ".project_config.toml");
      const config = await fs.readFile(file, "utf8");
      expect(config).not.toMatch(/^\[plugins\]$/m);
      await fs.writeFile(file, `${config}\n[plugins]\n"${NOTES}" = {}\n`);
      const res = await admin.delete(`/api/admin/plugins?package=${encodeURIComponent(NOTES)}`);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "plugin_shared" } });
      expect(await agentSkills(mia, "mia-own", "helper")).toContain("notes");
      expect(npm.removed).toEqual([]);
    });

    it("refuses a plugin the build ships, and a member", async () => {
      const mia = await notesEverywhere();
      const shipped = (await libraryNames()).find((n) => n !== "notes")!;
      const library = (await (await admin.get("/api/plugins")).json()) as PluginLibraryResponse;
      const pkg = library.groups.flatMap((g) => g.plugins).find((p) => p.name === shipped)!.package;
      const builtIn = await admin.delete(`/api/admin/plugins?package=${encodeURIComponent(pkg)}`);
      expect(builtIn.status).toBe(409);
      expect(await builtIn.json()).toMatchObject({ error: { code: "plugin_shipped" } });
      for (const res of [
        await mia.get(`/api/admin/plugins/holders?package=${encodeURIComponent(NOTES)}`),
        await mia.delete(`/api/admin/plugins?package=${encodeURIComponent(NOTES)}`),
      ]) {
        expect(res.status).toBe(403);
      }
      expect(await agentSkills(mia, "mia-own", "helper")).toContain("notes");
    });
  });

  it("records a member's ask for a package not on the server as a request the admin installs first", async () => {
    await boot();
    const mia = apiClient(t.app, (await provisionUser(t.app, "mia")).cookie);
    expect((await mia.post("/api/projects", { projectId: "mia-own", name: "Mia's" })).status).toBe(
      201,
    );
    const asked = await mia.post("/api/projects/mia-own/plugins/modules", {
      package: NOTES,
      agentId: "helper",
    });
    expect(asked.status).toBe(200);
    expect(await asked.json()).toMatchObject({
      moduleActions: [{ plugin: "notes", action: "requested" }],
    });
    const ledger = (await (
      await admin.get("/api/admin/plugin-modules")
    ).json()) as PluginModuleRequestsResponse;
    expect(ledger.requests).toEqual([
      expect.objectContaining({
        package: NOTES,
        projectId: "mia-own",
        agentId: "helper",
        requestedBy: "mia",
        decision: null,
        onServer: false,
      }),
    ]);
    const enable = await admin.post("/api/admin/plugin-modules/decide", {
      package: NOTES,
      decision: "enable",
    });
    expect(enable.status).toBe(409);
    expect(await enable.json()).toMatchObject({ error: { code: "plugin_not_on_server" } });
  });
});
