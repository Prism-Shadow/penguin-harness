/**
 * The plugin registry: the catalogue a Project's plugin list is picked from.
 *
 * - The shared index format is validated whole: a flat array of per-version entries in order;
 *   a non-array or one malformed entry fails the document, naming the source or the position
 *   (unlike a plugin list's per-entry tolerance).
 * - The builtin catalogue lists the sandbox backends that live in plugins/, each named,
 *   versioned, described and licensed as the package names itself, described in both languages
 *   and drawn with the icon of its own package.json `penguin` block and icon.svg (which it
 *   publishes), and serves each one's own shipped README.md; a listed package not on this
 *   machine, a name it does not list and a remote registry have no readme.
 * - A package on this machine describes itself in the listing over what its row says; one
 *   without a penguin block or an icon, and a row whose package is not here, stay as the index
 *   wrote them; an icon that is not a plain SVG is never sent.
 * - The HTTP registry fetches its index URL and runs the document through the same validator;
 *   an HTTP error, non-JSON and a malformed document fail it; a failed connection is tried
 *   again, an answer is not. No network: fetch is the suite's fetch fake.
 * - A remote entry never carries an icon (the page inlines it as SVG): the HTTP registry drops
 *   it and keeps the rest of the row, and so does the route for a document a previous App
 *   fetched and parked.
 * - A published index may be slow or down without emptying the page: the cache and the
 *   tolerant merge beside the builtin catalogue.
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
  NIGHTLY_INDEX_URL,
  builtinPluginRegistry,
  cachedRegistry,
  httpPluginRegistry,
  mergeIndexes,
  parsePluginIndex,
} from "../src/plugin/registry.js";
import type { PluginRegistry } from "../src/plugin/registry.js";
import { resolveServerConfig } from "../src/config.js";
import { pluginRegistryRoutes } from "../src/http/routes/plugins.js";
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
      { ...VALID_ENTRY, icon: { svg: "<svg/>" } },
      { ...VALID_ENTRY, descriptionZh: 1 },
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
  /** The product's own fields: what the package says of itself for its card. */
  penguin?: {
    description_zh?: string;
    short_description?: string;
    short_description_zh?: string;
    category?: string;
  };
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
});

describe("the builtin catalogue and the packages it lists", () => {
  it("lists the sandbox backends in plugins/, each named as that package names itself", async () => {
    const index = await builtinPluginRegistry().index();
    // Valid under the format every registry is held to.
    expect(parsePluginIndex(index, "builtin")).toEqual(index);
    expect(index.length).toBeGreaterThan(0);
    for (const entry of index) {
      const pkg = packages.get(entry.name);
      expect(pkg, `${entry.name} is listed but is no package in plugins/`).toBeDefined();
      expect(entry.categories, entry.name).toHaveLength(1);
      expect(entry.categories![0], entry.name).toBe("sandbox");
      expect(pkg!.manifest.version, entry.name).toBe(entry.version);
      expect(pkg!.manifest.description, entry.name).toBe(entry.description);
      expect(pkg!.manifest.license, entry.name).toBe(entry.license);
    }
  });

  /**
   * The row is the card on a server the package is not installed on, so it repeats what the
   * package says of itself — its package.json's `penguin` block and its icon.svg — and the
   * package publishes both, for the card of a server it is installed on.
   */
  it("describes each backend in both languages with the package's own penguin block and icon.svg", async () => {
    for (const entry of await builtinPluginRegistry().index()) {
      const { dir, manifest } = packages.get(entry.name)!;
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
    const name = "@penguinharness/sandbox-bwrap";
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
  const remoteEntry: PluginIndexEntry = {
    ...VALID_ENTRY,
    name: "@example/penguin-plugin-remote",
  };

  it("concatenates sources in order, the first source winning a name@version collision", async () => {
    // What this deployment ships is the truth about it; a published index claiming the same
    // specifier does not get to describe a package the operator already has.
    const mine = { ...VALID_ENTRY, description: "the shipped one" };
    const theirs = { ...VALID_ENTRY, description: "the published one" };
    const { entries, failures } = await mergeIndexes([
      stubRegistry("builtin", [mine]).registry,
      stubRegistry("remote", [theirs, remoteEntry]).registry,
    ]);
    expect(entries.map((e) => [e.name, e.description])).toEqual([
      [VALID_ENTRY.name, "the shipped one"],
      [remoteEntry.name, remoteEntry.description],
    ]);
    expect(failures).toEqual([]);
  });

  it("keeps the other sources when one fails, and names the one that did", async () => {
    const builtin = stubRegistry("builtin", [VALID_ENTRY]);
    const remote = stubRegistry("remote", [remoteEntry]);
    remote.state.fail = "index answered HTTP 503";
    const { entries, failures } = await mergeIndexes([builtin.registry, remote.registry]);
    // A dead remote shortens the listing; it does not empty it.
    expect(entries.map((e) => e.name)).toEqual([VALID_ENTRY.name]);
    expect(failures).toEqual([{ source: "remote", error: "index answered HTTP 503" }]);
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

  it("merges the published entries in behind the builtin ones, and reports a dead source", async () => {
    const dead = stubRegistry("dead", []);
    dead.state.fail = "published index answered HTTP 404";
    const routes = pluginRegistryRoutes({
      registries: [
        builtinPluginRegistry(),
        stubRegistry("published", [published]).registry,
        dead.registry,
      ],
    });
    const body = (await (await routes.request("/")).json()) as PluginIndexResponse;
    expect(body.plugins.at(-1)!.name).toBe(published.name);
    // A dead source shortens the listing; it does not empty it.
    expect(body.failures).toEqual([{ source: "dead", error: "published index answered HTTP 404" }]);
  });

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
    expect(body.plugins.find((entry) => entry.name === published.name)).toEqual(published);
  });

  it("with no published source configured, lists the builtin entries alone", async () => {
    const routes = pluginRegistryRoutes({ indexUrl: null });
    const res = await routes.request("/");
    const body = (await res.json()) as PluginIndexResponse;
    expect(body.plugins).toEqual(await builtinPluginRegistry().index());
    expect(body.failures).toEqual([]);
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
      expect(body.plugins).toEqual([
        {
          ...installedHere,
          descriptionZh: "一个示例插件。",
          shortDescription: "Demo.",
          shortDescriptionZh: "示例。",
          icon: '<svg viewBox="0 0 24 24"></svg>\n',
        },
        bare,
        elsewhere,
      ]);
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
        JSON.stringify({ name: entry.name, version: "1.0.0", penguin: { short_description: "Risky." } }),
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
      expect(body.plugins).toEqual([{ ...entry, shortDescription: "Risky." }]);
    } finally {
      await rm(prefix, { recursive: true, force: true });
    }
  });
});
