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
 * - A remote entry never carries an icon (the page inlines it as SVG): the HTTP registry drops
 *   it and keeps the rest of the row, and so does the route for a document a previous App
 *   fetched and parked.
 * - The cache and the merge make one catalogue of the three: a row per content, tagged with
 *   its sources and whether this machine can install it; a published index may be slow or
 *   down without emptying the page.
 * - Nor without holding it: a document past its TTL is served at once while the refresh runs
 *   behind it; a failed fetch with nothing cached is the answer, without another fetch, until the
 *   retry window has passed; and the listing answers once its wait passes with the builtin
 *   entries, naming a source still being read as pending, whose entries list on a later read.
 * - GET /api/plugins/registry and its readme route need a session; the readme route refuses a
 *   name the deployment does not list and needs the name.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PluginCatalogueEntry,
  PluginEntrySource,
  PluginIndexEntry,
  PluginIndexResponse,
} from "../src/api/types.js";
import type { PluginBase } from "../src/plugin/loader.js";
import {
  BUILTIN_REGISTRY_SOURCE,
  INDEX_RETRY_MS,
  NIGHTLY_INDEX_URL,
  SOURCE_WAIT_MS,
  builtinPluginRegistry,
  cachedRegistry,
  httpPluginRegistry,
  mergeIndexes,
  localPluginDisplay,
  parsePluginIndex,
  pickCatalogueEntry,
  storePluginRegistry,
} from "../src/plugin/registry.js";
import type { PluginRegistry } from "../src/plugin/registry.js";
import { importPrefix } from "../src/plugin/store.js";
import { resolveServerConfig } from "../src/config.js";
import { pluginRegistryRoutes } from "../src/http/routes/plugins.js";
import { fakeFetch, fetchFailed, jsonResponse } from "./fixtures/fetch.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { manifestOf } from "../../../scripts/plugin-entry.mjs";

const hash = (digit: string) => `sha256-${digit.repeat(64)}`;

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
      { ...VALID_ENTRY, version: "1.1.0", keywords: ["linux"], updatedAt: 1755600000 },
    ];
    const parsed = parsePluginIndex(doc, "test");
    expect(parsed.map((e) => e.version)).toEqual(["1.0.0", "1.1.0"]);
  });

  it("accepts an entry without an integrity: an older index still lists", () => {
    const { integrity: _, ...bare } = VALID_ENTRY;
    expect(parsePluginIndex([bare], "test")).toEqual([bare]);
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
      { ...VALID_ENTRY, icon: { svg: "<svg/>" } },
      { ...VALID_ENTRY, descriptionZh: 1 },
      // A present integrity must be a key the store can use.
      { ...VALID_ENTRY, integrity: "sha512-abc" },
      { ...VALID_ENTRY, integrity: `sha256-${"A".repeat(64)}` },
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

  it("serves the index the running build carries, validated like any other", async () => {
    await installation(path.join(dir, "install"), [VALID_ENTRY]);
    const registry = builtinPluginRegistry();
    expect(registry.source).toBe(BUILTIN_REGISTRY_SOURCE);
    expect(registry.kind).toBe("builtin");
    expect(await registry.index()).toEqual([VALID_ENTRY]);
  });

  it("reads a push's index before the installation's", async () => {
    await installation(path.join(dir, "install"), [VALID_ENTRY]);
    const assets = path.join(dir, "assets");
    const pushed = { ...VALID_ENTRY, version: "2.0.0", integrity: hash("b") };
    await mkdir(path.join(assets, "plugins"), { recursive: true });
    await writeFile(path.join(assets, "plugins", "index.json"), JSON.stringify([pushed]));
    expect(await builtinPluginRegistry(undefined, () => assets).index()).toEqual([pushed]);
  });

  it("lists nothing for a run from source, which ships no prefix", async () => {
    process.argv[1] = path.join(dir, "nowhere", "bin", "server.js");
    expect(await builtinPluginRegistry().index()).toEqual([]);
  });

  it("fails loudly on a broken shipped index rather than serving it", async () => {
    await installation(path.join(dir, "install"), [{ name: 1 }]);
    await expect(builtinPluginRegistry().index()).rejects.toThrow(/malformed entry at index 0/);
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
    const { stored } = await importPrefix(root, prefix, "builtin");
    const registry = storePluginRegistry(root);
    expect(registry.kind).toBe("store");
    expect(await registry.index()).toEqual([
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
    expect(registry.kind).toBe("index");
    const entries = await registry.index();
    expect(fake.calls.map((call) => call.url)).toEqual([url]);
    expect(entries).toEqual([VALID_ENTRY]);
  });

  it("drops a remote entry's icon, an SVG the page would inline, and keeps the rest of the row", async () => {
    const described: PluginIndexEntry = {
      ...VALID_ENTRY,
      descriptionZh: "一个示例插件。",
      shortDescription: "Demo.",
    };
    const registry = fakeFetch(() =>
      jsonResponse([{ ...described, icon: '<svg onload="alert(1)"></svg>' }]),
    );
    expect(await httpPluginRegistry(url, registry.fetch).index()).toEqual([described]);
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

  it("requires auth, then serves the build's index as builtin rows", async () => {
    expect((await t.app.request("/api/plugins/registry")).status).toBe(401);

    await installation(path.join(t.root, "install"), [VALID_ENTRY]);
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/plugins/registry");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PluginIndexResponse;
    expect(body.plugins).toEqual([{ ...VALID_ENTRY, sources: ["builtin"], installable: true }]);
    expect(body.failures).toEqual([]);
  });
});

/**
 * The builtin index is read off the packages it lists: scripts/build-plugins.mjs lays each
 * code package the build ships out as a store entry and writes the entry's manifest from the
 * package's own package.json (scripts/plugin-entry.mjs `manifestOf`). So what the catalogue
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
  /** The product's own fields: what the package says of itself for its card. */
  penguin?: {
    description_zh?: string;
    short_description?: string;
    short_description_zh?: string;
    category?: string;
  };
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
    for (const file of ["package.json", "README.md", "icon.svg"]) {
      const source = path.join(PLUGINS_DIR, pkg.dir, file);
      if (existsSync(source)) await cp(source, path.join(dest, file));
    }
  }
  return { dir, bases: [{ file: path.join(dir, "package.json"), builtin: true }] };
}

describe("the builtin catalogue and the packages it lists", () => {
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

  /**
   * The row is the card on a server the package is not installed on, so it repeats what the
   * package says of itself — its package.json's `penguin` block and its icon.svg — and the
   * package publishes both, for the card of a server it is installed on.
   */
  it("describes each backend in both languages with the package's own penguin block and icon.svg", async () => {
    const backends = [...packages].filter(([, { dir }]) => dir.startsWith("sandbox-"));
    expect(backends).toHaveLength(4);
    const shipped = await shippedPrefix(backends.map(([name]) => name));
    try {
      for (const [name, { dir, manifest }] of backends) {
        const entry = {
          ...manifestOf(manifest as never, name, manifest.version, hash("c")),
          ...(await localPluginDisplay(name, shipped.bases)),
        };
        expect(entry, entry.name).toMatchObject({
          description: manifest.description,
          descriptionZh: manifest.penguin?.description_zh,
          shortDescription: manifest.penguin?.short_description,
          shortDescriptionZh: manifest.penguin?.short_description_zh,
          icon: readFileSync(`${PLUGINS_DIR}${dir}/icon.svg`, "utf8"),
          categories: [manifest.penguin?.category],
        });
        expect(manifest.files, entry.name).toContain("icon.svg");
      }
    } finally {
      await rm(shipped.dir, { recursive: true, force: true });
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
    for (const file of ["package.json", "README.md", "icon.svg"]) {
      const source = path.join(PLUGINS_DIR, pkg.dir, file);
      if (existsSync(source)) await cp(source, path.join(dest, file));
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
function stubRegistry(
  source: string,
  entries: PluginIndexEntry[],
  kind: PluginEntrySource = "index",
) {
  const state = { calls: 0, fail: null as string | null };
  const registry: PluginRegistry = {
    source,
    kind,
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
    const cached = cachedRegistry(registry, { ttlMs: 10, retryMs: 50, now: () => clock });
    await expect(cached.index()).rejects.toThrow(/network down/);
    // The failed attempt is not cached as a good one.
    state.fail = null;
    clock += 50;
    expect(await cached.index()).toHaveLength(1);
    clock += 100;
    state.fail = "network down";
    // Stale beats empty: the page's job is to show what exists.
    expect(await cached.index()).toEqual([VALID_ENTRY]);
    // And the refresh that just failed is not tried again inside the retry window.
    expect(await cached.index()).toEqual([VALID_ENTRY]);
    expect(state.calls).toBe(3);
  });

  it("answers a read past the TTL at once with the document in hand, and a later read with the refreshed one", async () => {
    const fresh = { ...VALID_ENTRY, version: "2.0.0" };
    let answer!: (entries: PluginIndexEntry[]) => void;
    const refreshed = new Promise<PluginIndexEntry[]>((resolve) => {
      answer = resolve;
    });
    let calls = 0;
    const slow: PluginRegistry = {
      source: "remote",
      index: () => {
        calls += 1;
        return refreshed;
      },
      readme: () => Promise.resolve(null),
    };
    const cached = cachedRegistry(slow, {
      ttlMs: 10,
      now: () => 100,
      seed: { at: 0, entries: [VALID_ENTRY] },
    });
    // The refresh has not answered, and the read does not wait for it.
    expect(await cached.index()).toEqual([VALID_ENTRY]);
    answer([fresh]);
    await refreshed;
    expect(await cached.index()).toEqual([fresh]);
    expect(calls).toBe(1);
  });

  it("answers with a failure at once until the retry window has passed, and only then fetches again", async () => {
    const { registry, state } = stubRegistry("remote", [VALID_ENTRY]);
    state.fail = "network down";
    let clock = 0;
    const cached = cachedRegistry(registry, { retryMs: 60_000, now: () => clock });
    await expect(cached.index()).rejects.toThrow(/network down/);
    state.fail = null;
    clock += 59_999;
    await expect(cached.index()).rejects.toThrow(/network down/);
    expect(state.calls).toBe(1);
    clock += 1;
    expect(await cached.index()).toEqual([VALID_ENTRY]);
    expect(state.calls).toBe(2);
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
  const remoteEntry: PluginIndexEntry = {
    ...VALID_ENTRY,
    name: "@example/penguin-plugin-remote",
  };

  it("concatenates sources in order, tags each row, and reports no failures", async () => {
    const a = stubRegistry("builtin", [VALID_ENTRY], "builtin");
    const b = stubRegistry("remote", [remoteEntry]);
    const { entries, failures } = await mergeIndexes([a.registry, b.registry]);
    expect(entries.map((e) => [e.name, e.sources])).toEqual([
      [VALID_ENTRY.name, ["builtin"]],
      [remoteEntry.name, ["index"]],
    ]);
    expect(failures).toEqual([]);
  });

  it("makes one row of one content, tagged with every source, the first one describing it", async () => {
    const mine = { ...VALID_ENTRY, description: "the shipped one" };
    const theirs = { ...VALID_ENTRY, description: "the published one" };
    const { entries } = await mergeIndexes([
      stubRegistry("builtin", [mine], "builtin").registry,
      stubRegistry("store", [mine], "store").registry,
      stubRegistry("remote", [theirs]).registry,
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      description: "the shipped one",
      sources: ["builtin", "store", "index"],
      installable: true,
    });
  });

  it("keeps two contents of one version apart", async () => {
    const other = { ...VALID_ENTRY, integrity: hash("b") };
    const { entries } = await mergeIndexes([
      stubRegistry("builtin", [VALID_ENTRY], "builtin").registry,
      stubRegistry("remote", [other]).registry,
    ]);
    expect(entries.map((e) => [e.integrity, e.sources])).toEqual([
      [VALID_ENTRY.integrity, ["builtin"]],
      [other.integrity, ["index"]],
    ]);
  });

  it("lists an entry without an integrity as not installable, and leaves a yanked one out", async () => {
    const { integrity: _, ...bare } = remoteEntry;
    const yanked = { ...VALID_ENTRY, version: "0.9.0", yanked: true };
    const { entries } = await mergeIndexes([stubRegistry("remote", [bare, yanked]).registry]);
    expect(entries).toEqual([{ ...bare, sources: ["index"], installable: false }]);
  });

  it("keeps the other sources when one fails, and names the one that did", async () => {
    const builtin = stubRegistry("builtin", [VALID_ENTRY], "builtin");
    const remote = stubRegistry("remote", [remoteEntry]);
    remote.state.fail = "index answered HTTP 503";
    const { entries, failures } = await mergeIndexes([builtin.registry, remote.registry]);
    // A dead remote shortens the listing; it does not empty it.
    expect(entries.map((e) => e.name)).toEqual([VALID_ENTRY.name]);
    expect(failures).toEqual([{ source: "remote", error: "index answered HTTP 503" }]);
  });
});

describe("pickCatalogueEntry", () => {
  const row = (
    version: string,
    digit: string | null,
    sources: PluginEntrySource[] = ["index"],
  ): PluginCatalogueEntry => ({
    ...VALID_ENTRY,
    version,
    ...(digit === null ? { integrity: undefined } : { integrity: hash(digit) }),
    sources,
    installable: digit !== null,
  });

  it("takes the highest version the ask admits, what is on this machine first within one", () => {
    const rows = [
      row("1.0.0", "1"),
      row("1.2.0", "2"),
      row("1.2.0", "3", ["store"]),
      row("2.0.0", "4"),
    ];
    expect(pickCatalogueEntry(rows, VALID_ENTRY.name, {})).toBe(rows[3]);
    expect(pickCatalogueEntry(rows, VALID_ENTRY.name, { version: "^1.0.0" })).toBe(rows[2]);
    expect(pickCatalogueEntry(rows, VALID_ENTRY.name, { integrity: hash("1") })).toBe(rows[0]);
  });

  it("never takes a row without an integrity, and says so when that is all there is", () => {
    const rows = [row("1.0.0", "1"), row("2.0.0", null)];
    expect(pickCatalogueEntry(rows, VALID_ENTRY.name, {})).toBe(rows[0]);
    expect(pickCatalogueEntry(rows, VALID_ENTRY.name, { version: "2.0.0" })).toEqual({
      refused: expect.stringMatching(/listed without an integrity/),
    });
  });

  it("refuses a name no source lists, and an ask nothing listed satisfies", () => {
    expect(pickCatalogueEntry([], "@x/y", {})).toEqual({
      refused: expect.stringMatching(/none of the plugin catalogue's sources/),
    });
    expect(pickCatalogueEntry([row("1.0.0", "1")], VALID_ENTRY.name, { version: "^2" })).toEqual({
      refused: expect.stringMatching(/satisfies \^2 \(listed: 1\.0\.0\)/),
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
  const published: PluginIndexEntry = {
    ...VALID_ENTRY,
    name: "@example/penguin-plugin-published",
  };
  const shipped = stubRegistry("builtin", [VALID_ENTRY], "builtin").registry;

  it("merges the published entries in behind the builtin ones", async () => {
    const routes = pluginRegistryRoutes({
      registries: [shipped, stubRegistry("published", [published]).registry],
    });
    const res = await routes.request("/");
    const body = (await res.json()) as PluginIndexResponse;
    expect(body.plugins.at(-1)!.name).toBe(published.name);
    expect(body.failures).toEqual([]);
  });

  it("reports a dead published source instead of hiding it", async () => {
    const dead = stubRegistry("published", []);
    dead.state.fail = "published index answered HTTP 404";
    const routes = pluginRegistryRoutes({ registries: [shipped, dead.registry] });
    const res = await routes.request("/");
    const body = (await res.json()) as PluginIndexResponse;
    // A dead published source shortens the listing; it does not empty it.
    expect(body.plugins.length).toBeGreaterThan(0);
    expect(body.failures).toEqual([
      { source: "published", error: "published index answered HTTP 404" },
    ]);
  });

  it("with no published source configured, lists this machine's sources alone", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "penguin-route-"));
    try {
      const routes = pluginRegistryRoutes({
        indexUrl: null,
        root: path.join(dir, "root"),
        assetsDir: () => null,
      });
      const res = await routes.request("/");
      const body = (await res.json()) as PluginIndexResponse;
      expect(body.failures).toEqual([]);
      expect(body.plugins.every((p) => !p.sources.includes("index"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("catalogue metadata and remote icon safety", () => {
  const published = { ...VALID_ENTRY, name: "@example/penguin-plugin-published" };
  it("drops the icons of a published document a previous App fetched and parked", async () => {
    const offline = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const routes = pluginRegistryRoutes({
      indexUrl: "https://registry.example/index.json",
      fetchImpl: offline.fetch,
      seed: { at: Date.now(), entries: [{ ...published, icon: '<svg onload="alert(1)"></svg>' }] },
    });
    const body = (await (await routes.request("/")).json()) as PluginIndexResponse;
    expect(body.plugins.find((entry) => entry.name === published.name)).toEqual({
      ...published,
      sources: ["index"],
      installable: true,
    });
  });

  /** The catalogue rows the build's own entries list as, the way the route tags them. */
  const builtinRows = async () =>
    (await builtinPluginRegistry().index()).map((entry) => ({
      ...entry,
      sources: ["builtin"] as PluginEntrySource[],
      installable: entry.integrity !== undefined,
    }));

  describe("with a published index on a slow or unreachable network", () => {
    const url = "https://registry.example/index.json";
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    /** One read of the listing, letting the route's wait for a source run out. */
    const read = async (routes: ReturnType<typeof pluginRegistryRoutes>) => {
      const res = routes.request("/");
      await vi.advanceTimersByTimeAsync(SOURCE_WAIT_MS);
      return (await (await res).json()) as PluginIndexResponse;
    };

    it("lists the builtin entries once the wait passes, names it pending, and lists its entries on a read after it answers", async () => {
      let answer!: (res: Response) => void;
      const remote = fakeFetch(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      );
      const routes = pluginRegistryRoutes({ indexUrl: url, fetchImpl: remote.fetch });
      const first = await read(routes);
      expect(first.plugins).toEqual(await builtinRows());
      expect(first.pending).toEqual([url]);
      expect(first.failures).toEqual([]);

      answer(jsonResponse([published]));
      const second = await read(routes);
      expect(second.plugins.at(-1)!.name).toBe(published.name);
      expect(second.pending).toEqual([]);
      expect(remote.calls).toHaveLength(1);
    });

    it("once its fetch has failed, reports it unreachable without fetching again until the retry window has passed", async () => {
      const remote = fakeFetch(() => {
        throw fetchFailed("ETIMEDOUT");
      });
      const routes = pluginRegistryRoutes({ indexUrl: url, fetchImpl: remote.fetch });
      expect((await read(routes)).plugins).toEqual(await builtinRows());
      // The fetch spends its attempts behind the answer.
      await vi.runAllTimersAsync();
      const fetched = remote.calls.length;

      const second = await read(routes);
      expect(second.failures.map((f) => f.source)).toEqual([url]);
      expect(second.pending).toEqual([]);
      expect(remote.calls).toHaveLength(fetched);

      await vi.advanceTimersByTimeAsync(INDEX_RETRY_MS);
      await read(routes);
      expect(remote.calls.length).toBeGreaterThan(fetched);
    });
  });

  it("with no published source configured, lists the builtin entries alone", async () => {
    const routes = pluginRegistryRoutes({ indexUrl: null });
    const res = await routes.request("/");
    const body = (await res.json()) as PluginIndexResponse;
    expect(body.plugins).toEqual(await builtinRows());
    expect(body.failures).toEqual([]);
    expect(body.pending).toEqual([]);
  });

  it("lets a package on this machine describe itself over its row, and leaves a row whose package is not here as it is", async () => {
    // A published row that carries only English and no icon, for a package an admin installed
    // into the data root's prefix with its own penguin block and icon.svg; and one installed
    // with neither, which keeps its row's text and the puzzle piece.
    const installedHere: PluginIndexEntry = {
      ...VALID_ENTRY,
      name: "@example/penguin-plugin-here",
    };
    const bare: PluginIndexEntry = { ...VALID_ENTRY, name: "@example/penguin-plugin-bare" };
    const elsewhere: PluginIndexEntry = { ...VALID_ENTRY, name: "@example/penguin-plugin-away" };
    const prefix = await mkdtemp(path.join(tmpdir(), "penguin-prefix-"));
    try {
      await writeFile(path.join(prefix, "package.json"), '{"name":"prefix","private":true}');
      const dir = path.join(prefix, "node_modules", "@example", "penguin-plugin-here");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: installedHere.name,
          version: "1.0.0",
          description: "A demo plugin.",
          penguin: {
            description_zh: "一个示例插件。",
            short_description: "Demo.",
            short_description_zh: "示例。",
          },
        }),
      );
      await writeFile(path.join(dir, "icon.svg"), '<svg viewBox="0 0 24 24"></svg>\n');
      const bareDir = path.join(prefix, "node_modules", "@example", "penguin-plugin-bare");
      await mkdir(bareDir, { recursive: true });
      await writeFile(
        path.join(bareDir, "package.json"),
        JSON.stringify({ name: bare.name, version: "1.0.0" }),
      );
      const routes = pluginRegistryRoutes({
        registries: [stubRegistry("published", [installedHere, bare, elsewhere]).registry],
        bases: () => [{ file: path.join(prefix, "package.json"), builtin: false }],
      });
      const body = (await (await routes.request("/")).json()) as PluginIndexResponse;
      expect(body.plugins).toEqual(
        [
          {
            ...installedHere,
            descriptionZh: "一个示例插件。",
            shortDescription: "Demo.",
            shortDescriptionZh: "示例。",
            icon: '<svg viewBox="0 0 24 24"></svg>\n',
          },
          bare,
          elsewhere,
        ].map((entry) => ({ ...entry, sources: ["index"], installable: true })),
      );
    } finally {
      await rm(prefix, { recursive: true, force: true });
    }
  });

  it("never sends the icon of a package on this machine that is not a plain SVG", async () => {
    const entry: PluginIndexEntry = { ...VALID_ENTRY, name: "@example/penguin-plugin-risky" };
    const prefix = await mkdtemp(path.join(tmpdir(), "penguin-prefix-"));
    try {
      await writeFile(path.join(prefix, "package.json"), '{"name":"prefix","private":true}');
      const dir = path.join(prefix, "node_modules", "@example", "penguin-plugin-risky");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: entry.name,
          version: "1.0.0",
          penguin: { short_description: "Risky." },
        }),
      );
      await writeFile(
        path.join(dir, "icon.svg"),
        '<svg viewBox="0 0 24 24"><script>fetch("https://example.invalid")</script></svg>\n',
      );
      const routes = pluginRegistryRoutes({
        registries: [stubRegistry("published", [entry]).registry],
        bases: () => [{ file: path.join(prefix, "package.json"), builtin: false }],
      });
      const body = (await (await routes.request("/")).json()) as PluginIndexResponse;
      expect(body.plugins).toEqual([
        { ...entry, shortDescription: "Risky.", sources: ["index"], installable: true },
      ]);
    } finally {
      await rm(prefix, { recursive: true, force: true });
    }
  });
});
