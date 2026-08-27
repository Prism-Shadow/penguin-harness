/**
 * Plugin registry tests: the shared index format (strict whole-document validation —
 * one malformed row fails the artifact, unlike plugins.json's per-entry tolerance),
 * the builtin registry serving the embedded four sandbox backends, the HTTP registry
 * running a fetched document through the same validator (fetch stubbed, no network),
 * the cache and the tolerant merge that let a published index be slow or down without
 * emptying the page, and GET /api/plugins behind the auth gate.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginIndexEntry, PluginIndexResponse } from "../src/api/types.js";
import { BUILTIN_READMES } from "../src/plugin/builtin-readmes.js";
import {
  BUILTIN_REGISTRY_SOURCE,
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

describe("builtinPluginRegistry", () => {
  it("serves the four sandbox backends, valid under the shared format", async () => {
    const registry = builtinPluginRegistry();
    expect(registry.source).toBe(BUILTIN_REGISTRY_SOURCE);
    const entries = await registry.index();
    expect(entries.map((e) => e.name)).toEqual([
      "@prismshadow/penguin-plugin-sandbox-bwrap",
      "@prismshadow/penguin-plugin-sandbox-seatbelt",
      "@prismshadow/penguin-plugin-sandbox-mxc",
      "@prismshadow/penguin-plugin-sandbox-dsh",
    ]);
    for (const entry of entries) {
      expect(entry.categories).toEqual(["sandbox"]);
      expect(entry.license).toBe("Apache-2.0");
    }
  });
});

describe("httpPluginRegistry", () => {
  const url = "https://registry.example/index.json";

  it("fetches the index URL and validates the document with the shared parser", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return new Response(JSON.stringify([VALID_ENTRY]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const entries = await httpPluginRegistry(url, fetchImpl).index();
    expect(seen).toEqual([url]);
    expect(entries).toEqual([VALID_ENTRY]);
  });

  it("fails on an HTTP error status, on non-JSON, and on a malformed document", async () => {
    const respond =
      (body: string, status = 200) =>
      async () =>
        new Response(body, { status });
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
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("requires auth, then serves the builtin index", async () => {
    expect((await t.app.request("/api/plugins/registry")).status).toBe(401);

    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/plugins/registry");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PluginIndexResponse;
    expect(body.plugins).toHaveLength(4);
    expect(body.plugins.every((p) => p.name.startsWith("@prismshadow/penguin-plugin-"))).toBe(true);
  });
});

describe("plugin readmes", () => {
  /**
   * The detail page's whole content. A listed entry with no readme renders an empty page,
   * which is a gap nobody sees until they click it — so the pairing is pinned here rather
   * than left to whoever adds the next backend.
   */
  it("every builtin entry has one", async () => {
    const registry = builtinPluginRegistry();
    for (const entry of await registry.index()) {
      const readme = await registry.readme(entry.name);
      expect(readme, `${entry.name} has no readme`).not.toBeNull();
      expect(readme).toContain("#");
    }
  });

  it("an unlisted name has none, rather than an invented one", async () => {
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
  /**
   * The index asserts a name, version, description and license for four packages that live
   * beside it in this workspace, and their readmes are those packages' own README.md files.
   * None of that is enforced by anything the packages do, so it is asserted here: the listing
   * is the string an operator copies into `plugins.json`, and a catalogue that describes
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

  it("names each package as that package names itself", async () => {
    for (const entry of await builtinPluginRegistry().index()) {
      const pkg = packages.get(entry.name);
      expect(pkg, `${entry.name} is listed but is no package in plugins/`).toBeDefined();
      expect(pkg!.manifest.version, entry.name).toBe(entry.version);
      expect(pkg!.manifest.description, entry.name).toBe(entry.description);
      expect(pkg!.manifest.license, entry.name).toBe(entry.license);
    }
  });

  it("serves each package's own README.md, and ships it in the package", async () => {
    const registry = builtinPluginRegistry();
    for (const entry of await registry.index()) {
      const pkg = packages.get(entry.name)!;
      const own = readFileSync(`${PLUGINS_DIR}${pkg.dir}/README.md`, "utf8");
      expect(await registry.readme(entry.name), entry.name).toBe(own);
      expect(pkg.manifest.files, `${entry.name} would publish without its readme`).toContain(
        "README.md",
      );
    }
  });

  it("carries no readme for anything it does not list", async () => {
    const listed = new Set((await builtinPluginRegistry().index()).map((e) => e.name));
    for (const name of Object.keys(BUILTIN_READMES)) {
      expect(listed.has(name), `${name} has a readme but no listing`).toBe(true);
    }
  });
});

describe("GET /api/plugins/registry/readme", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("requires auth, then serves a listed entry's readme", async () => {
    const name = "@prismshadow/penguin-plugin-sandbox-bwrap";
    const path = `/api/plugins/registry/readme?name=${encodeURIComponent(name)}`;
    expect((await t.app.request(path)).status).toBe(401);

    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get(path);
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
  it("fetches once per TTL and again after it lapses", async () => {
    const { registry, state } = stubRegistry("remote", [VALID_ENTRY]);
    let clock = 1_000;
    const cached = cachedRegistry(registry, { ttlMs: 60_000, now: () => clock });

    await cached.index();
    await cached.index();
    expect(state.calls).toBe(1);

    clock += 59_999;
    await cached.index();
    expect(state.calls).toBe(1);

    clock += 2;
    await cached.index();
    expect(state.calls).toBe(2);
  });

  it("shares one in-flight fetch between concurrent callers", async () => {
    const { registry, state } = stubRegistry("remote", [VALID_ENTRY]);
    const cached = cachedRegistry(registry, { ttlMs: 60_000, now: () => 0 });
    // Four tabs opening the page at once must be one request, not four.
    await Promise.all([cached.index(), cached.index(), cached.index(), cached.index()]);
    expect(state.calls).toBe(1);
  });

  it("keeps serving the last good document when a refresh fails", async () => {
    const { registry, state } = stubRegistry("remote", [VALID_ENTRY]);
    let clock = 0;
    const cached = cachedRegistry(registry, { ttlMs: 10, now: () => clock });
    expect(await cached.index()).toHaveLength(1);

    clock += 100;
    state.fail = "network down";
    // Stale beats empty: the page's job is to show what exists.
    expect(await cached.index()).toEqual([VALID_ENTRY]);
  });

  it("propagates a failure when it has never had a good document", async () => {
    const { registry, state } = stubRegistry("remote", []);
    state.fail = "network down";
    const cached = cachedRegistry(registry, { ttlMs: 10, now: () => 0 });
    await expect(cached.index()).rejects.toThrow(/network down/);
    // And the failed attempt is not cached as a good one.
    state.fail = null;
    await expect(cached.index()).resolves.toEqual([]);
  });
});

describe("mergeIndexes", () => {
  const remoteEntry: PluginIndexEntry = {
    ...VALID_ENTRY,
    name: "@example/penguin-plugin-remote",
  };

  it("concatenates sources in order and reports no failures", async () => {
    const a = stubRegistry("builtin", [VALID_ENTRY]);
    const b = stubRegistry("remote", [remoteEntry]);
    const { entries, failures } = await mergeIndexes([a.registry, b.registry]);
    expect(entries.map((e) => e.name)).toEqual([VALID_ENTRY.name, remoteEntry.name]);
    expect(failures).toEqual([]);
  });

  it("lets the first source win a name@version collision", async () => {
    // What this deployment ships is the truth about it; a published index claiming the same
    // specifier does not get to describe a package the operator already has.
    const mine = { ...VALID_ENTRY, description: "the shipped one" };
    const theirs = { ...VALID_ENTRY, description: "the published one" };
    const { entries } = await mergeIndexes([
      stubRegistry("builtin", [mine]).registry,
      stubRegistry("remote", [theirs]).registry,
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.description).toBe("the shipped one");
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
  it("is a release asset on a fixed tag, not an API query", () => {
    // The tag is never re-pointed — a six-hourly workflow replaces the ASSET — so "latest
    // nightly" is resolved by name and costs no unauthenticated API budget.
    expect(NIGHTLY_INDEX_URL).toBe(
      "https://github.com/Prism-Shadow/penguin-plugins/releases/download/nightly/index.json",
    );
  });

  it("PENGUIN_PLUGIN_INDEX: unset reads the published one, off reads none, a URL replaces it", () => {
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

  it("merges the published entries in behind the builtin ones", async () => {
    const routes = pluginRegistryRoutes({
      registries: [builtinPluginRegistry(), stubRegistry("published", [published]).registry],
    });
    const res = await routes.request("/");
    const body = (await res.json()) as PluginIndexResponse;
    expect(body.plugins.at(-1)!.name).toBe(published.name);
    expect(body.failures).toEqual([]);
  });

  it("reports a dead published source instead of hiding it", async () => {
    const dead = stubRegistry("published", []);
    dead.state.fail = "published index answered HTTP 404";
    const routes = pluginRegistryRoutes({
      registries: [builtinPluginRegistry(), dead.registry],
    });
    const res = await routes.request("/");
    const body = (await res.json()) as PluginIndexResponse;
    // A dead published source shortens the listing; it does not empty it.
    expect(body.plugins.length).toBeGreaterThan(0);
    expect(body.failures).toEqual([
      { source: "published", error: "published index answered HTTP 404" },
    ]);
  });

  it("with no published source configured, lists the builtin entries alone", async () => {
    const routes = pluginRegistryRoutes({ indexUrl: null });
    const res = await routes.request("/");
    const body = (await res.json()) as PluginIndexResponse;
    expect(body.plugins.every((e) => e.name.startsWith("@prismshadow/"))).toBe(true);
    expect(body.failures).toEqual([]);
  });
});
