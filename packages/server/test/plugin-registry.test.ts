/**
 * The plugin registry: the catalogue a Project's plugin list is picked from.
 *
 * - The shared index format is validated whole: a flat array of per-version entries in order;
 *   a non-array or one malformed entry fails the document, naming the source or the position
 *   (unlike a plugin list's per-entry tolerance).
 * - The builtin catalogue lists the sandbox backends that live in plugins/, each named,
 *   versioned, titled, described and licensed as the package names itself, described in both
 *   languages as its own card contribution describes it and drawn with its icon.svg (both of which
 *   it publishes), and serves each one's own shipped README.md; a listed package not on this
 *   machine, a name it does not list and a remote registry have no readme.
 * - A package on this machine describes itself in the listing over what its row says (its card
 *   and its icon); one with neither, and a row whose package is not here, stay as the index wrote
 *   them. An icon is named by the URL the registry serves it at — the embedded row's SVG or the
 *   package's own file, as an image — and one that is not a plain SVG is neither named nor served.
 * - The HTTP registry fetches its index URL and runs the document through the same validator;
 *   an HTTP error, non-JSON and a malformed document fail it; a failed connection is tried
 *   again, an answer is not. No network: fetch is the suite's fetch fake.
 * - A remote entry never carries an icon (this server would serve it as its own image): the HTTP
 *   registry drops it and keeps the rest of the row, and so does the route for a document a
 *   previous App fetched and parked.
 * - A published index may be slow or down without emptying the page: the cache and the
 *   tolerant merge beside the builtin catalogue.
 * - Nor without holding it: a document past its TTL is served at once while the refresh runs
 *   behind it; a failed fetch with nothing cached is the answer, without another fetch, until the
 *   retry window has passed; and the listing never waits on the network — it answers at once with
 *   the builtin entries, naming a source still being read as pending, whose entries list on a
 *   later read.
 * - GET /api/plugins/registry and its readme route need a session; the readme route refuses a
 *   name the deployment does not list and needs the name.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { libraryContributions, readPluginTable } from "@prismshadow/penguin-core";
import type { LibraryContributions } from "@prismshadow/penguin-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginIndexResponse } from "../src/api/types.js";
import type { PluginBase } from "../src/plugin/loader.js";
import {
  INDEX_RETRY_MS,
  NIGHTLY_INDEX_URL,
  builtinPluginRegistry,
  cachedRegistry,
  compareSemver,
  httpPluginRegistry,
  isSemver,
  mergeIndexes,
  newestPerName,
  parsePluginIndex,
  selectIndexChannel,
} from "../src/plugin/registry.js";
import type { IndexDocumentEntry, PluginRegistry } from "../src/plugin/registry.js";
import { resolveServerConfig } from "../src/config.js";
import { pluginRegistryRoutes } from "../src/http/routes/plugins.js";
import { fakeFetch, fetchFailed, jsonResponse } from "./fixtures/fetch.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { contentTable } from "./plugin-fixtures.js";

/** A listing's rows as the index wrote them, but for the icon, which the listing names by URL. */
const withoutIcons = (entries: readonly { icon?: unknown }[]) =>
  entries.map(({ icon: _icon, ...row }) => row);

/** The first bytes of a PNG: as much of one as its format is told by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const VALID_ENTRY: IndexDocumentEntry = {
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
      { ...VALID_ENTRY, title: 1 },
      { ...VALID_ENTRY, titleZh: [] },
      { ...VALID_ENTRY, integrity: "md5-abc" },
      { ...VALID_ENTRY, integrity: 7 },
      { ...VALID_ENTRY, channels: "github" },
      { ...VALID_ENTRY, channels: [{ kind: "github" }] },
      { ...VALID_ENTRY, channels: [{ url: "https://x" }] },
      { ...VALID_ENTRY, channels: [null] },
    ]) {
      expect(() => parsePluginIndex([VALID_ENTRY, bad], "test")).toThrow(
        /malformed entry at index 1/,
      );
    }
  });

  it("passes an entry's integrity and channels through instead of dropping them", () => {
    const entry: IndexDocumentEntry = {
      ...VALID_ENTRY,
      integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      channels: [{ kind: "github", url: "https://github.com/o/r/releases/download/v1/x.tgz" }],
    };
    expect(parsePluginIndex([entry], "test")).toEqual([entry]);
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

  it("drops a remote entry's icon, an SVG this server would serve as its own, and keeps the rest of the row", async () => {
    const described: IndexDocumentEntry = {
      ...VALID_ENTRY,
      title: "Demo",
      titleZh: "示例",
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

  it("revalidates with If-None-Match, and a 304 is answered from the cache, not an error", async () => {
    const calls = fakeFetch((call) =>
      call.headers.get("if-none-match") !== null
        ? new Response(null, { status: 304, headers: { etag: '"a"' } })
        : jsonResponse([VALID_ENTRY], 200, { etag: '"a"' }),
    );
    const registry = httpPluginRegistry(url, calls.fetch);
    expect(await registry.index()).toEqual([VALID_ENTRY]);
    expect(calls.calls[0]!.headers.get("if-none-match")).toBeNull();
    expect(await registry.index()).toEqual([VALID_ENTRY]);
    expect(calls.calls[1]!.headers.get("if-none-match")).toBe('"a"');
    expect(calls.calls).toHaveLength(2);
  });

  it("keeps working when the etag churns but the document does not (a Pages quirk)", async () => {
    let etag = 0;
    const calls = fakeFetch(() => jsonResponse([VALID_ENTRY], 200, { etag: `"v${++etag}"` }));
    const registry = httpPluginRegistry(url, calls.fetch);
    const first = await registry.index();
    const second = await registry.index();
    expect(calls.calls).toHaveLength(2);
    // The new etag is what the next revalidation speaks.
    expect(calls.calls[1]!.headers.get("if-none-match")).toBe('"v1"');
    // The document did not change, so the entries parsed once are the entries served twice.
    expect(second).toBe(first);
    expect(await registry.index()).toBe(first);
    expect(calls.calls[2]!.headers.get("if-none-match")).toBe('"v2"');
  });

  it("caches by body hash when the server sends no etag at all", async () => {
    const calls = fakeFetch(() => jsonResponse([VALID_ENTRY]));
    const registry = httpPluginRegistry(url, calls.fetch);
    expect(await registry.index()).toEqual([VALID_ENTRY]);
    expect(await registry.index()).toEqual([VALID_ENTRY]);
    expect(calls.calls).toHaveLength(2);
    // No etag was ever sent, so no revalidation header either.
    expect(calls.calls[1]!.headers.get("if-none-match")).toBeNull();
  });

  it("a 304 with nothing in hand is an error, not an answer", async () => {
    // A 304 revalidates a document this registry is holding; without one it is a server
    // talking nonsense, and the read fails rather than inventing entries.
    const calls = fakeFetch(() => new Response(null, { status: 304, headers: { etag: '"a"' } }));
    await expect(httpPluginRegistry(url, calls.fetch).index()).rejects.toThrow(/HTTP 304/);
    expect(calls.calls).toHaveLength(1);
  });

  it("reads that overlap queue, so a stale completion cannot rewind the state a newer read wrote", async () => {
    // Two reads start together and the index churns between their answers: the first read's
    // bytes arrive only after the second read has taken the newer document. Answered as they
    // finished, the older read would write v1 over v2 and the next revalidation would speak
    // a dead etag; queued, the second read follows the first and the state stays coherent.
    const v1 = [VALID_ENTRY];
    const v2 = [{ ...VALID_ENTRY, description: "the second edition" }];
    const release: Array<() => void> = [];
    const gated = (body: unknown, etag: string) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            release.push(() => {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
              controller.close();
            });
          },
        }),
        { status: 200, headers: { etag } },
      );
    const calls = fakeFetch((_call, index) =>
      index === 0
        ? gated(v1, '"E1"')
        : index === 1
          ? jsonResponse(v2, 200, { etag: '"E2"' })
          : new Response(null, { status: 304, headers: { etag: '"E2"' } }),
    );
    const registry = httpPluginRegistry(url, calls.fetch);
    const first = registry.index();
    const second = registry.index();
    // The first read's fetch only happens after the registry's own setup awaits; a tick lets
    // it reach the gated body before the gate opens.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release[0]!();
    expect(await first).toEqual(v1);
    const secondValue = await second;
    expect(secondValue).toEqual(v2);
    // The second read ran after the first had settled, revalidating against its etag.
    expect(calls.calls[1]!.headers.get("if-none-match")).toBe('"E1"');
    // The third read revalidates against the document the second read left: the churned
    // index is served from a 304, the very entries the second read parsed.
    const third = await registry.index();
    expect(calls.calls[2]!.headers.get("if-none-match")).toBe('"E2"');
    expect(third).toBe(secondValue);
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

const GENERATOR = fileURLToPath(new URL("../../../scripts/gen-ifaces.mjs", import.meta.url));
type Card = NonNullable<LibraryContributions["card"]>;

/**
 * The sandbox backends' cards as their builds write them: the generator each `build` runs, over
 * the package's own compiler options with its entry alone as the root (its tests are not part of
 * its table), into a temp table read by core's reader. Generated here rather than read from the
 * packages — they are no dependency of the server, so nothing before this suite built them — and
 * from the source as it is, so a stale table cannot pass. Two at a time: each is a TypeScript
 * program of its own, beside the suite's other workers.
 */
async function sandboxCards(dirs: readonly string[]): Promise<Map<string, Card>> {
  const out = await mkdtemp(path.join(tmpdir(), "penguin-sandbox-tables-"));
  const cards = new Map<string, Card>();
  const generate = async (dir: string) => {
    const at = path.join(out, dir);
    await mkdir(at, { recursive: true });
    const tsconfig = path.join(at, "tsconfig.json");
    await writeFile(
      tsconfig,
      JSON.stringify({
        extends: path.join(PLUGINS_DIR, dir, "tsconfig.json"),
        include: [],
        files: [path.join(PLUGINS_DIR, dir, "src", "index.ts")],
      }),
    );
    await promisify(execFile)(process.execPath, [
      GENERATOR,
      "--project",
      tsconfig,
      "--out",
      path.join(at, "ifaces.json"),
    ]);
    const warnings: string[] = [];
    cards.set(dir, libraryContributions(readPluginTable(at)!, warnings).card ?? {});
    expect(warnings, dir).toEqual([]);
  };
  try {
    const queue = [...dirs];
    const worker = async () => {
      for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) await generate(dir);
    };
    await Promise.all([worker(), worker()]);
    return cards;
  } finally {
    await rm(out, { recursive: true, force: true });
  }
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
    expect(sandboxes).not.toHaveLength(0);
    for (const [name, { dir }] of sandboxes) {
      expect(name, `plugins/${dir}`).toBe(`@penguinharness/${dir}`);
    }
  });
});

describe("the builtin catalogue and the packages it lists", () => {
  let cards: Map<string, Card>;
  beforeAll(async () => {
    const index = await builtinPluginRegistry().index();
    cards = await sandboxCards(index.map((entry) => packages.get(entry.name)!.dir));
  });

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
   * package says of itself — its card contribution, in the ifaces.json its build writes, and its
   * icon.svg — and the package publishes both, for the card of a server it is installed on.
   */
  it("describes each backend in both languages with the package's own card and icon.svg", async () => {
    for (const entry of await builtinPluginRegistry().index()) {
      const { dir, manifest } = packages.get(entry.name)!;
      const card = cards.get(dir)!;
      expect(entry, entry.name).toMatchObject({
        title: card.title,
        titleZh: card.titleZh,
        description: manifest.description,
        descriptionZh: card.descriptionZh,
        shortDescription: card.shortDescription,
        shortDescriptionZh: card.shortDescriptionZh,
        icon: readFileSync(`${PLUGINS_DIR}${dir}/icon.svg`, "utf8"),
        categories: [card.category],
      });
      expect(manifest.files, entry.name).toContain("icon.svg");
      expect(manifest.files, entry.name).toContain("ifaces.json");
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
    expect(withoutIcons(body.plugins)).toEqual(withoutIcons(await builtinPluginRegistry().index()));
  });

  it("requires auth, then serves a listed entry's readme from the package on this machine", async () => {
    const name = "@penguinharness/sandbox-bwrap";
    const url = `/api/plugins/registry/readme?name=${encodeURIComponent(name)}`;
    expect((await t.app.request(url)).status).toBe(401);

    // The package as npm installs it into the data root's own prefix — the first base the
    // lookup tries, ahead of the installation's (which, in a checkout, is the workspace).
    const admin = await loginAdmin(t.app);
    const dest = path.join(t.root, "plugins", "node_modules", ...name.split("/"));
    await mkdir(dest, { recursive: true });
    await writeFile(
      path.join(t.root, "plugins", "package.json"),
      '{"name":"prefix","private":true}',
    );
    await writeFile(path.join(dest, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    const readme = "# The installed copy\n\nWhat this machine's package says of itself.\n";
    await writeFile(path.join(dest, "README.md"), readme);
    const res = await apiClient(t.app, admin.cookie).get(url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; readme: string | null };
    expect(body.name).toBe(name);
    expect(body.readme).toBe(readme);
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
function stubRegistry(source: string, entries: IndexDocumentEntry[]) {
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
    let answer!: (entries: IndexDocumentEntry[]) => void;
    const refreshed = new Promise<IndexDocumentEntry[]>((resolve) => {
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

describe("compareSemver", () => {
  // The chain semver.org §11 itself gives, in ascending order.
  const chain = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ];
  it("ranks the spec's own example chain in order", () => {
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(compareSemver(chain[i]!, chain[i + 1]!)).toBeLessThan(0);
      expect(compareSemver(chain[i + 1]!, chain[i]!)).toBeGreaterThan(0);
      expect(compareSemver(chain[i]!, chain[i]!)).toBe(0);
    }
  });

  it("compares numeric identifiers by value, not as strings", () => {
    // The trap: "alpha.10" sorts before "alpha.2" as text, after it as a semver.
    expect(compareSemver("0.0.1-alpha.2", "0.0.1-alpha.10")).toBeLessThan(0);
    expect(compareSemver("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });

  it("ranks a prerelease below the release it belongs to, and ignores build metadata", () => {
    expect(compareSemver("0.0.1-alpha.2", "0.0.1")).toBeLessThan(0);
    expect(compareSemver("1.0.0+x", "1.0.0+y")).toBe(0);
    expect(compareSemver("1.0.0+x", "1.0.0")).toBe(0);
  });

  it("refuses to rank a version that does not parse", () => {
    expect(isSemver("0.0.3")).toBe(true);
    expect(isSemver("0.0.1-alpha.2")).toBe(true);
    expect(isSemver("latest")).toBe(false);
    expect(isSemver("1.0")).toBe(false);
    expect(() => compareSemver("latest", "0.0.3")).toThrow();
  });
});

describe("newestPerName", () => {
  it("keeps the highest version per name, in the document's order", () => {
    const kept = newestPerName([
      { ...VALID_ENTRY, name: "@example/a", version: "0.0.2" },
      { ...VALID_ENTRY, name: "@example/a", version: "0.0.3" },
      { ...VALID_ENTRY, name: "@example/b", version: "1.0.0" },
      { ...VALID_ENTRY, name: "@example/a", version: "0.0.10" },
    ]);
    expect(kept.map((e) => [e.name, e.version])).toEqual([
      ["@example/b", "1.0.0"],
      ["@example/a", "0.0.10"],
    ]);
  });

  it("never lets a prerelease outrank the release, but ranks prereleases among themselves", () => {
    expect(
      newestPerName([
        { ...VALID_ENTRY, version: "0.0.1-alpha.2" },
        { ...VALID_ENTRY, version: "0.0.1" },
      ]).map((e) => e.version),
    ).toEqual(["0.0.1"]);
    expect(
      newestPerName([
        { ...VALID_ENTRY, version: "0.0.1-alpha.2" },
        { ...VALID_ENTRY, version: "0.0.1-alpha.10" },
      ]).map((e) => e.version),
    ).toEqual(["0.0.1-alpha.10"]);
  });

  it("ranks a version that parses over one that does not, and keeps the first otherwise", () => {
    expect(
      newestPerName([
        { ...VALID_ENTRY, version: "latest" },
        { ...VALID_ENTRY, version: "0.0.3" },
      ]).map((e) => e.version),
    ).toEqual(["0.0.3"]);
    expect(
      newestPerName([
        { ...VALID_ENTRY, version: "1.0.0+one" },
        { ...VALID_ENTRY, version: "1.0.0+two" },
      ]).map((e) => e.version),
    ).toEqual(["1.0.0+one"]);
  });
});

describe("mergeIndexes", () => {
  const remoteEntry: IndexDocumentEntry = {
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

  it("carries one row per name: a document's several versions collapse to the newest", async () => {
    const { entries } = await mergeIndexes([
      stubRegistry("remote", [
        { ...remoteEntry, version: "0.0.2" },
        { ...remoteEntry, version: "0.0.3" },
      ]).registry,
    ]);
    expect(entries.map((e) => e.version)).toEqual(["0.0.3"]);
  });

  it("the first source wins a name even where a later source's version is newer", async () => {
    // What this deployment ships stays what the page describes, whatever a published index
    // claims: a newer remote row does not outrank the shipped package.
    const mine = { ...VALID_ENTRY, description: "the shipped one", version: "1.0.0" };
    const theirs = { ...VALID_ENTRY, description: "the published one", version: "2.0.0" };
    const { entries } = await mergeIndexes([
      stubRegistry("builtin", [mine]).registry,
      stubRegistry("remote", [theirs]).registry,
    ]);
    expect(entries).toEqual([mine]);
  });
});

describe("selectIndexChannel", () => {
  const entry = (version: string): IndexDocumentEntry => ({
    ...VALID_ENTRY,
    version,
    // Well-formed enough for indexChannelOf: the pin's shape is what is under test here, not its bytes.
    integrity:
      "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    channels: [
      { kind: "github", url: `https://github.com/o/r/releases/download/v${version}/x.tgz` },
    ],
  });
  // Deliberately out of order: the index is a publisher's array, and the newest row is not
  // necessarily the last one.
  const versions = ["2.0.0", "0.1.0", "1.2.9", "1.4.2", "1.2.0"].map(entry);

  it("no version, or npm's latest, takes the highest the index carries, whatever order it lists", () => {
    expect(selectIndexChannel(versions, undefined).channel?.version).toBe("2.0.0");
    expect(selectIndexChannel(versions, "latest").channel?.version).toBe("2.0.0");
    expect(selectIndexChannel([...versions].reverse(), "latest").channel?.version).toBe("2.0.0");
  });

  it("an exact version (a leading v tolerated) takes the entry that names it", () => {
    expect(selectIndexChannel(versions, "1.2.0").channel?.version).toBe("1.2.0");
    expect(selectIndexChannel(versions, "v1.2.0").channel?.version).toBe("1.2.0");
  });

  it("a caret takes the newest in the same major at or above the request; a tilde, the same minor", () => {
    expect(selectIndexChannel(versions, "^1.2.3").channel?.version).toBe("1.4.2");
    expect(selectIndexChannel(versions, "~1.2.3").channel?.version).toBe("1.2.9");
    expect(selectIndexChannel(versions, "~1.2.3").channel?.version).not.toBe("1.2.0");
  });

  it("a version no entry satisfies refuses, listing what the index carries", () => {
    const resolved = selectIndexChannel(versions, "^1.5.0");
    expect(resolved.channel).toBeNull();
    expect(resolved.fault).toMatch(/no version of it matches \^1\.5\.0/);
    expect(resolved.fault).toMatch(/2\.0\.0, 0\.1\.0, 1\.2\.9, 1\.4\.2, 1\.2\.0/);
  });

  it("any other tag or range refuses rather than guessing what it means", () => {
    const next = selectIndexChannel(versions, "next");
    expect(next.channel).toBeNull();
    expect(next.fault).toMatch(/by version only/);
    expect(selectIndexChannel(versions, "1.x").channel).toBeNull();
  });
});

describe("the published index source", () => {
  it("PENGUIN_PLUGIN_INDEX unset or blank reads the published index, off reads none, a URL replaces it", () => {
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
  const published: IndexDocumentEntry = {
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

  describe("with a published index on a slow or unreachable network", () => {
    const url = "https://registry.example/index.json";
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    /** One read of the listing: no timer moves, so an answer that waited on a source never comes. */
    const read = async (routes: ReturnType<typeof pluginRegistryRoutes>) =>
      (await (await routes.request("/")).json()) as PluginIndexResponse;

    it("lists the builtin entries at once, names it pending, and lists its entries on a read after it answers", async () => {
      let answer!: (res: Response) => void;
      const remote = fakeFetch(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      );
      const routes = pluginRegistryRoutes({ indexUrl: url, fetchImpl: remote.fetch });
      const first = await read(routes);
      expect(withoutIcons(first.plugins)).toEqual(
        withoutIcons(await builtinPluginRegistry().index()),
      );
      expect(first.pending).toEqual([url]);
      expect(first.failures).toEqual([]);

      answer(jsonResponse([published]));
      await vi.advanceTimersByTimeAsync(0); // the fetch lands in the cache
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
      expect(withoutIcons((await read(routes)).plugins)).toEqual(
        withoutIcons(await builtinPluginRegistry().index()),
      );
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

  it("with no published source configured, lists the builtin entries alone, each icon served as an image", async () => {
    const routes = pluginRegistryRoutes({ indexUrl: null });
    const res = await routes.request("/");
    const body = (await res.json()) as PluginIndexResponse;
    const index = await builtinPluginRegistry().index();
    expect(withoutIcons(body.plugins)).toEqual(withoutIcons(index));
    expect(body.failures).toEqual([]);
    expect(body.pending).toEqual([]);
    for (const [i, entry] of body.plugins.entries()) {
      expect(entry.icon, entry.name).toEqual({
        url: expect.stringMatching(/^\/api\/plugins\/registry\/icon\?name=.+&rev=[0-9a-f]{12}$/),
        tint: true,
      });
      const served = await routes.request(entry.icon!.url.replace("/api/plugins/registry", ""));
      expect(served.headers.get("content-type"), entry.name).toBe("image/svg+xml");
      expect(served.headers.get("content-security-policy"), entry.name).toContain("sandbox");
      expect(await served.text(), entry.name).toBe(index[i]!.icon);
    }
  });

  it("lets a package on this machine describe itself over its row, and leaves a row whose package is not here as it is", async () => {
    // A published row that carries only English and no icon, for a package an admin installed
    // into the data root's prefix with its own card and icon.svg; and one installed with
    // neither, which keeps its row's text and the puzzle piece.
    const installedHere: IndexDocumentEntry = {
      ...VALID_ENTRY,
      name: "@example/penguin-plugin-here",
      title: "Old title",
      titleZh: "旧名称",
    };
    const bare: IndexDocumentEntry = { ...VALID_ENTRY, name: "@example/penguin-plugin-bare" };
    const elsewhere: IndexDocumentEntry = { ...VALID_ENTRY, name: "@example/penguin-plugin-away" };
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
        }),
      );
      await writeFile(
        path.join(dir, "ifaces.json"),
        contentTable(installedHere.name, {
          card: {
            title: "Local demo",
            titleZh: "本地示例",
            descriptionZh: "一个示例插件。",
            shortDescription: "Demo.",
            shortDescriptionZh: "示例。",
          },
        }),
      );
      await writeFile(path.join(dir, "icon.png"), PNG);
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
          title: "Local demo",
          titleZh: "本地示例",
          descriptionZh: "一个示例插件。",
          shortDescription: "Demo.",
          shortDescriptionZh: "示例。",
          icon: {
            url: expect.stringMatching(
              /^\/api\/plugins\/registry\/icon\?name=%40example%2Fpenguin-plugin-here&rev=/,
            ),
            tint: false,
          },
        },
        bare,
        elsewhere,
      ]);
      const served = await routes.request(
        body.plugins[0]!.icon!.url.replace("/api/plugins/registry", ""),
      );
      expect(served.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
    } finally {
      await rm(prefix, { recursive: true, force: true });
    }
  });

  it("neither names nor serves the icon of a package on this machine that is not a plain SVG", async () => {
    const entry: IndexDocumentEntry = { ...VALID_ENTRY, name: "@example/penguin-plugin-risky" };
    const prefix = await mkdtemp(path.join(tmpdir(), "penguin-prefix-"));
    try {
      await writeFile(path.join(prefix, "package.json"), '{"name":"prefix","private":true}');
      const dir = path.join(prefix, "node_modules", "@example", "penguin-plugin-risky");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: entry.name, version: "1.0.0" }),
      );
      await writeFile(
        path.join(dir, "ifaces.json"),
        contentTable(entry.name, { card: { shortDescription: "Risky." } }),
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
      const served = await routes.request(`/icon?name=${encodeURIComponent(entry.name)}`);
      expect(served.status).toBe(404);
    } finally {
      await rm(prefix, { recursive: true, force: true });
    }
  });
});
