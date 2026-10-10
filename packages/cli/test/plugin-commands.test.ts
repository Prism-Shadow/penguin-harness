/**
 * `penguin plugin`, driven through `cli()` in-process against the fake server:
 *
 * - `install` asks the Project's server to install the specifier, with the local API token,
 *   and says what landed — a plugin of Skills goes to the library, server modules are loaded.
 * - The server's refusal reaches the caller as it said it, with a failing exit code.
 * - `remove` drops the plugin; `list` shows the server modules the Project lists, with their
 *   state, and the packages of Skills or hooks installed on the server.
 * - A local package directory is read with the plugin library's reader, zipped under one
 *   top-level directory without node_modules or .git, and posted to the zip route.
 * - A directory the library would refuse, one that is no plugin at all, or one past the server's
 *   caps is reported and nothing is posted.
 * - Another version on the server answers 409: the CLI says how to replace it, and
 *   `--overwrite` sends the same package again with `overwrite`.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");

let server: FakeServer;
let uninstall: () => void;
let stdout: string[];
let stderr: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };

beforeEach(() => {
  server = new FakeServer();
  uninstall = server.install();
  stdout = [];
  stderr = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  uninstall();
});

const out = () => stdout.join("");

describe("penguin plugin install", () => {
  it("installs the specifier in the Project and says a plugin of Skills went to the library", async () => {
    server.plugins.install = () => ({
      body: { installed: { name: "@acme/notes", version: "1.0.0", library: true, modules: false } },
    });
    const code = await cli([
      "plugin",
      "install",
      "https://github.com/acme/notes",
      "--project-id",
      "proj-1",
    ]);
    expect(code).toBe(0);
    const post = server.requests.find((r) => r.method === "POST");
    expect(post).toMatchObject({
      path: "/api/projects/proj-1/plugins/installed",
      body: { specifier: "https://github.com/acme/notes" },
    });
    expect(out()).toContain(t.plugin.installed("@acme/notes", "1.0.0"));
    expect(out()).toContain(t.plugin.libraryNext());
  });

  it("says a plugin of server modules was loaded for the Project", async () => {
    server.plugins.install = () => ({
      body: {
        installed: { name: "@acme/sandbox-x", version: "0.3.0", library: false, modules: true },
      },
    });
    expect(await cli(["plugin", "install", "@acme/sandbox-x"])).toBe(0);
    // Without --project-id the default Project's server is asked.
    expect(server.requests.find((r) => r.method === "POST")?.path).toBe(
      "/api/projects/default_project/plugins/installed",
    );
    expect(out()).toContain(t.plugin.modulesLoaded("default_project"));
  });

  it("hands the server's refusal back with a failing exit code", async () => {
    server.plugins.install = () => ({
      status: 403,
      body: {
        error: { code: "admin_required", message: "Only an admin can perform this operation." },
      },
    });
    expect(await cli(["plugin", "install", "@acme/notes"])).not.toBe(0);
    expect(stderr.join("")).toContain("Only an admin can perform this operation.");
  });
});

describe("penguin plugin install <directory>", () => {
  let work: string | null = null;
  afterEach(async () => {
    if (work !== null) await fs.rm(work, { recursive: true, force: true });
    work = null;
  });

  /** A package directory holding `files` (paths relative to it); answers its path. */
  async function packageDir(files: Record<string, string>): Promise<string> {
    work = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cli-plugin-"));
    const dir = path.join(work, "notes-port");
    for (const [rel, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), text);
    }
    return dir;
  }

  const NOTES = {
    "package.json": JSON.stringify({
      name: "@acme/notes",
      version: "1.0.0",
      description: "Take notes.",
      penguin: { short_description: "Notes.", category: "office-productivity" },
    }),
    "skills/notes/SKILL.md":
      "---\nname: notes\ndescription: Take notes.\nversion: 2026.10.10.1\n---\n\nBody.\n",
    "node_modules/left-pad/index.js": "module.exports = 1;\n",
    ".git/HEAD": "ref: refs/heads/main\n",
  };

  /** The files of the zip the last archive request carried. */
  const uploaded = () => {
    const post = server.requests.find((r) => r.path.endsWith("/plugins/installed/archive"));
    const zip = Buffer.from(String(post?.body?.dataBase64), "base64");
    return Object.keys(unzipSync(new Uint8Array(zip))).sort();
  };

  it("reads the package, zips it under one directory without node_modules or .git, and posts it to the zip route", async () => {
    const dir = await packageDir(NOTES);
    expect(await cli(["plugin", "install", dir, "--project-id", "proj-1"])).toBe(0);
    const post = server.requests.find((r) => r.method === "POST");
    expect(post?.path).toBe("/api/projects/proj-1/plugins/installed/archive");
    expect(post?.body).not.toHaveProperty("overwrite");
    expect(uploaded()).toEqual(["notes/package.json", "notes/skills/notes/SKILL.md"]);
    const zip = unzipSync(new Uint8Array(Buffer.from(String(post?.body?.dataBase64), "base64")));
    expect(JSON.parse(strFromU8(zip["notes/package.json"]!))).toMatchObject({
      name: "@acme/notes",
    });
    expect(out()).toContain(t.plugin.installed("@acme/notes", "1.0.0"));
    expect(out()).toContain(t.plugin.libraryNext());
  });

  it("reports a directory the library would refuse, or one that is no plugin, and posts nothing", async () => {
    const noVersion = await packageDir({
      ...NOTES,
      "package.json": JSON.stringify({ name: "@acme/notes", description: "Take notes." }),
    });
    expect(await cli(["plugin", "install", noVersion])).not.toBe(0);
    expect(stderr.join("")).toContain("no release version");
    await fs.rm(work!, { recursive: true, force: true });

    const empty = await packageDir({
      "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
    });
    expect(await cli(["plugin", "install", empty])).not.toBe(0);
    expect(stderr.join("")).toContain(t.plugin.dirNotPlugin(empty));
    expect(server.requests.filter((r) => r.method === "POST")).toEqual([]);
  });

  it("reports a directory past the server's caps, and posts nothing", async () => {
    const dir = await packageDir(NOTES);
    // One file over the 5 MB a package file may weigh, sized without writing it (sparse).
    const big = path.join(dir, "assets.bin");
    await fs.writeFile(big, "");
    await fs.truncate(big, 6 * 1024 * 1024);
    expect(await cli(["plugin", "install", dir])).not.toBe(0);
    expect(stderr.join("")).toContain(t.plugin.dirTooLarge(dir));
    expect(server.requests.filter((r) => r.method === "POST")).toEqual([]);
  });

  it("says how to replace another version on the server, and --overwrite sends it again with overwrite", async () => {
    server.plugins.archive = (body) =>
      body.overwrite === true
        ? {
            status: 201,
            body: {
              installed: { name: "@acme/notes", version: "1.0.0", library: true, modules: false },
            },
          }
        : {
            status: 409,
            body: {
              error: {
                code: "plugin_exists",
                message: "Plugin @acme/notes is installed at 0.9.0; the zip holds 1.0.0.",
              },
            },
          };
    const dir = await packageDir(NOTES);
    expect(await cli(["plugin", "install", dir])).not.toBe(0);
    expect(stderr.join("")).toContain("is installed at 0.9.0");
    expect(stderr.join("")).toContain(t.plugin.overwriteHint());

    expect(await cli(["plugin", "install", dir, "--overwrite"])).toBe(0);
    const posts = server.requests.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.body?.overwrite)).toEqual([undefined, true]);
    expect(out()).toContain(t.plugin.installed("@acme/notes", "1.0.0"));
  });
});

describe("penguin plugin remove and list", () => {
  it("removes a plugin by name, and lists what remains with its state", async () => {
    server.plugins.listed = [
      { specifier: "@acme/sandbox-x", active: true, builtin: false, modules: [], replaces: [] },
      {
        specifier: "@acme/broken",
        active: false,
        builtin: false,
        modules: [],
        replaces: [],
        error: "entry missing",
      },
    ];
    server.plugins.library = [
      { name: "notes", package: "@acme/notes", version: "1.0.0", source: "installed" },
      { name: "a2ui", package: "@penguinharness/a2ui", version: "0.2.13", source: "builtin" },
    ];
    expect(await cli(["plugin", "remove", "@acme/broken"])).toBe(0);
    expect(server.requests.find((r) => r.method === "DELETE")).toMatchObject({
      path: "/api/projects/default_project/plugins/installed",
      search: "?specifier=%40acme%2Fbroken",
    });
    expect(out()).toContain(t.plugin.removed("@acme/broken"));

    stdout.length = 0;
    expect(await cli(["plugin", "list"])).toBe(0);
    const lines = out().split("\n");
    expect(lines.find((l) => l.includes("@acme/sandbox-x"))).toContain(t.plugin.active());
    expect(lines.find((l) => l.includes("@acme/notes"))).toContain(t.plugin.kindLibrary());
    // A built-in plugin is the build's, not installed on the server: it is not listed.
    expect(out()).not.toContain("@acme/broken");
    expect(out()).not.toContain("@penguinharness/a2ui");
  });
});
