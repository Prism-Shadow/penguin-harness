/**
 * The plugin registry: the catalogue a Project's plugin list is picked from.
 *
 * - The shared index format is validated whole: a flat array of per-version entries in order;
 *   a non-array or one malformed entry fails the document, naming the source or the position
 *   (unlike a plugin list's per-entry tolerance). `integrity` is optional, and checked when
 *   present.
 * - The builtin registry serves the index the running build carries; the store registry serves
 *   this machine's plugin store. What the catalogue says about a builtin plugin is what its
 *   package.json says, and each serves its own shipped README.md; a package not on this
 *   machine, a name nothing lists and a remote registry have no readme.
 * - The HTTP registry fetches its index URL and runs the document through the same validator;
 *   an HTTP error, non-JSON and a malformed document fail it; a failed connection is tried
 *   again, an answer is not. No network: fetch is the suite's fetch fake.
 * - The cache and the merge make one flat index of the three: an entry per content, the first
 *   source's kept; a published index may be slow or down without emptying the page.
 * - GET /api/plugins/registry and its readme route need a session; the readme route refuses a
 *   name the deployment does not list and needs the name.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginIndexEntry } from "../src/api/types.js";
import type { PluginBase } from "../src/plugin/loader.js";
import {
  BUILTIN_REGISTRY_SOURCE,
  NIGHTLY_INDEX_URL,
  builtinPluginRegistry,
  cachedRegistry,
  httpPluginRegistry,
  mergeIndexes,
  parsePluginIndex,
  storePluginRegistry,
} from "../src/plugin/registry.js";
import { pickIndexEntry } from "../src/api/plugin-pick.js";
import type { PluginRegistry } from "../src/plugin/registry.js";
import { storePackage } from "../src/plugin/store.js";
import { integrityOf } from "./plugin-fixtures.js";
import { activatePlugins } from "../src/plugin/activation.js";
import { resolveServerConfig } from "../src/config.js";
import { pluginRegistryRoutes } from "../src/http/routes/plugins.js";
import { fakeFetch, jsonResponse } from "./fixtures/fetch.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { manifestOf } from "../../../scripts/plugin-entry.mjs";

const hash = (digit: string) =>
  `sha512-${Buffer.alloc(64, digit.charCodeAt(0)).toString("base64")}`;

const VALID_ENTRY: PluginIndexEntry = {
  name: "@example/penguin-plugin-demo",
  version: "1.0.0",
  description: "A demo plugin.",
  authors: ["Example"],
  license: "MIT",
  integrity: hash("a"),
};

describe("parsePluginIndex", () => {
  it("accepts a flat array of per-version entries and preserves order", () => {
    const doc = [
      VALID_ENTRY,
      {
        ...VALID_ENTRY,
        version: "1.1.0",
        keywords: ["linux"],
        os: ["linux"],
        updatedAt: 1755600000,
      },
    ];
    const parsed = parsePluginIndex(doc, "test");
    expect(parsed.map((e) => e.version)).toEqual(["1.0.0", "1.1.0"]);
    // A present `os` — the platforms the plugin runs on — validates and is carried through.
    expect(parsed[1].os).toEqual(["linux"]);
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
      { ...VALID_ENTRY, os: "linux" },
      { ...VALID_ENTRY, updatedAt: "yesterday" },
      // A present integrity must be a key the store can use.
      { ...VALID_ENTRY, integrity: "sha512-abc" },
      // The sha256 form the store keyed by before npm's integrity: not a key any more.
      { ...VALID_ENTRY, integrity: `sha256-${"a".repeat(64)}` },
      { ...VALID_ENTRY, yanked: "yes" },
    ]) {
      expect(() => parsePluginIndex([VALID_ENTRY, bad], "test")).toThrow(
        /malformed entry at index 1/,
      );
    }
  });
});

/**
 * An installation the way the build leaves one: `plugins/` beside the program, holding the
 * prefix and the `index.json` scripts/build-plugins.mjs rebuilt from its tree. The program's
 * entry (`process.argv[1]`) is pointed into it for the test's duration.
 */
async function installation(at: string, index: unknown): Promise<string> {
  const prefix = path.join(at, "plugins");
  await mkdir(prefix, { recursive: true });
  await writeFile(path.join(prefix, "package.json"), '{"name":"prefix","private":true}');
  await writeFile(path.join(prefix, "index.json"), JSON.stringify(index));
  process.argv[1] = path.join(at, "bin", "server.js");
  return prefix;
}

describe("builtinPluginRegistry", () => {
  const programEntry = process.argv[1];
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "penguin-builtin-"));
  });
  afterEach(async () => {
    if (programEntry !== undefined) process.argv[1] = programEntry;
    await rm(dir, { recursive: true, force: true });
  });

  it("serves a push's index before the installation's, and none for a run from source", async () => {
    await installation(path.join(dir, "install"), [VALID_ENTRY]);
    expect(await builtinPluginRegistry().index()).toEqual([VALID_ENTRY]);
    const assets = path.join(dir, "assets");
    const pushed = { ...VALID_ENTRY, version: "2.0.0", integrity: hash("b") };
    await mkdir(path.join(assets, "plugins"), { recursive: true });
    await writeFile(path.join(assets, "plugins", "index.json"), JSON.stringify([pushed]));
    expect(await builtinPluginRegistry(undefined, () => assets).index()).toEqual([pushed]);
    process.argv[1] = path.join(dir, "nowhere", "bin", "server.js");
    expect(await builtinPluginRegistry().index()).toEqual([]);
  });
});

describe("storePluginRegistry", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "penguin-store-registry-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("serves what this machine's store holds, with each entry's integrity", async () => {
    const root = path.join(dir, "root");
    const prefix = path.join(dir, "prefix");
    await mkdir(path.join(prefix, "node_modules", "@acme", "x"), { recursive: true });
    await writeFile(path.join(prefix, "package.json"), '{"dependencies":{"@acme/x":"1.0.0"}}');
    await writeFile(
      path.join(prefix, "node_modules", "@acme", "x", "package.json"),
      JSON.stringify({ name: "@acme/x", version: "1.0.0", description: "X", license: "MIT" }),
    );
    const stored = [
      await storePackage(
        root,
        path.join(prefix, "node_modules", "@acme", "x"),
        prefix,
        integrityOf("@acme/x", "1.0.0"),
      ),
    ];
    expect(await storePluginRegistry(root).index()).toEqual([
      expect.objectContaining({
        name: "@acme/x",
        version: "1.0.0",
        integrity: stored[0]!.integrity,
      }),
    ]);
  });
});

describe("httpPluginRegistry", () => {
  const url = "https://registry.example/index.json";

  it("fetches the index URL and validates the document with the shared parser", async () => {
    const fake = fakeFetch(() => jsonResponse([VALID_ENTRY]));
    const registry = httpPluginRegistry(url, fake.fetch);
    const entries = await registry.index();
    expect(fake.calls.map((call) => call.url)).toEqual([url]);
    expect(entries).toEqual([VALID_ENTRY]);
  });

  it("tries a failed connection again, and names the last cause after the final attempt", async () => {
    const flaky = fakeFetch((_call, index) => {
      if (index < 2) throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
      return jsonResponse([VALID_ENTRY]);
    });
    const noWait = () => Promise.resolve();
    const entries = await httpPluginRegistry(url, {
      fetchImpl: flaky.fetch,
      delay: noWait,
    }).index();
    expect(entries).toEqual([VALID_ENTRY]);
    expect(flaky.calls).toHaveLength(3);

    const dead = fakeFetch(() => {
      throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
    });
    await expect(
      httpPluginRegistry(url, { fetchImpl: dead.fetch, attempts: 2, delay: noWait }).index(),
    ).rejects.toThrow(/could not be fetched \(2 attempts\): fetch failed \(ECONNRESET\)/);
    expect(dead.calls).toHaveLength(2);
  });

  it("fails, without retrying, on an HTTP error status, on non-JSON, and on a malformed document", async () => {
    const respond = (body: string, status = 200) =>
      fakeFetch(() => new Response(body, { status })).fetch;
    const gone = fakeFetch(() => new Response("[]", { status: 404 }));
    await expect(httpPluginRegistry(url, { fetchImpl: gone.fetch }).index()).rejects.toThrow(
      /HTTP 404/,
    );
    expect(gone.calls).toHaveLength(1);
    await expect(httpPluginRegistry(url, respond("[]", 503)).index()).rejects.toThrow(/HTTP 503/);
    await expect(httpPluginRegistry(url, respond("not json")).index()).rejects.toThrow(
      /not valid JSON/,
    );
    await expect(httpPluginRegistry(url, respond('{"plugins":[]}')).index()).rejects.toThrow(
      /not an array/,
    );
  });
});

describe("GET /api/plugins/registry", () => {
  let t: TestApp;
  const programEntry = process.argv[1];
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    if (programEntry !== undefined) process.argv[1] = programEntry;
    await t.cleanup();
  });

  it("requires auth, then serves the build's index as a flat array", async () => {
    expect((await t.app.request("/api/plugins/registry")).status).toBe(401);

    await installation(path.join(t.root, "install"), [VALID_ENTRY]);
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/plugins/registry");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([VALID_ENTRY]);
  });
});

/**
 * The builtin index is read off the packages it lists: scripts/build-plugins.mjs lays each
 * code package the build ships out as a store entry and writes the entry's manifest from the
 * package's own package.json (scripts/plugin-entry.mjs `manifestOf`). So what the index
 * says about a builtin plugin is whatever its package.json says — asserted here, since a
 * package that drops its description or categories would silently lose them on the page.
 */
const PLUGINS_DIR = fileURLToPath(new URL("../../../plugins/", import.meta.url));

interface PackageManifest {
  name: string;
  version: string;
  description?: string;
  license?: string;
  files?: string[];
  main?: string;
  exports?: unknown;
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
/** The packages build-plugins.mjs packs: those with a code entry. */
const built = [...packages].filter(
  ([, { manifest }]) => manifest.main !== undefined || manifest.exports !== undefined,
);

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

describe("the builtin index and the packages it lists", () => {
  /**
   * The sandbox backends follow the rule the Agent plugins do: `plugins/<dir>` is the npm
   * package `@penguinharness/<dir>`. The release publishes by that name and a Project's
   * `[plugins]` table names it, so a package that drifts from its directory is one nobody can
   * find by either.
   */
  it("names every sandbox backend @penguinharness/<its directory>", () => {
    const sandboxes = [...packages].filter(([, { dir }]) => dir.startsWith("sandbox-"));
    expect(sandboxes).toHaveLength(4);
    for (const [name, { dir }] of sandboxes) {
      expect(name, `plugins/${dir}`).toBe(`@penguinharness/${dir}`);
    }
  });

  it("marks each backend with the platforms it runs on, in process.platform words", () => {
    // The index the build carries is rebuilt from the packages' own package.json, so the
    // mark is whatever the package declares — asserted per backend, since a backend that
    // drops it would install as a plain plugin on a platform it cannot run on.
    const platforms = ["linux", "darwin", "win32"];
    const entryOf = (name: string) => {
      const pkg = packages.get(name);
      if (pkg === undefined) throw new Error(`${name} is not a plugin package`);
      return manifestOf(pkg.manifest as never, name, pkg.manifest.version, hash("c"));
    };
    for (const [name, { manifest }] of built) {
      const entry = manifestOf(manifest as never, name, manifest.version, hash("c"));
      for (const os of entry.os ?? []) expect(platforms, name).toContain(os);
    }
    const osOf = (name: string) => entryOf(name).os;
    expect(osOf("@penguinharness/sandbox-bwrap")).toEqual(["linux"]);
    expect(osOf("@penguinharness/sandbox-seatbelt")).toEqual(["darwin"]);
    expect(osOf("@penguinharness/sandbox-wsl")).toEqual(["win32"]);
    // sandbox-dsh runs everywhere.
    expect(osOf("@penguinharness/sandbox-dsh")).toBeUndefined();
  });

  it("describes every package the build ships from its own package.json", () => {
    expect(built.length).toBeGreaterThan(0);
    for (const [name, { manifest }] of built) {
      const entry = manifestOf(manifest as never, name, manifest.version, hash("c"));
      expect(entry.description, name).not.toBe("");
      expect(entry.authors.length, `${name} names no author`).toBeGreaterThan(0);
      expect(["Apache-2.0", "MIT"], name).toContain(entry.license);
      expect(entry.categories?.length ?? 0, `${name} names no category`).toBeGreaterThan(0);
    }
  });

  it("serves each package's own README.md, which the package ships", async () => {
    const shipped = await shippedPrefix(built.map(([name]) => name));
    try {
      const registry = builtinPluginRegistry(() => shipped.bases);
      for (const [name, pkg] of built) {
        const own = readFileSync(`${PLUGINS_DIR}${pkg.dir}/README.md`, "utf8");
        expect(await registry.readme(name), name).toBe(own);
        expect(pkg.manifest.files, `${name} would publish without its readme`).toContain(
          "README.md",
        );
      }
    } finally {
      await rm(shipped.dir, { recursive: true, force: true });
    }
  });

  it("a package that is not on this machine has no readme, rather than an invented one", async () => {
    expect(await builtinPluginRegistry().readme(built[0]![0])).toBeNull();
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

describe("GET /api/plugins/registry/readme", () => {
  let t: TestApp;
  const programEntry = process.argv[1];
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    if (programEntry !== undefined) process.argv[1] = programEntry;
    await t.cleanup();
  });

  it("requires auth, then serves a listed entry's readme from the package on this machine", async () => {
    const name = "@penguinharness/sandbox-bwrap";
    const url = `/api/plugins/registry/readme?name=${encodeURIComponent(name)}`;
    expect((await t.app.request(url)).status).toBe(401);

    // The package as the build ships it, in the installation's prefix (the one `process.argv[1]`
    // points into) — read for its readme, though nothing is activated from it.
    const admin = await loginAdmin(t.app);
    const pkg = packages.get(name)!;
    const prefix = await installation(path.join(t.root, "install"), [
      { ...VALID_ENTRY, name, version: pkg.manifest.version },
    ]);
    const dest = path.join(prefix, "node_modules", ...name.split("/"));
    await mkdir(dest, { recursive: true });
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

/** A registry whose index() the test drives: counts calls, and can be made to fail. */
function stubRegistry(source: string, entries: PluginIndexEntry[]) {
  const state = { calls: 0, fail: null as string | null };
  const registry: PluginRegistry = {
    source,
    index: () => {
      state.calls += 1;
      return state.fail === null ? Promise.resolve(entries) : Promise.reject(new Error(state.fail));
    },
    readme: () => Promise.resolve(null),
  };
  return { registry, state };
}

describe("cachedRegistry", () => {
  it("fetches once per TTL, one fetch for concurrent callers, and again after it lapses", async () => {
    const { registry, state } = stubRegistry("remote", [VALID_ENTRY]);
    let clock = 1_000;
    const cached = cachedRegistry(registry, { ttlMs: 60_000, now: () => clock });
    // Four tabs opening the page at once must be one request, not four.
    await Promise.all([cached.index(), cached.index(), cached.index(), cached.index()]);
    clock += 59_999;
    await cached.index();
    expect(state.calls).toBe(1);
    clock += 2;
    await cached.index();
    expect(state.calls).toBe(2);
  });

  it("serves the last good document when a refresh fails, and fails when it never had one", async () => {
    const { registry, state } = stubRegistry("remote", [VALID_ENTRY]);
    state.fail = "network down";
    let clock = 0;
    const cached = cachedRegistry(registry, { ttlMs: 10, now: () => clock });
    await expect(cached.index()).rejects.toThrow(/network down/);
    // The failed attempt is not cached as a good one.
    state.fail = null;
    expect(await cached.index()).toHaveLength(1);
    clock += 100;
    state.fail = "network down";
    // Stale beats empty: the page's job is to show what exists.
    expect(await cached.index()).toEqual([VALID_ENTRY]);
  });

  it("starts from a parked document and hands it back for parking", async () => {
    const { registry, state } = stubRegistry("remote", []);
    state.fail = "network down";
    const seed = { at: 0, entries: [VALID_ENTRY] };
    let clock = 5;
    const cached = cachedRegistry(registry, { ttlMs: 10, now: () => clock, seed });
    // Within the TTL the seed is served without a fetch; past it a failed refresh falls back to it.
    expect(await cached.index()).toEqual([VALID_ENTRY]);
    expect(state.calls).toBe(0);
    clock = 100;
    expect(await cached.index()).toEqual([VALID_ENTRY]);
    expect(state.calls).toBe(1);
    expect(cached.snapshot()).toEqual(seed);
  });
});

describe("mergeIndexes", () => {
  it("keeps one entry per content, the first source's, and leaves a yanked one out", async () => {
    const mine = { ...VALID_ENTRY, description: "the shipped one" };
    const theirs = { ...VALID_ENTRY, description: "the published one" };
    const other = { ...VALID_ENTRY, integrity: hash("b") };
    const yanked = { ...VALID_ENTRY, version: "0.9.0", yanked: true };
    const entries = await mergeIndexes([
      stubRegistry("builtin", [mine]).registry,
      stubRegistry("remote", [theirs, other, yanked]).registry,
    ]);
    expect(entries).toEqual([mine, other]);
  });

  it("keeps the other sources when one fails, and logs the one that did", async () => {
    const remote = stubRegistry("remote", [{ ...VALID_ENTRY, name: "@example/remote" }]);
    remote.state.fail = "index answered HTTP 503";
    const logged: string[] = [];
    const entries = await mergeIndexes(
      [stubRegistry("builtin", [VALID_ENTRY]).registry, remote.registry],
      (line) => logged.push(line),
    );
    expect(entries).toEqual([VALID_ENTRY]);
    expect(logged).toEqual([expect.stringContaining("remote: index answered HTTP 503")]);
  });
});

describe("pickIndexEntry", () => {
  const entry = (version: string, digit: string | null): PluginIndexEntry => ({
    ...VALID_ENTRY,
    version,
    ...(digit === null ? { integrity: undefined } : { integrity: hash(digit) }),
  });

  it("takes a pin, else the highest version the ask admits, the earlier source within one", () => {
    const entries = [
      entry("1.0.0", "1"),
      entry("1.2.0", "3"),
      entry("1.2.0", "2"),
      entry("2.0.0", null),
    ];
    expect(pickIndexEntry(entries, VALID_ENTRY.name, {})).toBe(entries[1]);
    expect(pickIndexEntry(entries, VALID_ENTRY.name, { integrity: hash("1") })).toBe(entries[0]);
  });

  it("refuses what it cannot take, and says why", () => {
    const entries = [entry("1.0.0", "1"), entry("2.0.0", null)];
    expect(pickIndexEntry([], "@x/y", {})).toEqual({
      refused: expect.stringMatching(/none of the plugin index's sources/),
    });
    expect(pickIndexEntry(entries, VALID_ENTRY.name, { version: "^3" })).toEqual({
      refused: expect.stringMatching(/satisfies \^3 \(listed: 1\.0\.0, 2\.0\.0\)/),
    });
    expect(pickIndexEntry(entries, VALID_ENTRY.name, { version: "2.0.0" })).toEqual({
      refused: expect.stringMatching(/listed without an integrity/),
    });
  });
});

describe("the published index source", () => {
  it("is a release asset on a fixed tag; PENGUIN_PLUGIN_INDEX unset reads it, off reads none, a URL replaces it", () => {
    // The tag is never re-pointed — a six-hourly workflow replaces the ASSET — so "latest
    // nightly" is resolved by name and costs no unauthenticated API budget.
    expect(NIGHTLY_INDEX_URL).toBe(
      "https://github.com/Prism-Shadow/penguin-extensions/releases/download/nightly/index.json",
    );
    const at = (value: string | undefined) =>
      resolveServerConfig({ ...(value === undefined ? {} : { PENGUIN_PLUGIN_INDEX: value }) })
        .pluginIndexUrl;
    expect(at(undefined)).toBe(NIGHTLY_INDEX_URL);
    expect(at("")).toBe(NIGHTLY_INDEX_URL);
    expect(at("off")).toBeNull();
    expect(at("OFF")).toBeNull();
    expect(at("https://example.invalid/index.json")).toBe("https://example.invalid/index.json");
  });
});

describe("the route's own merge", () => {
  // Called directly rather than through the App: the auth gate is app.ts's and is covered
  // above, and what these assert is which sources reach the response body.
  it("merges the published entries in behind the builtin ones", async () => {
    const published = { ...VALID_ENTRY, name: "@example/penguin-plugin-published" };
    const routes = pluginRegistryRoutes({
      registries: [
        stubRegistry("builtin", [VALID_ENTRY]).registry,
        stubRegistry("published", [published]).registry,
      ],
    });
    expect(await (await routes.request("/")).json()).toEqual([VALID_ENTRY, published]);
  });

  it("lists every content under one name, and which this machine stores and runs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "penguin-registry-contents-"));
    try {
      const root = path.join(dir, "root");
      const prefix = path.join(dir, "prefix");
      const pkg = path.join(prefix, "node_modules", "@acme", "x");
      await mkdir(pkg, { recursive: true });
      await writeFile(path.join(prefix, "package.json"), '{"dependencies":{"@acme/x":"1.0.0"}}');
      await writeFile(
        path.join(pkg, "package.json"),
        JSON.stringify({ name: "@acme/x", version: "1.0.0", description: "X", license: "MIT" }),
      );
      const stored = await storePackage(root, pkg, prefix, integrityOf("@acme/x", "1.0.0"));
      await activatePlugins(root, new Map([["@acme/x", [{}]]]), null);

      const bare: PluginIndexEntry = { ...VALID_ENTRY };
      delete bare.integrity;
      const x = (version: string, integrity?: string): PluginIndexEntry => ({
        ...bare,
        name: "@acme/x",
        version,
        ...(integrity !== undefined ? { integrity } : {}),
      });
      const routes = pluginRegistryRoutes({
        root,
        registries: [
          stubRegistry("builtin", [x("1.0.0", hash("b"))]).registry,
          storePluginRegistry(root),
          stubRegistry("published", [x("2.0.0"), x("1.0.0", hash("b"))]).registry,
        ],
      });
      const res = await routes.request(`/contents?name=${encodeURIComponent("@acme/x")}`);
      expect(await res.json()).toEqual({
        name: "@acme/x",
        contents: [
          { version: "2.0.0", stored: false, linked: false },
          { version: "1.0.0", integrity: hash("b"), stored: false, linked: false },
          { version: "1.0.0", integrity: stored.integrity, stored: true, linked: true },
        ],
      });
      expect((await routes.request("/contents?name=%40acme%2Fnot-listed")).status).toBe(404);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
