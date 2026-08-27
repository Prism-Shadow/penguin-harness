/**
 * Extension registry tests: the shared index format (strict whole-document validation —
 * one malformed row fails the artifact, unlike extensions.json's per-entry tolerance),
 * the builtin registry serving the embedded four sandbox backends, the HTTP registry
 * running a fetched document through the same validator (fetch stubbed, no network),
 * and GET /api/extensions behind the auth gate.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionIndexEntry, ExtensionIndexResponse } from "../src/api/types.js";
import { BUILTIN_READMES } from "../src/extension/builtin-readmes.js";
import {
  BUILTIN_REGISTRY_SOURCE,
  builtinExtensionRegistry,
  httpExtensionRegistry,
  parseExtensionIndex,
} from "../src/extension/registry.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const VALID_ENTRY: ExtensionIndexEntry = {
  name: "@example/penguin-extension-demo",
  version: "1.0.0",
  description: "A demo extension.",
  authors: ["Example"],
  license: "MIT",
};

describe("parseExtensionIndex", () => {
  it("accepts a flat array of per-version entries and preserves order", () => {
    const doc = [
      VALID_ENTRY,
      { ...VALID_ENTRY, version: "1.1.0", keywords: ["linux"], updatedAt: 1755600000 },
    ];
    const parsed = parseExtensionIndex(doc, "test");
    expect(parsed.map((e) => e.version)).toEqual(["1.0.0", "1.1.0"]);
  });

  it("rejects a non-array document and names the source", () => {
    expect(() => parseExtensionIndex({ extensions: [] }, "https://x.example/index.json")).toThrow(
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
      expect(() => parseExtensionIndex([VALID_ENTRY, bad], "test")).toThrow(
        /malformed entry at index 1/,
      );
    }
  });
});

describe("builtinExtensionRegistry", () => {
  it("serves the four sandbox backends, valid under the shared format", async () => {
    const registry = builtinExtensionRegistry();
    expect(registry.source).toBe(BUILTIN_REGISTRY_SOURCE);
    const entries = await registry.index();
    expect(entries.map((e) => e.name)).toEqual([
      "@prismshadow/penguin-extension-sandbox-bwrap",
      "@prismshadow/penguin-extension-sandbox-seatbelt",
      "@prismshadow/penguin-extension-sandbox-mxc",
      "@prismshadow/penguin-extension-sandbox-dsh",
    ]);
    for (const entry of entries) {
      expect(entry.categories).toEqual(["sandbox"]);
      expect(entry.license).toBe("Apache-2.0");
    }
  });
});

describe("httpExtensionRegistry", () => {
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
    const entries = await httpExtensionRegistry(url, fetchImpl).index();
    expect(seen).toEqual([url]);
    expect(entries).toEqual([VALID_ENTRY]);
  });

  it("fails on an HTTP error status, on non-JSON, and on a malformed document", async () => {
    const respond =
      (body: string, status = 200) =>
      async () =>
        new Response(body, { status });
    await expect(httpExtensionRegistry(url, respond("[]", 503)).index()).rejects.toThrow(
      /HTTP 503/,
    );
    await expect(httpExtensionRegistry(url, respond("not json")).index()).rejects.toThrow(
      /not valid JSON/,
    );
    await expect(httpExtensionRegistry(url, respond('{"extensions":[]}')).index()).rejects.toThrow(
      /not an array/,
    );
  });
});

describe("GET /api/extensions", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("requires auth, then serves the builtin index", async () => {
    expect((await t.app.request("/api/extensions")).status).toBe(401);

    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/extensions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExtensionIndexResponse;
    expect(body.extensions).toHaveLength(4);
    expect(body.extensions.every((p) => p.name.startsWith("@prismshadow/penguin-extension-"))).toBe(
      true,
    );
  });
});

describe("extension readmes", () => {
  /**
   * The detail page's whole content. A listed entry with no readme renders an empty page,
   * which is a gap nobody sees until they click it — so the pairing is pinned here rather
   * than left to whoever adds the next backend.
   */
  it("every builtin entry has one", async () => {
    const registry = builtinExtensionRegistry();
    for (const entry of await registry.index()) {
      const readme = await registry.readme(entry.name);
      expect(readme, `${entry.name} has no readme`).not.toBeNull();
      expect(readme).toContain("#");
    }
  });

  it("an unlisted name has none, rather than an invented one", async () => {
    expect(await builtinExtensionRegistry().readme("@someone/not-listed")).toBeNull();
  });

  /**
   * A remote index cannot describe where its readmes live yet, so the HTTP registry
   * answers null instead of guessing a URL and rendering whatever replied.
   */
  it("a remote registry offers none", async () => {
    expect(
      await httpExtensionRegistry("https://example.invalid/index.json").readme("x"),
    ).toBeNull();
  });
});

describe("the builtin catalogue and the packages it lists", () => {
  /**
   * The index asserts a name, version, description and license for four packages that live
   * beside it in this workspace, and their readmes are those packages' own README.md files.
   * None of that is enforced by anything the packages do, so it is asserted here: the listing
   * is the string an operator copies into `extensions.json`, and a catalogue that describes
   * its entries wrongly is worse than one that omits them.
   */
  const EXTENSIONS_DIR = fileURLToPath(new URL("../../../extensions/", import.meta.url));

  interface PackageManifest {
    name: string;
    version: string;
    description?: string;
    license?: string;
    files?: string[];
  }

  const packages = new Map<string, { dir: string; manifest: PackageManifest }>();
  for (const dir of readdirSync(EXTENSIONS_DIR)) {
    // A worktree can hold a directory a build left behind; only a real package counts.
    if (!existsSync(`${EXTENSIONS_DIR}${dir}/package.json`)) continue;
    const manifest = JSON.parse(
      readFileSync(`${EXTENSIONS_DIR}${dir}/package.json`, "utf8"),
    ) as PackageManifest;
    packages.set(manifest.name, { dir, manifest });
  }

  it("names each package as that package names itself", async () => {
    for (const entry of await builtinExtensionRegistry().index()) {
      const pkg = packages.get(entry.name);
      expect(pkg, `${entry.name} is listed but is no package in extensions/`).toBeDefined();
      expect(pkg!.manifest.version, entry.name).toBe(entry.version);
      expect(pkg!.manifest.description, entry.name).toBe(entry.description);
      expect(pkg!.manifest.license, entry.name).toBe(entry.license);
    }
  });

  it("serves each package's own README.md, and ships it in the package", async () => {
    const registry = builtinExtensionRegistry();
    for (const entry of await registry.index()) {
      const pkg = packages.get(entry.name)!;
      const own = readFileSync(`${EXTENSIONS_DIR}${pkg.dir}/README.md`, "utf8");
      expect(await registry.readme(entry.name), entry.name).toBe(own);
      expect(pkg.manifest.files, `${entry.name} would publish without its readme`).toContain(
        "README.md",
      );
    }
  });

  it("carries no readme for anything it does not list", async () => {
    const listed = new Set((await builtinExtensionRegistry().index()).map((e) => e.name));
    for (const name of Object.keys(BUILTIN_READMES)) {
      expect(listed.has(name), `${name} has a readme but no listing`).toBe(true);
    }
  });
});

describe("GET /api/extensions/readme", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("requires auth, then serves a listed entry's readme", async () => {
    const name = "@prismshadow/penguin-extension-sandbox-bwrap";
    const path = `/api/extensions/readme?name=${encodeURIComponent(name)}`;
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
      "/api/extensions/readme?name=" + encodeURIComponent("@someone/not-listed"),
    );
    expect(res.status).toBe(404);
  });

  it("requires the name", async () => {
    const admin = await loginAdmin(t.app);
    expect((await apiClient(t.app, admin.cookie).get("/api/extensions/readme")).status).toBe(400);
  });
});
