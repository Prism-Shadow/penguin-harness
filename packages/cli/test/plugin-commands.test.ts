/**
 * `penguin plugin`, driven through `cli()` in-process against the fake server:
 *
 * - `install` asks the Project's server to install the specifier, with the local API token,
 *   and says what landed — a plugin of Skills goes to the library, server modules are loaded.
 * - The server's refusal reaches the caller as it said it, with a failing exit code.
 * - `remove` drops the plugin; `list` shows the server modules the Project lists, with their
 *   state, and the packages of Skills or hooks installed on the server.
 */
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
