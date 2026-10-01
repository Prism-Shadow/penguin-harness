/**
 * The plugin registry: the catalogue a Project's plugin list is picked from.
 *
 * - The shared index format is validated whole: a flat array of per-version entries in order;
 *   a non-array or one malformed entry fails the document, naming the source or the position
 *   (unlike a plugin list's per-entry tolerance).
 * - The builtin catalogue lists the sandbox backends that live in plugins/, each named,
 *   versioned, described and licensed as the package names itself, and serves each one's own
 *   shipped README.md; a listed package not on this machine, a name it does not list and a
 *   remote registry have no readme.
 * - The HTTP registry fetches its index URL and runs the document through the same validator;
 *   an HTTP error, non-JSON and a malformed document fail it. No network: fetch is the suite's
 *   fetch fake.
 * - GET /api/plugins/registry and its readme route need a session; the readme route refuses a
 *   name the deployment does not list and needs the name.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PluginIndexEntry, PluginIndexResponse } from "../src/api/types.js";
import type { PluginBase } from "../src/plugin/loader.js";
import {
  builtinPluginRegistry,
  httpPluginRegistry,
  parsePluginIndex,
} from "../src/plugin/registry.js";
import { fakeFetch, jsonResponse } from "./fixtures/fetch.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const VALID_ENTRY: PluginIndexEntry = {
  name: "@example/penguin-plugin-demo",
  version: "1.0.0",
  description: "A demo plugin.",
  authors: ["Example"],
  license: "MIT",
};

describe("parsePluginIndex", () => {
  it("accepts a flat array of per-version entries and preserves order", () => {
    const doc = [
      VALID_ENTRY,
      { ...VALID_ENTRY, version: "1.1.0", keywords: ["linux"], updatedAt: 1755600000 },
    ];
    const parsed = parsePluginIndex(doc, "test");
    expect(parsed.map((e) => e.version)).toEqual(["1.0.0", "1.1.0"]);
  });

  it("rejects a non-array document and names the source", () => {
    expect(() => parsePluginIndex({ plugins: [] }, "https://x.example/index.json")).toThrow(
      /https:\/\/x\.example\/index\.json is not an array/,
    );
  });

  it("rejects the whole document on one malformed entry, naming its position", () => {
    for (const bad of [
      null,
      { ...VALID_ENTRY, version: 2 },
      { ...VALID_ENTRY, authors: "Example" },
      { ...VALID_ENTRY, keywords: [1] },
      { ...VALID_ENTRY, updatedAt: "yesterday" },
    ]) {
      expect(() => parsePluginIndex([VALID_ENTRY, bad], "test")).toThrow(
        /malformed entry at index 1/,
      );
    }
  });
});

describe("httpPluginRegistry", () => {
  const url = "https://registry.example/index.json";

  it("fetches the index URL and validates the document with the shared parser", async () => {
    const registry = fakeFetch(() => jsonResponse([VALID_ENTRY]));
    const entries = await httpPluginRegistry(url, registry.fetch).index();
    expect(registry.calls.map((call) => call.url)).toEqual([url]);
    expect(entries).toEqual([VALID_ENTRY]);
  });

  it("fails on an HTTP error status, on non-JSON, and on a malformed document", async () => {
    const respond = (body: string, status = 200) =>
      fakeFetch(() => new Response(body, { status })).fetch;
    await expect(httpPluginRegistry(url, respond("[]", 503)).index()).rejects.toThrow(/HTTP 503/);
    await expect(httpPluginRegistry(url, respond("not json")).index()).rejects.toThrow(
      /not valid JSON/,
    );
    await expect(httpPluginRegistry(url, respond('{"plugins":[]}')).index()).rejects.toThrow(
      /not an array/,
    );
  });
});

/**
 * The index asserts a name, version, description and license for four packages that live
 * beside it in this workspace, and their readmes are those packages' own README.md files.
 * None of that is enforced by anything the packages do, so it is asserted here: the listing
 * is the specifier a Project's list names, and a catalogue that describes
 * its entries wrongly is worse than one that omits them.
 */
const PLUGINS_DIR = fileURLToPath(new URL("../../../plugins/", import.meta.url));

interface PackageManifest {
  name: string;
  version: string;
  description?: string;
  license?: string;
  files?: string[];
}

const packages = new Map<string, { dir: string; manifest: PackageManifest }>();
for (const dir of readdirSync(PLUGINS_DIR)) {
  // A worktree can hold a directory a build left behind; only a real package counts.
  if (!existsSync(`${PLUGINS_DIR}${dir}/package.json`)) continue;
  const manifest = JSON.parse(
    readFileSync(`${PLUGINS_DIR}${dir}/package.json`, "utf8"),
  ) as PackageManifest;
  packages.set(manifest.name, { dir, manifest });
}

/**
 * The packages as npm ships them, staged as a prefix a registry can read from: each listed
 * package's own package.json and README.md under `node_modules/<name>/` — what
 * scripts/build-plugins.mjs installs, minus the code, which a readme lookup never touches.
 */
async function shippedPrefix(
  names: Iterable<string>,
): Promise<{ dir: string; bases: PluginBase[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), "penguin-shipped-"));
  await writeFile(
    path.join(dir, "package.json"),
    '{"name":"penguin-builtin-plugins","private":true}',
  );
  for (const name of names) {
    const pkg = packages.get(name);
    if (pkg === undefined) continue;
    const dest = path.join(dir, "node_modules", ...name.split("/"));
    await mkdir(dest, { recursive: true });
    for (const file of ["package.json", "README.md"]) {
      await cp(path.join(PLUGINS_DIR, pkg.dir, file), path.join(dest, file));
    }
  }
  return { dir, bases: [{ file: path.join(dir, "package.json"), builtin: true }] };
}

describe("plugin readmes", () => {
  /**
   * The detail page's whole content. A listed entry with no readme renders an empty page,
   * which is a gap nobody sees until they click it — so the pairing is pinned here rather
   * than left to whoever adds the next backend.
   */
  it("every builtin entry has one, read from the package on this machine", async () => {
    const index = await builtinPluginRegistry().index();
    const shipped = await shippedPrefix(index.map((e) => e.name));
    try {
      const registry = builtinPluginRegistry(() => shipped.bases);
      for (const entry of index) {
        const readme = await registry.readme(entry.name);
        expect(readme, `${entry.name} has no readme`).not.toBeNull();
        expect(readme).toContain("#");
      }
    } finally {
      await rm(shipped.dir, { recursive: true, force: true });
    }
  });

  it("a listed package that is not on this machine has none, rather than an invented one", async () => {
    const [first] = await builtinPluginRegistry().index();
    expect(await builtinPluginRegistry().readme(first!.name)).toBeNull();
    expect(await builtinPluginRegistry().readme("@someone/not-listed")).toBeNull();
  });

  /**
   * A remote index cannot describe where its readmes live yet, so the HTTP registry
   * answers null instead of guessing a URL and rendering whatever replied.
   */
  it("a remote registry offers none", async () => {
    expect(await httpPluginRegistry("https://example.invalid/index.json").readme("x")).toBeNull();
  });
});

describe("the builtin catalogue and the packages it lists", () => {
  it("lists sandbox backends that live in plugins/, each named as that package names itself", async () => {
    const index = await builtinPluginRegistry().index();
    // Valid under the format every registry is held to.
    expect(parsePluginIndex(index, "builtin")).toEqual(index);
    expect(index.length).toBeGreaterThan(0);
    for (const entry of index) {
      const pkg = packages.get(entry.name);
      expect(pkg, `${entry.name} is listed but is no package in plugins/`).toBeDefined();
      expect(entry.categories, entry.name).toEqual(["sandbox"]);
      expect(pkg!.manifest.version, entry.name).toBe(entry.version);
      expect(pkg!.manifest.description, entry.name).toBe(entry.description);
      expect(pkg!.manifest.license, entry.name).toBe(entry.license);
    }
  });

  it("serves each package's own README.md, which the package ships", async () => {
    const index = await builtinPluginRegistry().index();
    const shipped = await shippedPrefix(index.map((e) => e.name));
    try {
      const registry = builtinPluginRegistry(() => shipped.bases);
      for (const entry of index) {
        const pkg = packages.get(entry.name)!;
        const own = readFileSync(`${PLUGINS_DIR}${pkg.dir}/README.md`, "utf8");
        expect(await registry.readme(entry.name), entry.name).toBe(own);
        expect(pkg.manifest.files, `${entry.name} would publish without its readme`).toContain(
          "README.md",
        );
      }
    } finally {
      await rm(shipped.dir, { recursive: true, force: true });
    }
  });
});

describe("the registry routes", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("requires auth, then serves the builtin index", async () => {
    expect((await t.app.request("/api/plugins/registry")).status).toBe(401);

    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/plugins/registry");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PluginIndexResponse;
    expect(body.plugins).toEqual(await builtinPluginRegistry().index());
  });

  it("requires auth, then serves a listed entry's readme from the package on this machine", async () => {
    const name = "@prismshadow/penguin-plugin-sandbox-bwrap";
    const url = `/api/plugins/registry/readme?name=${encodeURIComponent(name)}`;
    expect((await t.app.request(url)).status).toBe(401);

    // The package as npm installs it into the data root's own prefix — the first base the
    // lookup tries, ahead of the installation's (which, in a checkout, is the workspace).
    const admin = await loginAdmin(t.app);
    const pkg = packages.get(name)!;
    const dest = path.join(t.root, "plugins", "node_modules", ...name.split("/"));
    await mkdir(dest, { recursive: true });
    await writeFile(
      path.join(t.root, "plugins", "package.json"),
      '{"name":"prefix","private":true}',
    );
    for (const file of ["package.json", "README.md"]) {
      await cp(path.join(PLUGINS_DIR, pkg.dir, file), path.join(dest, file));
    }
    const res = await apiClient(t.app, admin.cookie).get(url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; readme: string | null };
    expect(body.name).toBe(name);
    expect(body.readme).toContain("Bubblewrap");
  });

  it("refuses a name the deployment does not list, so it cannot probe for what exists", async () => {
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get(
      "/api/plugins/registry/readme?name=" + encodeURIComponent("@someone/not-listed"),
    );
    expect(res.status).toBe(404);
  });

  it("requires the name", async () => {
    const admin = await loginAdmin(t.app);
    expect((await apiClient(t.app, admin.cookie).get("/api/plugins/registry/readme")).status).toBe(
      400,
    );
  });
});
