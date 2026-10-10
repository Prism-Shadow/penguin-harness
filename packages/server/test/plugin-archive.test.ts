/**
 * Importing and exporting plugins, server-wide.
 *
 * - An admin installs a plugin of Skills from a zip: it joins the library as installed on the
 *   server, and no Project's list names it (nothing loads a package of Skills).
 * - A package of server modules from a zip is listed for this machine alone: another machine
 *   handed its name would fetch whatever the registry has under it; its row reads its own
 *   package.json.
 * - A zip of Skills whose package.json has only a name and a version installs, and lists with
 *   no description, category, icon or quick start — nothing invented; an unversioned skill
 *   reads as unversioned.
 * - A member is refused every install path; the local API token an Agent's `penguin plugin
 *   install` carries installs as the admin.
 * - A zip holding another version of an installed package asks before replacing it; the same
 *   version is left as it is.
 * - A malicious or malformed zip is refused before anything is installed: a path leaving the
 *   package, node_modules, a .npmrc (npm would read it while packing), no package.json at the
 *   top, a name that is not a package name, a package that is not a plugin or that the library
 *   would not read, and an archive past the caps, read before it inflates.
 * - Nothing replaces a module the build ships: a zip under its name is refused before it
 *   installs, a link that turns out to be one is taken back; so is a link to a package that is no
 *   plugin, and both refusals say its install scripts have already run.
 * - What POST installs is a registry name or an https link; a path, a plain http, ssh or file
 *   link, credentials in a link, an alias behind a name and a link to a folder or a file inside a
 *   GitHub repository are refused before npm runs.
 * - Export is the package as a zip that imports back as it was — a library plugin's and a
 *   listed server module's; an unlisted name, or one that is a path, is not answered.
 * - npm itself, once: an uploaded package is packed without its scripts and installed, kept as
 *   a tarball the prefix records.
 *
 * npm is faked at its seam (NpmPluginPackages) everywhere but the last scenario: the fake
 * writes the package into the prefix and records it in the prefix's package.json, which is
 * what `npm install` does as far as the server can see.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type {
  InstalledPluginsResponse,
  PluginLibraryResponse,
  PluginIndexResponse,
} from "../src/api/types.js";
import {
  installPluginFiles,
  PluginInstallError,
  type InstalledPackage,
} from "../src/plugin/install.js";
import { writeClassPackage } from "./plugin-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, tokenClient } from "./helpers.js";
import type { TestApp } from "./helpers.js";

type Files = Record<string, string | Uint8Array>;

const bytes = (value: string | Uint8Array) => (typeof value === "string" ? strToU8(value) : value);

/** A zip of `files` (paths as given, so a test can write any entry name it likes). */
const zip = (files: Files) =>
  Buffer.from(
    zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, bytes(v)]))),
  ).toString("base64");

const skill = (name: string, version = "2026.10.01.1") =>
  `---\nname: ${name}\ndescription: Do ${name}.\nversion: ${version}\n---\n\nBody.\n`;

/** A plugin of Skills, `@acme/notes` at `version`, as files of its package directory. */
const notesPackage = (version = "1.0.0"): Files => ({
  "package.json": JSON.stringify({
    name: "@acme/notes",
    version,
    description: "Take notes.",
    penguin: { title: "Notes", category: "office-productivity" },
  }),
  "icon.svg": "<svg viewBox='0 0 24 24'/>\n",
  "skills/notes/SKILL.md": skill("notes"),
});

/** A package of server modules, `@acme/sandbox-x`, as files (the module fixture the loader tests use). */
async function modulePackage(): Promise<Files> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-module-pkg-"));
  try {
    await writeClassPackage(dir, { name: "@acme/sandbox-x", module: "SandboxX" });
    const manifest = JSON.parse(
      await fs.readFile(path.join(dir, "package.json"), "utf8"),
    ) as object;
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        ...manifest,
        version: "0.3.0",
        description: "A sandbox.",
        penguin: { short_description: "Sandbox X.", category: "sandbox" },
      }),
    );
    const files: Files = {};
    for (const name of await fs.readdir(dir)) files[name] = await fs.readFile(path.join(dir, name));
    return files;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * npm, as far as the server can see it: an install writes the package's files under the
 * prefix's node_modules and records it in the prefix's package.json; a link resolves to the
 * package a test registered for it, and anything else fails the way npm does.
 */
function fakeNpm() {
  const calls: string[] = [];
  /** The packages taken back out of the prefix, in order. */
  const removed: string[] = [];
  const links = new Map<string, Files>();
  const place = async (root: string, files: Files, spec: string): Promise<InstalledPackage> => {
    const prefix = path.join(root, "plugins");
    const manifest = JSON.parse(strFromU8(bytes(files["package.json"]!))) as {
      name: string;
      version: string;
    };
    const dir = path.join(prefix, "node_modules", ...manifest.name.split("/"));
    await fs.rm(dir, { recursive: true, force: true });
    for (const [rel, value] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), bytes(value));
    }
    const prefixFile = path.join(prefix, "package.json");
    const own = JSON.parse(
      await fs
        .readFile(prefixFile, "utf8")
        .catch(() => '{"name":"penguin-plugins","private":true}'),
    ) as { dependencies?: Record<string, string> };
    own.dependencies = { ...own.dependencies, [manifest.name]: spec };
    await fs.writeFile(prefixFile, JSON.stringify(own));
    return { name: manifest.name, version: manifest.version };
  };
  return {
    calls,
    removed,
    links,
    install: async (root: string, source: string) => {
      calls.push(source);
      const files = links.get(source);
      if (files === undefined) throw new PluginInstallError(`404 Not Found - GET ${source}`);
      return place(root, files, source);
    },
    installFiles: async (root: string, files: Record<string, Uint8Array>) => {
      calls.push("<zip>");
      return place(root, files, "file:archives/upload.tgz");
    },
    remove: async (root: string, name: string) => {
      removed.push(name);
      const prefixFile = path.join(root, "plugins", "package.json");
      const own = JSON.parse(await fs.readFile(prefixFile, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      delete own.dependencies?.[name];
      await fs.writeFile(prefixFile, JSON.stringify(own));
      await fs.rm(path.join(root, "plugins", "node_modules", ...name.split("/")), {
        recursive: true,
        force: true,
      });
    },
  };
}

describe("plugin import and export", () => {
  let t: TestApp;
  let npm: ReturnType<typeof fakeNpm>;
  const apps: TestApp[] = [];

  const boot = async () => {
    npm = fakeNpm();
    t = await createTestApp({ pluginPackages: npm });
    apps.push(t);
    return apiClient(t.app, (await loginAdmin(t.app)).cookie);
  };

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.cleanup();
  });

  const importZip = (client: ReturnType<typeof apiClient>, files: Files, overwrite?: boolean) =>
    client.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: zip(files),
      ...(overwrite === undefined ? {} : { overwrite }),
    });
  const library = async (client: ReturnType<typeof apiClient>) =>
    ((await (await client.get("/api/plugins")).json()) as PluginLibraryResponse).groups.flatMap(
      (g) => g.plugins,
    );
  const projectConfig = () =>
    fs.readFile(path.join(t.root, "default_project", ".project_config.toml"), "utf8");

  it("installs a plugin of Skills from an admin's zip into the library, listed in no Project", async () => {
    const admin = await boot();
    const res = await importZip(admin, notesPackage());
    expect(res.status).toBe(201);
    const body = (await res.json()) as InstalledPluginsResponse;
    expect(body.installed).toMatchObject({
      name: "@acme/notes",
      version: "1.0.0",
      library: true,
      modules: false,
    });
    expect(body.plugins).toEqual([]);
    expect(await projectConfig()).not.toContain("@acme/notes");

    const notes = (await library(admin)).find((p) => p.name === "notes");
    expect(notes).toMatchObject({ package: "@acme/notes", source: "installed", version: "1.0.0" });
    expect(notes?.skills.map((s) => s.name)).toEqual(["notes"]);
  });

  it("lists a package of server modules from a zip for this machine alone", async () => {
    const admin = await boot();
    const res = await importZip(admin, await modulePackage());
    expect(res.status).toBe(201);
    const body = (await res.json()) as InstalledPluginsResponse;
    expect(body.installed).toMatchObject({ name: "@acme/sandbox-x", modules: true });
    expect(body.plugins).toEqual([
      expect.objectContaining({
        specifier: "@acme/sandbox-x",
        everywhere: false,
        machines: [body.machineId],
        here: true,
      }),
    ]);
    expect(await projectConfig()).toContain(`[plugins.${body.machineId}]\n"@acme/sandbox-x"`);
    // The registry lists it from its own package — its npm fields, then its `penguin` block — so
    // its card and its export have a row.
    const index = (await (await admin.get("/api/plugins/registry")).json()) as PluginIndexResponse;
    expect(index.plugins.find((e) => e.name === "@acme/sandbox-x")).toMatchObject({
      version: "0.3.0",
      description: "A sandbox.",
      shortDescription: "Sandbox X.",
    });
  });

  it("installs a zip of Skills whose package.json carries only a name and a version, and lists it with nothing invented", async () => {
    const admin = await boot();
    const res = await importZip(admin, {
      "package.json": JSON.stringify({ name: "bare-skills", version: "0.1.0" }),
      // Ported as it was found: no dated version on the skill, which reads as unversioned.
      "skills/bare/SKILL.md": "---\nname: bare\ndescription: Do bare things.\n---\n\nBody.\n",
    });
    expect(res.status).toBe(201);
    const groups = ((await (await admin.get("/api/plugins")).json()) as PluginLibraryResponse)
      .groups;
    const bare = groups
      .find((g) => g.id === "other")
      ?.plugins.find((p) => p.name === "bare-skills");
    expect(bare).toMatchObject({ description: "", version: "0.1.0", source: "installed" });
    for (const key of ["title", "shortDescription", "icon", "quickStart", "author", "license"]) {
      expect(bare, key).not.toHaveProperty(key);
    }
    expect(bare?.skills).toEqual([
      expect.objectContaining({ name: "bare", description: "Do bare things.", version: "" }),
    ]);
  });

  it("refuses a member every install path, and installs for the local API token an Agent's CLI carries", async () => {
    await boot();
    const member = apiClient(t.app, (await provisionUser(t.app, "member1")).cookie);
    for (const res of [
      await importZip(member, notesPackage()),
      await member.post("/api/projects/default_project/plugins/installed", {
        specifier: "https://github.com/acme/notes",
      }),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "admin_required" } });
    }
    expect(npm.calls).toEqual([]);

    npm.links.set("github:acme/notes", notesPackage());
    const agent = tokenClient(t.app, t.deps.authService.localApiToken()!);
    const res = await agent.post("/api/projects/default_project/plugins/installed", {
      specifier: "github:acme/notes",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as InstalledPluginsResponse).installed).toMatchObject({
      name: "@acme/notes",
      library: true,
    });
  });

  it("asks before replacing another installed version, and leaves the same version as it is", async () => {
    const admin = await boot();
    expect((await importZip(admin, notesPackage("1.0.0"))).status).toBe(201);

    const same = await importZip(admin, notesPackage("1.0.0"));
    expect(same.status).toBe(200);
    expect(((await same.json()) as InstalledPluginsResponse).installed).toMatchObject({
      unchanged: true,
    });

    const newer = await importZip(admin, notesPackage("1.1.0"));
    expect(newer.status).toBe(409);
    // The dialog builds its question from this message's tail.
    expect(await newer.json()).toMatchObject({
      error: {
        code: "plugin_exists",
        message: "Plugin @acme/notes is installed at 1.0.0; the zip holds 1.1.0.",
      },
    });
    expect((await importZip(admin, notesPackage("1.1.0"), true)).status).toBe(201);
    expect((await library(admin)).find((p) => p.name === "notes")?.version).toBe("1.1.0");
    expect(npm.calls).toEqual(["<zip>", "<zip>"]);
  });

  it("refuses a malicious or malformed zip before anything is installed", async () => {
    const admin = await boot();
    const refused = async (files: Files, status: number, code: string, why: RegExp) => {
      const res = await importZip(admin, files);
      expect(res.status, why.source).toBe(status);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code, why.source).toBe(code);
      expect(body.error.message).toMatch(why);
    };
    await refused(
      { ...notesPackage(), "../evil.js": "boom" },
      400,
      "plugin_archive_invalid",
      /traversal/,
    );
    await refused(
      { ...notesPackage(), "/etc/evil": "boom" },
      400,
      "plugin_archive_invalid",
      /absolute/,
    );
    await refused(
      { ...notesPackage(), "node_modules/dep/index.js": "boom" },
      400,
      "plugin_archive_invalid",
      /node_modules/,
    );
    await refused(
      { ...notesPackage(), ".npmrc": "ignore-scripts=false\n" },
      400,
      "plugin_archive_invalid",
      /\.npmrc/,
    );
    await refused(
      { "a/package.json": "{}", "b/README.md": "# B\n" },
      400,
      "plugin_archive_invalid",
      /package\.json at its root/,
    );
    await refused(
      { ...notesPackage(), "package.json": JSON.stringify({ name: "../evil", version: "1.0.0" }) },
      400,
      "plugin_archive_invalid",
      /valid npm name/,
    );
    await refused(
      {
        ...notesPackage(),
        "package.json": JSON.stringify({ name: "@acme/notes", version: "latest" }),
      },
      400,
      "plugin_archive_invalid",
      /release version/,
    );
    await refused(
      { "package.json": JSON.stringify({ name: "left-pad", version: "1.0.0" }), "index.js": "" },
      400,
      "plugin_archive_invalid",
      /Not a PenguinHarness plugin/,
    );
    await refused(
      { ...notesPackage(), "skills/notes/SKILL.md": "No frontmatter at all.\n" },
      400,
      "plugin_archive_invalid",
      /skills[/\\]notes[/\\]SKILL\.md has no frontmatter with a name/,
    );
    // Past the caps, read from the central directory: 2001 files, or one declared past 5MB.
    const many: Files = { ...notesPackage() };
    for (let i = 0; i < 2001; i += 1) many[`skills/notes/reference/${i}.md`] = "x";
    await refused(many, 413, "plugin_too_large", /archive limits/);
    await refused(
      { ...notesPackage(), "big.bin": new Uint8Array(5 * 1024 * 1024 + 1) },
      413,
      "plugin_too_large",
      /archive limits/,
    );
    expect(npm.calls).toEqual([]);
  });

  it("never lets a package replace a module the build ships, nor keeps a link that is no plugin", async () => {
    const admin = await boot();
    // A module the build ships: in the installation's plugins/ prefix, which the program's
    // entry points into for the length of the test.
    const programEntry = process.argv[1];
    const prefix = path.join(t.root, "install", "plugins");
    process.argv[1] = path.join(t.root, "install", "bin", "server.js");
    try {
      await fs.mkdir(prefix, { recursive: true });
      await fs.writeFile(
        path.join(prefix, "package.json"),
        JSON.stringify({
          name: "prefix",
          private: true,
          dependencies: { "@acme/sandbox-x": "1.0.0" },
        }),
      );
      await writeClassPackage(path.join(prefix, "node_modules", "@acme", "sandbox-x"), {
        name: "@acme/sandbox-x",
        module: "ShippedX",
      });
      const impostor = await modulePackage();

      // A zip under its name is refused before anything installs.
      const zipped = await importZip(admin, impostor);
      expect(zipped.status).toBe(409);
      expect(await zipped.json()).toMatchObject({ error: { code: "plugin_shipped" } });
      expect(npm.calls).toEqual([]);

      // A link names its package only once npm has fetched it: it is taken back out.
      npm.links.set("https://github.com/evil/sandbox-x", impostor);
      const linked = await admin.post("/api/projects/default_project/plugins/installed", {
        specifier: "https://github.com/evil/sandbox-x",
      });
      expect(linked.status).toBe(409);
      const shipped = (await linked.json()) as { error: { code: string; message: string } };
      expect(shipped.error.code).toBe("plugin_shipped");
      expect(shipped.error.message).toMatch(/install scripts had already run/);
      expect(npm.removed).toEqual(["@acme/sandbox-x"]);
    } finally {
      if (programEntry !== undefined) process.argv[1] = programEntry;
    }

    // A link to a package that is no plugin is taken back too, and says what already happened.
    npm.links.set("https://example.com/left-pad-1.0.0.tgz", {
      "package.json": JSON.stringify({ name: "left-pad", version: "1.0.0" }),
      "index.js": "export {};\n",
    });
    const res = await admin.post("/api/projects/default_project/plugins/installed", {
      specifier: "https://example.com/left-pad-1.0.0.tgz",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("not_a_plugin");
    expect(body.error.message).toMatch(/install scripts had already run/);
    expect(npm.removed).toEqual(["@acme/sandbox-x", "left-pad"]);
    expect(await projectConfig()).not.toContain("left-pad");
  });

  it("installs a registry name or an https link, and refuses anything else before npm runs", async () => {
    const admin = await boot();
    const post = (specifier: string, machineId?: string) =>
      admin.post("/api/projects/default_project/plugins/installed", {
        specifier,
        ...(machineId === undefined ? {} : { machineId }),
      });
    for (const bad of [
      "",
      "Has Spaces",
      "../evil",
      "/srv/plugin",
      "file:../plugin",
      "foo@file:x.tgz",
      "foo@npm:bar",
      "http://example.com/x.tgz",
      "git+ssh://git@github.com/acme/notes.git",
      "https://user:secret@example.com/x.tgz",
      // A folder or a file inside a repository: npm installs a whole repository or nothing.
      "https://github.com/acme/plugins/tree/main/plugins/notes",
      "https://github.com/acme/plugins/blob/main/plugins/notes/README.md",
    ]) {
      const res = await post(bad);
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "bad_request" } });
    }
    const folder = await post("https://github.com/acme/plugins/tree/main/plugins/notes");
    expect(((await folder.json()) as { error: { message: string } }).error.message).toContain(
      "a folder or a file inside a repository",
    );
    expect(npm.calls).toEqual([]);

    for (const good of [
      "@acme/notes@^1.0.0",
      "https://github.com/acme/notes",
      "git+https://github.com/acme/notes.git",
      "github:acme/notes#v1.0.0",
      "https://example.com/notes-1.0.0.tgz",
    ]) {
      npm.links.set(good, notesPackage());
      expect((await post(good)).status, good).toBe(200);
    }
    expect(npm.calls).toHaveLength(5);
    // A link installs here only: another machine handed it would install whatever its own npm
    // resolves the package's name to.
    expect((await post("https://github.com/acme/notes", "Other00000000000")).status).toBe(400);
  });

  it("exports a plugin as a zip that imports back as it was", async () => {
    const admin = await boot();
    await importZip(admin, notesPackage("1.2.0"));
    const res = await admin.get("/api/plugins/notes/archive");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''notes-v1.2.0.zip",
    );
    const exported = new Uint8Array(await res.arrayBuffer());
    expect(Object.keys(unzipSync(exported)).sort()).toEqual([
      "notes/icon.svg",
      "notes/package.json",
      "notes/skills/notes/SKILL.md",
    ]);

    // Another server takes it as it is.
    const other = await boot();
    const back = await other.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: Buffer.from(exported).toString("base64"),
    });
    expect(back.status).toBe(201);
    expect((await library(other)).find((p) => p.name === "notes")).toMatchObject({
      package: "@acme/notes",
      version: "1.2.0",
      source: "installed",
    });

    // A shipped plugin exports the same way, its package as the build has it.
    const shipped = await other.get("/api/plugins/a2ui/archive");
    expect(shipped.status).toBe(200);
    expect(shipped.headers.get("content-disposition")).toMatch(
      /filename\*=UTF-8''a2ui-v\d+\.\d+\.\d+\.zip/,
    );
    expect(Object.keys(unzipSync(new Uint8Array(await shipped.arrayBuffer())))).toContain(
      "a2ui/skills/a2ui/SKILL.md",
    );
    expect((await other.get("/api/plugins/nothing-here/archive")).status).toBe(404);
  });

  it("exports a listed server module on this server, and answers for nothing else", async () => {
    const admin = await boot();
    await importZip(admin, await modulePackage());
    const res = await admin.get("/api/plugins/registry/archive?name=%40acme%2Fsandbox-x");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''sandbox-x-v0.3.0.zip",
    );
    expect(Object.keys(unzipSync(new Uint8Array(await res.arrayBuffer())))).toContain(
      "sandbox-x/ifaces.json",
    );
    for (const name of ["@acme/unlisted", "../../..", "%2E%2E%2F%2E%2E"]) {
      expect(
        (await admin.get(`/api/plugins/registry/archive?name=${encodeURIComponent(name)}`)).status,
        name,
      ).toBe(404);
    }
  });
});

describe("npm, through the installer itself", () => {
  let real: string | null = null;
  const saved = new Map<string, string | undefined>();

  afterEach(async () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
    if (real !== null) {
      await fs.rm(`${real}-link`, { force: true });
      await fs.rm(real, { recursive: true, force: true });
    }
    real = null;
  });

  // Windows is left out: Node refuses to spawn npm.cmd without a shell there, so this path is
  // the POSIX one.
  it.skipIf(process.platform === "win32")(
    "packs an uploaded package without its scripts, installs the tarball and keeps it where the prefix records it",
    { timeout: 120_000 },
    async () => {
      // The data root is reached through a symlink, as macOS's temp directory is: what npm
      // records must not depend on the path's spelling.
      real = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-npm-wire-"));
      const root = `${real}-link`;
      await fs.symlink(real, root, "dir");
      // A package without dependencies needs no registry: offline, with a cache of its own.
      for (const [key, value] of [
        ["npm_config_offline", "true"],
        ["npm_config_cache", path.join(root, ".npm-cache")],
        ["npm_config_update_notifier", "false"],
      ] as const) {
        saved.set(key, process.env[key]);
        process.env[key] = value;
      }
      // A pack-time script that would leave a mark outside the package, were it run.
      const marker = path.join(root, "prepack-ran");
      const files = new Map(
        Object.entries({
          ...notesPackage("2.0.0"),
          "package.json": JSON.stringify({
            name: "@acme/notes",
            version: "2.0.0",
            scripts: { prepack: "node mark.js" },
          }),
          "mark.js": `require("fs").writeFileSync(${JSON.stringify(marker)}, "");\n`,
        }).map(([k, v]) => [k, bytes(v)] as const),
      );
      const installed = await installPluginFiles(root, files);
      expect(installed).toEqual({ name: "@acme/notes", version: "2.0.0" });

      const prefix = path.join(root, "plugins");
      const recorded = JSON.parse(await fs.readFile(path.join(prefix, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
      };
      expect(recorded.dependencies["@acme/notes"]).toMatch(
        /^file:archives\/acme-notes-2\.0\.0\.tgz$/,
      );
      expect(existsSync(path.join(prefix, "archives", "acme-notes-2.0.0.tgz"))).toBe(true);
      expect(
        existsSync(
          path.join(prefix, "node_modules", "@acme", "notes", "skills", "notes", "SKILL.md"),
        ),
      ).toBe(true);
      expect(await fs.readdir(path.join(prefix, ".staging"))).toEqual([]);
      expect(existsSync(marker)).toBe(false);
      // What npm can say about the prefix agrees: the package is installed at its version.
      const listed = execFileSync("npm", ["ls", "--json"], { cwd: prefix, encoding: "utf8" });
      expect(JSON.parse(listed)).toMatchObject({
        dependencies: { "@acme/notes": { version: "2.0.0" } },
      });
    },
  );
});
