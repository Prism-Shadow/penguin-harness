/**
 * The installed-plugins surface: what a PROJECT asks for, which of those the process is
 * actually running, and that writing the list is an admin operation which does not pretend to
 * load anything (plugins load once per process, in the runtime).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { InstalledPluginsResponse, UsageErrorsPage } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import { PluginInstallError } from "../src/plugin/install.js";
import { openPushSlip } from "../src/hmr/push-plugins.js";
import { contentTable, decorators, lower, writeClassPackage } from "./plugin-fixtures.js";
import type { ClassPackage } from "./plugin-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("installed plugins", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  const programEntry = process.argv[1];

  const listFile = () => path.join(t.root, "default_project", ".project_config.toml");

  /**
   * Ships a package the way the build does: under the installation's `plugins/` prefix,
   * named in that prefix's manifest. The installation is what `process.argv[1]` points
   * into (plugin/loader.ts pluginBases), so the test app's program entry is pointed at a
   * directory of the temp root for the file's duration.
   */
  const ship = async (pkg: ClassPackage) => {
    const prefix = path.join(t.root, "install", "plugins");
    process.argv[1] = path.join(t.root, "install", "bin", "server.js");
    const manifestFile = path.join(prefix, "package.json");
    const manifest = JSON.parse(
      await fs.readFile(manifestFile, "utf8").catch(() => '{"name":"prefix","private":true}'),
    ) as { dependencies?: Record<string, string> };
    manifest.dependencies = { ...manifest.dependencies, [pkg.name]: "0.0.0" };
    await fs.mkdir(prefix, { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    await writeClassPackage(path.join(prefix, "node_modules", ...pkg.name.split("/")), pkg);
  };

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });

  afterEach(async () => {
    if (programEntry !== undefined) process.argv[1] = programEntry;
    await t.cleanup();
  });

  const view = async () =>
    (await (
      await admin.get("/api/projects/default_project/plugins/installed")
    ).json()) as InstalledPluginsResponse;

  /** The `event:`/`data:` pairs of an SSE answer, in the order the stream wrote them. */
  const parseSSE = (text: string): Array<{ event: string; data: string }> =>
    text
      .split("\n\n")
      .filter((block) => block.trim() !== "")
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

  /**
   * A real gzipped tarball of a Skills-only package, packed by the system tar — the bytes a
   * github release channel serves, whose manifest npm reads back on a `file:` install.
   */
  const execFileAsync = promisify(execFile);
  async function packTarball(name: string, version: string): Promise<Uint8Array> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-channel-pkg-"));
    try {
      await fs.mkdir(path.join(dir, "package", "skills", "keep"), { recursive: true });
      await fs.writeFile(
        path.join(dir, "package", "package.json"),
        JSON.stringify({ name, version }),
      );
      // A built plugin carries its ifaces.json: the install vets what landed and refuses a
      // package that contributes nothing (it would not list), so the fixture is one.
      await fs.writeFile(
        path.join(dir, "package", "ifaces.json"),
        contentTable(name, { skills: ["keep"] }),
      );
      await fs.writeFile(
        path.join(dir, "package", "skills", "keep", "SKILL.md"),
        "---\nname: keep\ndescription: a skill lives here\n---\n\nKeeps the install a plugin.\n",
      );
      // Relative to the dir: a Windows path carries a drive letter, which GNU tar reads as a
      // remote host name.
      await execFileAsync("tar", ["-czf", "asset.tgz", "package"], { cwd: dir });
      return new Uint8Array(await fs.readFile(path.join(dir, "asset.tgz")));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  /** npm's answer as the route sees it from its stand-in: a failure sorted into a bucket. */
  const npmSays = (message: string, reason: "unavailable" | "other"): never => {
    const err = new PluginInstallError(message);
    err.reason = reason;
    throw err;
  };

  /** An SSE POST, the cookie and the accept header the page's stream fetch sends. */
  const postStream = (cookie: string, specifier: string) =>
    t.app.request("/api/projects/default_project/plugins/installed", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ specifier }),
    });

  it("reports an empty list when nothing is installed", async () => {
    const res = await view();
    expect(res.plugins).toEqual([]);
    expect(res.file).toBe(".project_config.toml");
    expect(res.restartPending).toBe(false);
  });

  it("a plugin the build ships is offered, not installed", async () => {
    // The shipped set is a tag for the catalogue: nothing appears as installed, and nothing
    // loads, until a Project names it. (A test app ships none, so the set is empty; the
    // load-time half of this is plugin-loader.test.ts.)
    const res = await view();
    expect(res.shipped).toEqual([]);
    expect(res.plugins).toEqual([]);
  });

  it("says a listed plugin is not active, and why when it cannot even be read", async () => {
    await fs.writeFile(listFile(), 'models = []\n[plugins]\n"@acme/not-installed" = "*"\n');
    const res = await view();
    expect(res.plugins).toHaveLength(1);
    expect(res.plugins[0]).toMatchObject({ specifier: "@acme/not-installed", active: false });
    // A specifier with no package on the machine is a configuration error, not a pending restart.
    expect(res.plugins[0]!.error).toMatch(/not installed on this machine/);
    expect(res.restartPending).toBe(false);
  });

  it("rewrites the list for an admin, and refuses everyone else", async () => {
    await ship({ name: "@acme/one", module: "One" });
    const saved = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/one", "@acme/one"],
    });
    expect(saved.status).toBe(200);
    // Written once: the table is keyed by name, in the order given — and it lands in the
    // Project's own config, beside its models, rather than in a file of its own.
    expect(
      ((await saved.json()) as InstalledPluginsResponse).plugins.map((p) => p.specifier),
    ).toEqual(["@acme/one"]);
    const written = await fs.readFile(listFile(), "utf8");
    expect(written).toContain("[plugins]");
    expect(written).toContain('"@acme/one" = "*"');

    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    // The list is the PROJECT's now, so it is reachable only by that Project's people. An
    // outsider is refused before the admin check ever runs.
    expect((await member.get("/api/projects/default_project/plugins/installed")).status).toBe(404);
    expect(
      (await admin.post("/api/projects/default_project/members", { userId: "member" })).status,
    ).toBe(201);
    // Reading is not an admin operation: a member of the Project sees what it asked for.
    expect((await member.get("/api/projects/default_project/plugins/installed")).status).toBe(200);
    // Writing still is.
    expect(
      (await member.put("/api/projects/default_project/plugins/installed", { plugins: [] })).status,
    ).toBe(403);
    expect(
      (await admin.put("/api/projects/default_project/plugins/installed", { plugins: [""] }))
        .status,
    ).toBe(400);
  });

  it("a rewrite is gated like an add: a new name must be on this machine", async () => {
    // What a single add refuses, a list rewrite refuses too — otherwise PUT would be the
    // way to name a path, or a package that is not on disk. A name already on the list was
    // consented to when it was written and stays writable, so removing another name beside
    // it works.
    await fs.writeFile(listFile(), 'models = []\n[plugins]\n"@acme/by-hand" = "*"\n');
    for (const bad of ["/tmp/anything.js", "../x", "@acme/tools/sandbox", "pkg@1.0.0"]) {
      const res = await admin.put("/api/projects/default_project/plugins/installed", {
        plugins: ["@acme/by-hand", bad],
      });
      expect(res.status, bad).toBe(400);
      expect(await res.json(), bad).toMatchObject({ error: { code: "bad_request" } });
    }
    const absent = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/by-hand", "@acme/not-installed"],
    });
    expect(absent.status).toBe(400);
    expect(await absent.json()).toMatchObject({ error: { code: "plugin_not_installed" } });
    expect(await fs.readFile(listFile(), "utf8")).toContain('"@acme/by-hand" = "*"');
    expect(await fs.readFile(listFile(), "utf8")).not.toContain("not-installed");
    const kept = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/by-hand"],
    });
    expect(kept.status).toBe(200);
  });

  it("installs a package before listing it, and refuses a specifier that is neither a package name nor an https link", async () => {
    // npm is not driven in a unit test: what is pinned here is that the route validates the
    // specifier and does not write the list when nothing was installed. (What it installs from
    // a link or a zip is plugin-archive.test.ts's.)
    for (const bad of ["../evil", "http://example.com/x.tgz", "", "Has Spaces"]) {
      expect(
        (await admin.post("/api/projects/default_project/plugins/installed", { specifier: bad }))
          .status,
        bad,
      ).toBe(400);
    }
    expect(await view()).toMatchObject({ plugins: [] });
  });

  it("drops a specifier from the list on delete", async () => {
    await ship({ name: "@acme/one", module: "One" });
    await ship({ name: "@acme/two", module: "Two" });
    await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/one", "@acme/two"],
    });
    const res = await admin.delete(
      "/api/projects/default_project/plugins/installed?specifier=@acme/one",
    );
    expect(res.status).toBe(200);
    expect((await view()).plugins.map((p) => p.specifier)).toEqual(["@acme/two"]);
    const member = apiClient(t.app, (await provisionUser(t.app, "other")).cookie);
    expect(
      (await member.delete("/api/projects/default_project/plugins/installed?specifier=@acme/two"))
        .status,
    ).toBe(403);
  });

  it("a plugin asked of another machine only is listed there, and neither installed nor loaded here", async () => {
    const other = "Other00000000000";
    const res = await admin.post("/api/projects/default_project/plugins/installed", {
      specifier: "@acme/elsewhere@1.2.3",
      machineId: other,
    });
    // Nothing fetched it here — a local npm install of a package that does not exist would
    // have answered plugin_install_failed.
    expect(res.status).toBe(200);
    const body = (await res.json()) as InstalledPluginsResponse;
    expect(body.plugins).toEqual([
      expect.objectContaining({
        specifier: "@acme/elsewhere",
        active: false,
        everywhere: false,
        machines: [other],
        here: false,
      }),
    ]);
    expect(body.plugins[0]!.error).toBeUndefined();
    expect(body.restartPending).toBe(false);
    expect(await fs.readFile(listFile(), "utf8")).toContain(
      `[plugins.${other}]\n"@acme/elsewhere" = "1.2.3"`,
    );

    // Removing it from that machine's table leaves the shared table alone.
    await ship({ name: "@acme/one", module: "One" });
    await admin.put("/api/projects/default_project/plugins/installed", { plugins: ["@acme/one"] });
    const removed = await admin.delete(
      `/api/projects/default_project/plugins/installed?specifier=@acme/elsewhere&machineId=${other}`,
    );
    expect(removed.status).toBe(200);
    expect((await view()).plugins.map((p) => [p.specifier, p.everywhere])).toEqual([
      ["@acme/one", true],
    ]);
    expect(
      (
        await admin.post("/api/projects/default_project/plugins/installed", {
          specifier: "@acme/one",
          machineId: "ssh:not-an-id",
        })
      ).status,
    ).toBe(400);
  });

  it("a plugin listed for this server's own id runs here", async () => {
    await ship({ name: "@acme/mine", module: "Mine" });
    const self = (await view()).machineId;
    const res = await admin.post("/api/projects/default_project/plugins/installed", {
      specifier: "@acme/mine",
      machineId: self,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as InstalledPluginsResponse;
    expect(body.plugins[0]).toMatchObject({
      specifier: "@acme/mine",
      active: true,
      everywhere: false,
      machines: [self],
      here: true,
    });
    const config = await fs.readFile(listFile(), "utf8");
    expect(config).toContain(`[plugins.${self}]\n"@acme/mine" = "*"`);
    const shared = config.split("[plugins]")[1]?.split("\n[")[0] ?? "";
    expect(shared).not.toContain('"@acme/mine"');
  });

  it("reports why a listed plugin failed to load, not a restart that would not help", async () => {
    // A shipped package that throws on import.
    await ship({
      name: "@acme/broken",
      module: "Broken",
      index: 'throw new Error("deliberately broken");\n',
    });
    const saved = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/broken"],
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as InstalledPluginsResponse;
    expect(body.plugins[0]).toMatchObject({ specifier: "@acme/broken", active: false });
    expect(body.plugins[0]!.error).toMatch(/deliberately broken/);
    expect(body.restartPending).toBe(false);
  });

  it("says a plugin this build cannot fully run is disabled, or runs without part of itself — not waiting for a restart", async () => {
    // Loaded, as a push leaves installed plugins loaded, but built against what this build
    // does not have: one contributes to a slot nothing declares, the other stands in for a
    // node under an interface no table carries.
    const partial: ModuleDef = {
      manifest: parseManifest({
        name: "ext-partial",
        requires: {},
        provides: {},
        contributes: { "nowhere.slot": [{ id: "ext-partial.x" }] },
        children: [],
      }),
      create: () => ({ api: {} }),
    };
    const unmet: ModuleDef = {
      manifest: parseManifest({
        name: "ServerSettingsRepo",
        requires: {},
        provides: { Settings: "@prismshadow/penguin-server#Nope" },
        contributes: {},
        children: [],
      }),
      create: () => ({ api: { Settings: {} } }),
    };
    const host = new PluginHost();
    host.use({ specifier: "@acme/partial", modules: [partial], replaces: [] });
    host.use({ specifier: "@acme/unmet", modules: [], replaces: [unmet] });
    await t.cleanup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    t = await createTestApp({ plugins: host });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    await ship({ name: "@acme/partial", module: "Partial" });
    await ship({ name: "@acme/unmet", module: "Unmet" });
    await fs.writeFile(
      listFile(),
      'models = []\n[plugins]\n"@acme/partial" = "*"\n"@acme/unmet" = "*"\n',
    );

    const res = await view();
    const row = (specifier: string) => res.plugins.find((p) => p.specifier === specifier)!;
    expect(row("@acme/partial")).toMatchObject({ active: true, unsatisfied: { disabled: false } });
    expect(row("@acme/partial").unsatisfied!.reason).toMatch(/nowhere\.slot/);
    expect(row("@acme/unmet")).toMatchObject({ active: false, unsatisfied: { disabled: true } });
    expect(row("@acme/unmet").unsatisfied!.reason).toMatch(/Nope/);
    expect(row("@acme/unmet").error).toBeUndefined();
    // A restart boots the same build, so it is not what this is waiting for.
    expect(res.restartPending).toBe(false);

    // Each is one unexpected error an admin finds in the Cost Center, under the plugin's own code.
    const errors = (await (
      await admin.get("/api/projects/default_project/usage/errors?offset=0&limit=50")
    ).json()) as UsageErrorsPage;
    const recorded = errors.items.filter((e) => e.source === "plugin");
    expect(recorded.map((e) => [e.code, e.kind]).sort()).toEqual([
      ["unsatisfied:@acme/partial", "unexpected"],
      ["unsatisfied:@acme/unmet", "unexpected"],
    ]);
    expect(recorded.find((e) => e.code.endsWith("unmet"))!.message).toMatch(
      /^Disabled on this build: .*Nope/,
    );
    warn.mockRestore();
  });

  it("a re-assembly is not a push: it never refuses for a plugin the build cannot run", async () => {
    const partial: ModuleDef = {
      manifest: parseManifest({
        name: "ext-partial",
        requires: {},
        provides: {},
        contributes: { "nowhere.slot": [{ id: "ext-partial.x" }] },
        children: [],
      }),
      create: () => ({ api: {} }),
    };
    const host = new PluginHost();
    host.use({ specifier: "@acme/partial", modules: [partial], replaces: [] });
    await t.cleanup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    t = await createTestApp({ plugins: host });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    await ship({ name: "@acme/fine", module: "Fine" });
    // A push's slip with no acceptance on it, left registered: only the boot a push makes
    // may take it, and the re-assembly below is not one.
    const { slip, close } = openPushSlip(t.deps.hmr.resources, false);
    const saved = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/fine"],
    });
    close();
    warn.mockRestore();
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as InstalledPluginsResponse;
    expect(body.plugins[0]).toMatchObject({ specifier: "@acme/fine", active: true });
    expect(slip).toMatchObject({ taken: false, refused: false });
  });

  it("a plugin that breaks the boot is undone, and the previous App keeps serving", async () => {
    // A load failure is isolated per entry; a BOOT failure (the module's setup throws) is
    // not — the kernel fails the whole tree. The change that introduced it is undone before
    // the previous tree is restored, so the process is not left forwarding to a disposed
    // App, and the next start does not fail on the same list.
    await ship({ name: "@acme/fine", module: "Fine" });
    await ship({
      name: "@acme/bad-boot",
      module: "BadBoot",
      index: lower(`import { Module } from ${JSON.stringify(decorators)};
        @Module() export class BadBoot { setup() { throw new Error("deliberately fails to boot"); } }
        export default { modules: [BadBoot] };`),
    });
    expect(
      (
        await admin.post("/api/projects/default_project/plugins/installed", {
          specifier: "@acme/fine",
        })
      ).status,
    ).toBe(200);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await admin.post("/api/projects/default_project/plugins/installed", {
        specifier: "@acme/bad-boot",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as InstalledPluginsResponse;
      // Undone: the list is as it was, and what runs is what ran.
      expect(body.plugins.map((p) => [p.specifier, p.active])).toEqual([["@acme/fine", true]]);
      expect(await fs.readFile(listFile(), "utf8")).not.toContain("bad-boot");
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/deliberately fails to boot/));
    } finally {
      warn.mockRestore();
    }
    // Still serving, on the restored App.
    expect((await admin.get("/api/projects/default_project/plugins/installed")).status).toBe(200);
  });

  it("a plugin change moves the runtime's tree to the re-assembled App, with no push", async () => {
    // The runtime (index.ts) holds `boot.tree` for the socket's auth, the hot-update gate and
    // the process error record. A plugin change rebuilds the App INSIDE the platform instance
    // (hmr/platform.ts reassemble) — no push, so no replace hook fires. Read through the
    // instance, the tree is the re-assembled App's; a snapshot would be the disposed one,
    // and the next socket handshake would throw `no api 'Auth'`.
    await ship({ name: "@acme/fine", module: "Fine" });
    const before = t.boot.tree.api("IdentityModule", "Auth");
    expect(
      (
        await admin.post("/api/projects/default_project/plugins/installed", {
          specifier: "@acme/fine",
        })
      ).status,
    ).toBe(200);
    const after = t.boot.tree.api("IdentityModule", "Auth");
    expect(after).not.toBe(before);
    const instance = await t.boot.hmr.ensure();
    expect(t.boot.tree).toBe(instance.api.business());
    // The first generation's tree, as the flattened test view still holds it, is disposed:
    // this is what the runtime used to keep answering from.
    expect(() => t.deps.tree.api("IdentityModule", "Auth")).toThrow(/no api/);
  });

  it("reports a list file that cannot be read, rather than an empty deployment", async () => {
    await fs.writeFile(listFile(), "{ not json");
    const res = await admin.get("/api/projects/default_project/plugins/installed");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(".project_config.toml");
  });

  it("a stream install answers its events in order — the download, npm, the result", async () => {
    // The beforeEach app has no channel to fall through to; this one does: a published index
    // and its release asset, both served here. npm stands in and refuses the name the way the
    // registry does, so the install takes the channel — whose asset this server fetches,
    // reports, verifies, and npm-installs from the file: record it keeps.
    await t.cleanup();
    const tarball = await packTarball("@acme/channels", "1.0.0");
    // The asset's URL needs the port, which exists only once the server listens; the index
    // answers per request, by which time it is set.
    let base = "";
    const serve = createServer((req, res) => {
      if (req.url === "/index.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify([
            {
              name: "@acme/channels",
              version: "1.0.0",
              description: "the package the channel serves",
              authors: ["acme"],
              license: "MIT",
              integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
              channels: [{ kind: "github", url: `${base}/asset.tgz` }],
            },
          ]),
        );
      } else if (req.url === "/asset.tgz") {
        res.writeHead(200, {
          "content-type": "application/x-tar",
          "content-length": String(tarball.byteLength),
        });
        res.end(tarball);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => serve.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(serve.address() as AddressInfo).port}`;
    try {
      t = await createTestApp({
        pluginPackages: {
          install: async (_root, source) =>
            npmSays(
              `npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/${source}`,
              "unavailable",
            ),
          installFiles: async () => npmSays("not used", "other"),
          remove: async () => {},
        },
        config: { pluginIndexUrl: `${base}/index.json` },
      });
      const cookie = (await loginAdmin(t.app)).cookie;
      admin = apiClient(t.app, cookie);
      const res = await postStream(cookie, "@acme/channels");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const events = parseSSE(await res.text());
      // The first event says the download began; the last one carries the finished answer,
      // with npm's hand-off between — whatever the asset's chunking reported between.
      expect(events[0]).toEqual({
        event: "download",
        data: JSON.stringify({ received: 0, total: null }),
      });
      expect(events.at(-1)!.event).toBe("result");
      expect(events.at(-2)!.event).toBe("npm");
      const reported = events
        .slice(1, -2)
        .map((e) => JSON.parse(e.data) as { received: number; total: number | null });
      expect(reported.length).toBeGreaterThan(0);
      for (const progress of reported) expect(progress.total).toBe(tarball.byteLength);
      expect(reported.at(-1)!.received).toBe(tarball.byteLength);
      const result = JSON.parse(events.at(-1)!.data) as InstalledPluginsResponse;
      // A Skills-only package joins the library, not the Project's table.
      expect(result.installed).toMatchObject({
        name: "@acme/channels",
        version: "1.0.0",
        library: true,
      });
      expect(result.plugins).toEqual([]);
    } finally {
      serve.close();
      serve.closeAllConnections();
    }
  });

  it("a stream install that fails rides the failure as an error event, with the status the JSON answer would have had", async () => {
    await t.cleanup();
    t = await createTestApp({
      pluginPackages: {
        install: async () => npmSays("npm error code EACCES\nnpm error permission denied", "other"),
        installFiles: async () => npmSays("not used", "other"),
        remove: async () => {},
      },
    });
    const cookie = (await loginAdmin(t.app)).cookie;
    admin = apiClient(t.app, cookie);
    const res = await postStream(cookie, "@acme/denied");
    expect(res.status).toBe(200); // the stream itself answers well
    const events = parseSSE(await res.text());
    expect(events.map((e) => e.event)).toEqual(["download", "error"]);
    expect(JSON.parse(events[1]!.data)).toMatchObject({
      status: 400,
      code: "plugin_install_failed",
      message: expect.stringContaining("npm: npm error code EACCES"),
    });
  });
});
