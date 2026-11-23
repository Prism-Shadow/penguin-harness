/**
 * External built-in plugins (PRFC-0036): `@penguinharness/*` packages published from other
 * repositories, pinned to one exact version by packages/server, packages/cli and
 * packages/desktop, and shipped in the built-in prefix from their locked tarballs
 * (scripts/build-plugins.mjs, scripts/lib/external-plugins.mjs, scripts/lib/plugin-index.mjs) and
 * in the pushed library as published (scripts/library-payload.mjs).
 *
 * Staging into the built-in prefix:
 * - Given packages/server pins an external package and PENGUIN_PLUGIN_TARBALLS holds its locked
 *   tarball, when the prefix is built, the package is in it as published, the prefix's manifest
 *   names it, and the loader reads it as a built-in plugin with its module.
 * - Given the tarball there is not the locked one, the build fails naming both sha512s, tries no
 *   other source, and leaves no prefix in the cache.
 * - Given a prefix was built, a second build is served from the cache without fetching anything;
 *   once the lock pins other bytes, the cached prefix is not reused.
 * - Given no tarball directory, npm supplies the registry's tarball byte for byte.
 * - Given npm cannot supply it, the github channel of the version's index entry does.
 * - Given no source can, the build fails naming what each said and what an offline build needs.
 * - Given the package declares runtime dependencies, the build fails and stages nothing.
 * - Given the package has no code entry, the prefix does not hold it.
 *
 * The pins:
 * - Given the three hosts pin one exact version the lock resolves, nothing is reported; a host
 *   pinning another version, a host not pinning it, a range, and a lock resolving another
 *   version are each reported, and the build refuses a pin it cannot ship.
 * - Given the plugin index registers the locked sha512, nothing is reported; another sha512 or no
 *   entry for the version is reported; an index that cannot be read skips the comparison and
 *   says why.
 *
 * The pushed library:
 * - Given the server depends on an external package, the library carries it as pnpm installed
 *   it, its published ifaces.json included; one shipping no ifaces.json fails the payload.
 */
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import * as tar from "tar";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBuiltinPlugins, stagePrefix } from "../../../scripts/build-plugins.mjs";
import {
  HOST_PACKAGES,
  externalPins,
  pinProblems,
  tarballName,
} from "../../../scripts/lib/external-plugins.mjs";
import { readPnpmLock } from "../../../scripts/lib/locked-prefix.mjs";
import { checkPinsAgainstIndex } from "../../../scripts/lib/plugin-index.mjs";
import { libraryPayload } from "../../../scripts/library-payload.mjs";
import { discoverBuiltinPlugins, readPluginDeclaration } from "../src/plugin/loader.js";
import { fetchFailed, jsonResponse, stubFetch } from "./fixtures/fetch.js";
import { makeTempRoot, removeTempRoot } from "./helpers.js";
import { contentTable, writeClassPackage } from "./plugin-fixtures.js";

const NAME = "@penguinharness/fixture-app";
const VERSION = "0.1.0";
const INDEX_URL = "https://index.test/index.json";
const CHANNEL_URL = "https://releases.test/fixture-app-0.1.0.tgz";

let tmp: string;
beforeEach(async () => {
  tmp = await makeTempRoot();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await removeTempRoot(tmp);
});

const sha512 = (bytes: Buffer): string =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

/**
 * A package tarball the way `npm pack` lays one out (`package/…`), written into `dir` under the
 * name npm gives it: a server module (`FixtureApp`) with a page beside its code, or the files
 * `content` names instead. `manifest` adds to its package.json.
 */
async function packFixture(
  dir: string,
  {
    manifest = {},
    content,
    page = "<h1>fixture</h1>",
  }: {
    manifest?: Record<string, unknown>;
    content?: Record<string, string>;
    page?: string;
  } = {},
): Promise<{ bytes: Buffer; integrity: string }> {
  const stage = path.join(tmp, `stage-${Math.random().toString(36).slice(2)}`);
  const pkg = path.join(stage, "package");
  if (content === undefined) {
    await writeClassPackage(pkg, { name: NAME, module: "FixtureApp" });
    await mkdir(path.join(pkg, "ui"), { recursive: true });
    await writeFile(path.join(pkg, "ui", "index.html"), page);
  } else {
    for (const [rel, body] of Object.entries(content)) {
      await mkdir(path.dirname(path.join(pkg, rel)), { recursive: true });
      await writeFile(path.join(pkg, rel), body);
    }
  }
  const own = JSON.parse(await readFile(path.join(pkg, "package.json"), "utf8").catch(() => "{}"));
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ ...own, name: NAME, version: VERSION, ...manifest }),
  );
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, tarballName({ name: NAME, version: VERSION }));
  await tar.c({ gzip: true, file, cwd: stage, portable: true }, ["package"]);
  const bytes = await readFile(file);
  return { bytes, integrity: sha512(bytes) };
}

/**
 * A checkout as the build reads it: the three hosts' package.json, each pinning the fixture at
 * `ranges[host]` (VERSION unless named; undefined = not pinned) beside a workspace plugin, and a
 * pnpm-lock.yaml resolving each pin to `locked` with `integrity`. Written over the last one, so
 * the build cache under it survives.
 */
async function checkout(
  integrity: string,
  {
    ranges = {},
    locked = VERSION,
    asset,
  }: { ranges?: Record<string, string | undefined>; locked?: string; asset?: string } = {},
): Promise<string> {
  const root = path.join(tmp, "checkout");
  const importers: Record<string, unknown> = {};
  for (const host of HOST_PACKAGES) {
    const range = host in ranges ? ranges[host] : VERSION;
    const pinned = range === undefined ? {} : { [NAME]: range };
    await mkdir(path.join(root, host), { recursive: true });
    await writeFile(
      path.join(root, host, "package.json"),
      JSON.stringify({
        name: host,
        dependencies: { "@penguinharness/goal": "workspace:*", ...(asset ? {} : pinned) },
        ...(asset ? { devDependencies: pinned } : {}),
      }),
    );
    importers[host] = {
      dependencies: {
        "@penguinharness/goal": { specifier: "workspace:*", version: "link:../../plugins/goal" },
        ...(range === undefined || asset ? {} : { [NAME]: { specifier: range, version: locked } }),
      },
      ...(asset && range
        ? { devDependencies: { [NAME]: { specifier: range, version: locked } } }
        : {}),
    };
  }
  await writeFile(
    path.join(root, "pnpm-lock.yaml"),
    JSON.stringify({
      lockfileVersion: "9.0",
      importers,
      packages: {
        [`${NAME}@${locked}`]: {
          ...(asset && { version: VERSION }),
          resolution: { integrity, ...(asset && { tarball: asset }) },
        },
      },
    }),
  );
  return root;
}

/** The prefix a build staged, written out the way the desktop build and a release stage it. */
async function staged(built: Awaited<ReturnType<typeof buildBuiltinPlugins>>) {
  const prefix = path.join(tmp, `prefix-${Math.random().toString(36).slice(2)}`);
  await stagePrefix(built, prefix);
  return {
    bases: [{ file: path.join(prefix, "package.json"), builtin: true }],
    page: () =>
      readFile(path.join(prefix, "node_modules", ...NAME.split("/"), "ui", "index.html"), "utf8"),
  };
}

/**
 * The environment npm runs in for a test: its registry, cache and config files all the test's
 * own, no proxy, no retries — and `offline` for an npm that can supply nothing.
 */
function npmEnv(registry: string, offline = false): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(npm_config_|https?_proxy$|PENGUIN_PLUGIN_)/i.test(key)) delete env[key];
  }
  return {
    ...env,
    npm_config_registry: registry,
    npm_config_cache: path.join(tmp, "npm-cache"),
    // Neither exists: npm then reads no config file of the machine's.
    npm_config_userconfig: path.join(tmp, "user-npmrc"),
    npm_config_globalconfig: path.join(tmp, "global-npmrc"),
    npm_config_fetch_retries: "0",
    npm_config_update_notifier: "false",
    npm_config_noproxy: "127.0.0.1,localhost",
    ...(offline ? { npm_config_offline: "true" } : {}),
  };
}

describe("an external built-in plugin in the built-in prefix", () => {
  it("is staged from its locked tarball in PENGUIN_PLUGIN_TARBALLS and loads as built in", async () => {
    const tarballs = path.join(tmp, "tarballs");
    const { integrity } = await packFixture(tarballs);
    const root = await checkout(integrity);

    const built = await buildBuiltinPlugins({ root, env: { PENGUIN_PLUGIN_TARBALLS: tarballs } });

    expect(built.plugins).toEqual([{ name: NAME, version: VERSION }]);
    const { bases, page } = await staged(built);
    expect(await discoverBuiltinPlugins(bases)).toEqual([NAME]);
    expect(await readPluginDeclaration(NAME, bases)).toEqual({
      modules: ["FixtureApp"],
      replaces: [],
      builtin: true,
    });
    expect(await page()).toBe("<h1>fixture</h1>");
  });

  it("fails on a tarball that is not the locked one, tries nothing else, and caches nothing", async () => {
    const { integrity } = await packFixture(path.join(tmp, "locked"));
    const tarballs = path.join(tmp, "tarballs");
    const other = await packFixture(tarballs, { page: "<h1>tampered</h1>" });
    const root = await checkout(integrity);

    const build = buildBuiltinPlugins({ root, env: { PENGUIN_PLUGIN_TARBALLS: tarballs } });

    await expect(build).rejects.toThrow(
      `from PENGUIN_PLUGIN_TARBALLS (${path.join(tarballs, tarballName({ name: NAME, version: VERSION }))}) is not the locked tarball: its sha512 is ${other.integrity}, pnpm-lock.yaml pins ${integrity}`,
    );
    expect(await readdir(path.join(root, "node_modules", ".cache", "penguin-plugins"))).toEqual([]);
  });

  it("is served from the cache until the lock pins other bytes", async () => {
    const tarballs = path.join(tmp, "tarballs");
    const first = await packFixture(tarballs);
    const root = await checkout(first.integrity);
    const built = await buildBuiltinPlugins({ root, env: { PENGUIN_PLUGIN_TARBALLS: tarballs } });

    // No source at all: anything that fetched would fail.
    const again = await buildBuiltinPlugins({ root, env: {} });
    expect(again.dir).toBe(built.dir);

    const second = await packFixture(tarballs, { page: "<h1>next</h1>" });
    await checkout(second.integrity);
    const rebuilt = await buildBuiltinPlugins({ root, env: { PENGUIN_PLUGIN_TARBALLS: tarballs } });
    expect(rebuilt.dir).not.toBe(built.dir);
    expect(await (await staged(rebuilt)).page()).toBe("<h1>next</h1>");
  });

  describe("from npm's registry", () => {
    let server: Server;
    let registry: string;
    let tarball: Buffer = Buffer.alloc(0);
    const requested: string[] = [];
    beforeAll(async () => {
      server = createServer((req, res) => {
        const url = decodeURIComponent(req.url ?? "");
        requested.push(url);
        if (url === `/${NAME}`) {
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              name: NAME,
              "dist-tags": { latest: VERSION },
              versions: {
                [VERSION]: {
                  name: NAME,
                  version: VERSION,
                  dist: {
                    tarball: `${registry}tarballs/fixture-app-${VERSION}.tgz`,
                    integrity: sha512(tarball),
                    shasum: createHash("sha1").update(tarball).digest("hex"),
                  },
                },
              },
            }),
          );
        } else if (url === `/tarballs/fixture-app-${VERSION}.tgz`) {
          res.end(tarball);
        } else {
          res.statusCode = 404;
          res.end("{}");
        }
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it("takes the registry's tarball when no directory holds one, byte for byte", async () => {
      const published = await packFixture(path.join(tmp, "published"));
      tarball = published.bytes;
      const root = await checkout(published.integrity);
      const index = stubFetch(() => {
        throw fetchFailed("ENOTFOUND");
      });

      const built = await buildBuiltinPlugins({
        root,
        env: { ...npmEnv(registry), PENGUIN_PLUGIN_INDEX_URL: INDEX_URL },
      });

      expect(built.plugins).toEqual([{ name: NAME, version: VERSION }]);
      expect(requested).toContain(`/tarballs/fixture-app-${VERSION}.tgz`);
      expect(index.calls).toEqual([]);
      expect(await (await staged(built)).page()).toBe("<h1>fixture</h1>");
    });
  });

  it("builds a GitHub-only release from the exact asset and rejects a mismatched lock or package", async () => {
    const asset =
      "https://github.com/owner/repo/releases/download/v2026.11.23-rc.1/fixture-app-0.1.0.tgz";
    const ranges = Object.fromEntries(HOST_PACKAGES.map((host) => [host, asset]));
    const { bytes, integrity } = await packFixture(path.join(tmp, "release"));
    const root = await checkout(integrity, { locked: asset, ranges, asset });
    const lock = readPnpmLock(root);
    expect(pinProblems(root, lock)).toEqual([]);
    expect(externalPins(root, lock)).toEqual([{ name: NAME, version: VERSION, integrity, asset }]);
    const release = stubFetch(() => new Response(new Uint8Array(bytes)));
    const env = npmEnv("http://127.0.0.1:9/", true);
    const built = await buildBuiltinPlugins({ root, env });
    expect(await (await staged(built)).page()).toBe("<h1>fixture</h1>");
    expect(release.calls.map((call) => call.url)).toEqual([asset]);
    const wrong = await checkout(integrity, { locked: asset, ranges, asset: asset + ".changed" });
    expect(pinProblems(wrong, readPnpmLock(wrong))).not.toEqual([]);
    const other = await packFixture(path.join(tmp, "other"), { manifest: { version: "3.0.0" } });
    stubFetch(() => new Response(new Uint8Array(other.bytes)));
    await checkout(other.integrity, { locked: asset, ranges, asset });
    await expect(buildBuiltinPlugins({ root, env })).rejects.toThrow("the asset contains");
  });

  it("takes the github channel of its index entry when npm cannot supply it", async () => {
    const { bytes, integrity } = await packFixture(path.join(tmp, "released"));
    const root = await checkout(integrity);
    const fake = stubFetch((call) =>
      call.url === INDEX_URL
        ? jsonResponse([
            {
              name: NAME,
              version: VERSION,
              description: "Fixture.",
              authors: ["Fixture"],
              license: "Apache-2.0",
              integrity,
              channels: [{ kind: "npm" }, { kind: "github", url: CHANNEL_URL }],
            },
          ])
        : new Response(new Uint8Array(bytes)),
    );

    const env = { ...npmEnv("http://127.0.0.1:9/", true), PENGUIN_PLUGIN_INDEX_URL: INDEX_URL };
    const built = await buildBuiltinPlugins({ root, env });

    expect(built.plugins).toEqual([{ name: NAME, version: VERSION }]);
    expect(fake.calls.map((c) => c.url)).toEqual([INDEX_URL, CHANNEL_URL]);
  });

  it("fails naming every source and the offline remedy when none can supply it", async () => {
    const { integrity } = await packFixture(path.join(tmp, "nowhere"));
    const root = await checkout(integrity);
    const empty = path.join(tmp, "empty");
    await mkdir(empty);
    stubFetch(() => {
      throw fetchFailed("ENOTFOUND");
    });
    const env = {
      ...npmEnv("http://127.0.0.1:9/", true),
      PENGUIN_PLUGIN_TARBALLS: empty,
      PENGUIN_PLUGIN_INDEX_URL: INDEX_URL,
    };

    const failure = await buildBuiltinPlugins({ root, env }).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(Error);
    const lines = (failure as Error).message.split("\n");
    expect(lines[0]).toBe(`no source supplied ${NAME}@${VERSION} (${integrity}):`);
    expect(lines[1]).toBe(
      `  PENGUIN_PLUGIN_TARBALLS: no ${tarballName({ name: NAME, version: VERSION })} in ${empty}`,
    );
    expect(lines[2]).toMatch(/^ {2}npm: code ENOTCACHED/);
    expect(lines[3]).toBe("  github channel: fetch failed");
    expect(lines[4]).toContain(`npm cache add ${NAME}@${VERSION}`);
  });

  it("refuses a package that declares runtime dependencies", async () => {
    const tarballs = path.join(tmp, "tarballs");
    const { integrity } = await packFixture(tarballs, {
      manifest: { dependencies: { "left-pad": "^1.3.0" } },
    });
    const root = await checkout(integrity);

    const build = buildBuiltinPlugins({ root, env: { PENGUIN_PLUGIN_TARBALLS: tarballs } });

    await expect(build).rejects.toThrow(
      `${NAME}@${VERSION} declares runtime dependencies left-pad: an external built-in plugin bundles what it runs`,
    );
  });

  it("leaves a package without a code entry to the library", async () => {
    const tarballs = path.join(tmp, "tarballs");
    const { integrity } = await packFixture(tarballs, {
      content: { "skills/fixture-skill/SKILL.md": "---\nname: fixture-skill\n---\n" },
    });
    const root = await checkout(integrity);

    const built = await buildBuiltinPlugins({ root, env: { PENGUIN_PLUGIN_TARBALLS: tarballs } });

    expect(built.plugins).toEqual([]);
    expect(built.files).toEqual(["package.json"]);
  });
});

describe("the three hosts' pins", () => {
  it("one exact version in every host, resolved by the lock, reports nothing", async () => {
    const root = await checkout("sha512-AAAA");
    expect(pinProblems(root, readPnpmLock(root))).toEqual([]);
  });

  it.each([
    [
      "a host pinning another version",
      { "packages/cli": "0.1.1" },
      `${NAME} is pinned to different versions: packages/server 0.1.0, packages/cli 0.1.1, packages/desktop 0.1.0`,
    ],
    [
      "a host not pinning it",
      { "packages/desktop": undefined },
      `${NAME} is pinned in packages/server, packages/cli but not in packages/desktop: the hosts ship it together`,
    ],
    [
      "a range",
      { "packages/server": "^0.1.0", "packages/cli": "^0.1.0", "packages/desktop": "^0.1.0" },
      `packages/server names ${NAME} "^0.1.0": an external built-in plugin is pinned to one exact version`,
    ],
  ])("reports %s", async (_case, ranges, problem) => {
    const root = await checkout("sha512-AAAA", { ranges });
    expect(pinProblems(root, readPnpmLock(root))).toContain(problem);
  });

  it("reports a lock resolving another version, and the build refuses to ship that pin", async () => {
    const root = await checkout("sha512-AAAA", { locked: "0.0.9" });
    const lock = readPnpmLock(root);
    const problem = `pnpm-lock.yaml resolves ${NAME} for packages/server to 0.0.9, not 0.1.0: run pnpm install`;
    expect(pinProblems(root, lock)).toContain(problem);
    expect(() => externalPins(root, lock)).toThrow(problem);
  });
});

describe("the lock against the plugin index", () => {
  const pin = { name: NAME, version: VERSION, integrity: "sha512-AAAA" };
  const entry = (fields: Record<string, unknown>) => ({
    name: NAME,
    version: VERSION,
    description: "Fixture.",
    authors: ["Fixture"],
    license: "Apache-2.0",
    ...fields,
  });

  it.each([
    ["registers the locked sha512", [entry({ integrity: "sha512-AAAA" })], []],
    [
      "registers another sha512",
      [entry({ integrity: "sha512-BBBB" })],
      [
        `${NAME}@${VERSION}: pnpm-lock.yaml pins sha512-AAAA, the plugin index registers sha512-BBBB`,
      ],
    ],
    [
      "has no entry for the version",
      [entry({ version: "0.0.9", integrity: "sha512-AAAA" })],
      [
        `${NAME}@${VERSION} has no entry in the plugin index: register that version before the build pins it`,
      ],
    ],
  ])("an index that %s", async (_case, index, problems) => {
    stubFetch(() => jsonResponse(index));
    expect(await checkPinsAgainstIndex([pin], INDEX_URL)).toEqual({ problems });
  });

  it("an index that cannot be read skips the comparison and says why", async () => {
    stubFetch(() => {
      throw fetchFailed("ENOTFOUND");
    });
    expect(await checkPinsAgainstIndex([pin], INDEX_URL)).toEqual({ skipped: "fetch failed" });
  });
});

describe("the pushed library", () => {
  /** A checkout whose server depends on the fixture, installed with `files`. */
  async function installed(files: Record<string, string>): Promise<string> {
    const root = path.join(tmp, "library-checkout");
    const server = path.join(root, "packages", "server");
    await mkdir(server, { recursive: true });
    await writeFile(
      path.join(server, "package.json"),
      JSON.stringify({ name: "server", dependencies: { [NAME]: VERSION } }),
    );
    const dir = path.join(server, "node_modules", ...NAME.split("/"));
    for (const [rel, body] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await writeFile(path.join(dir, rel), body);
    }
    return root;
  }
  const SKILL = { "skills/fixture-skill/SKILL.md": "---\nname: fixture-skill\n---\n" };

  it("carries an external package as pnpm installed it, its published table included", async () => {
    const root = await installed({
      "package.json": JSON.stringify({ name: NAME, version: VERSION }),
      "ifaces.json": contentTable(NAME, { skills: ["fixture-skill"] }),
      ...SKILL,
    });

    const payload = await libraryPayload(root);
    try {
      const at = `library/node_modules/${NAME}`;
      expect(payload.names).toEqual(["fixture-app"]);
      expect(payload.entries.map((e) => e.rel).sort()).toEqual([
        `${at}/ifaces.json`,
        `${at}/package.json`,
        `${at}/skills/fixture-skill/SKILL.md`,
        "library/package.json",
      ]);
      const manifest = payload.entries.find((e) => e.rel === "library/package.json")!;
      expect(JSON.parse(await readFile(manifest.abs, "utf8"))).toMatchObject({
        dependencies: { [NAME]: "*" },
      });
    } finally {
      await payload.cleanup();
    }
  });

  it("refuses an external package that ships no ifaces.json", async () => {
    const root = await installed({
      "package.json": JSON.stringify({ name: NAME, version: VERSION }),
      ...SKILL,
    });
    await expect(libraryPayload(root)).rejects.toThrow(`${NAME} ships no ifaces.json`);
  });
});
