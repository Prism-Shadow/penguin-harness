/**
 * Installing plugins on a machine with no npm — the desktop app's server runs under Electron's
 * utilityProcess, with no npm beside it — for packages that need nothing npm does
 * (plugin/packages.ts choosing plugin/direct-install.ts). The registry, the index and the
 * release assets are the suite's fetch fake; npm, where a scenario has one, is a stand-in.
 *
 * Through the installed-plugins routes, on an app whose installer finds no npm:
 * - When an admin installs a plugin with no dependencies by name, it is read from the
 *   registry, verified, placed and listed in the library, and the prefix records `^<version>`;
 *   npm never runs.
 * - When the admin then removes it, its directory and its record go, without npm.
 * - When the registry does not have the name, the published index's release channel answers:
 *   the asset is verified, placed and kept in `archives/`, which the prefix records; when neither
 *   has it, the refusal says the package is not published on the registry's host, not as npm's.
 * - When the registry does not answer and the build carries an offline archive of the name, the
 *   archive is placed and recorded as `file:archives/…`; npm never runs.
 * - A plugin with dependencies is refused before its tarball is fetched; the refusal names the
 *   dependency and how to get npm, does not read as npm's own, and nothing lands.
 * - A package the registry serves that is no plugin is taken out again, and the refusal does
 *   not claim that install scripts ran: none did.
 * - A zip of a plugin with no dependencies installs what its `files` field publishes, packed
 *   into `archives/` and recorded the way npm records an uploaded tarball.
 * - A zip of a plugin with dependencies is refused, and nothing lands.
 * - A prefix package.json that will not parse answers 400 `plugin_install_failed`, not a 500.
 * With npm on the machine:
 * - A plugin with no dependencies still installs through npm, and the server never reads the
 *   registry itself.
 *
 * The installer itself, on a temp data root:
 * - An address serving tampered bytes is passed over for the mirror that serves the pinned
 *   ones; when every address is tampered the install is refused and nothing is placed.
 * - A tarball past the download cap, declared or streamed, is refused; so is one that unpacks
 *   past its cap.
 * - An entry that climbs out of the package, is absolute, or carries a backslash or a colon
 *   refuses the whole tarball: nothing is written, inside the prefix or out.
 * - Symbolic links, hard links and devices in a tarball are never created; its files land.
 * - An upgrade replaces the installed version whole, records the new range and leaves no
 *   staging behind; a refused upgrade leaves the installed version as it was.
 * - Two installs at once both land, and the prefix's package.json records both.
 * - Staging left over from more than an hour ago is swept at the next install; a fresh one is not.
 * - An address that never answers costs its window, and the next address answers.
 * - A registry that refuses (403) is the answer: no mirror is asked, and the refusal says why.
 * - Install scripts, a dependency, binding.gyp or an `os` excluding this machine refuse;
 *   `prepare` alone and an optional peer do not.
 * - A tarball whose package.json names another version, or carries no package.json, is refused.
 * - An address that answers something other than the package's document (unreachable, a
 *   server error, a page that is not JSON, another package's document, a body that breaks off)
 *   hands the walk to the mirror; when no address answers, the refusal names each.
 * - A version or a name the registry does not have ("unavailable", so the index's channel may
 *   answer), a spec that is no package name, and a link refuse (a link needs npm); a tarball
 *   named over plain http off this machine refuses, one on the loopback is fetched; a version
 *   that pins no sha512 refuses.
 * - A release channel whose sha512 is unreadable, or whose every address fails, refuses.
 * - A zip installs exactly what `npm pack` would publish from it (the cases npm itself was
 *   asked about): `.npmignore`, else `.gitignore`, nested ones too, npm's always-ignored names,
 *   `files`, the always-included names and every `bin` target — in the prefix and in the
 *   `archives/` tarball alike, so a git-ignored `.env` never lands.
 * - A release channel's asset is kept in `archives/` and recorded as `file:archives/…`, so a
 *   later real npm run installs from disk, offline, without the release URL.
 * - What the tarball's own package.json says is checked after the download as well: its
 *   dependencies, install scripts or `binding.gyp` refuse it even when the registry's document
 *   did not; `binding.gyp` beside `gypfile: false` does not.
 * - Every `bin` target is left executable.
 * - A redirect to https on another host is followed; one down to plain http is not; an address
 *   with credentials that only looks local is never fetched.
 * - A rename briefly refused (EBUSY) is tried again and the install lands; when the new version
 *   cannot be put in place nor the old one moved back, the old one is kept where it is, the
 *   refusal says where, and the sweep leaves it.
 * - A prefix package.json that will not parse, and staging that cannot be written, refuse in
 *   words (a 400 from the route), never a raw error.
 * - A directory that cannot be moved (something holds it) refuses an upgrade and leaves the
 *   installed version as it was.
 * - With npm on the machine, every operation (a name, a zip, a channel, a removal) goes to npm,
 *   and nothing is fetched.
 * - Removing a name never installed, from a prefix never created, is not an error.
 * - The tarball reader: a plain tar, pax and GNU long names, a global header, GNU's magic and
 *   base-256 sizes read; a global header's size applies to later entries, a lone zero block is
 *   passed over, a GNU long name read after a pax path wins, a pending pax size never applies
 *   to a long-name record, an old-style file entry ending in "/" is a directory; a corrupt
 *   gzip, a broken checksum, a truncated entry or end, too many files, a plain tar past its
 *   cap, a file that is also a directory and names equal but for case or Unicode refuse.
 * - Where a package may install: npm's `os` / `cpu` / `libc` lists.
 * - Which version a spec picks from the registry's document, and what the prefix records.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { InstalledPluginsResponse, PluginLibraryResponse } from "../src/api/types.js";
import {
  installChannel,
  installFromRegistry,
  OFFICIAL_REGISTRY,
} from "../src/plugin/direct-install.js";
import type { WithoutNpm } from "../src/plugin/direct-install.js";
import {
  locateNpm,
  npm as realNpm,
  PluginInstallError,
  type NpmRun,
} from "../src/plugin/install.js";
import { platformRefusal } from "../src/plugin/npm-requirement.js";
import { NpmPluginPackages } from "../src/plugin/packages.js";
import { placePackage, type PrefixOps } from "../src/plugin/prefix-place.js";
import type { PluginProxyRule } from "../src/plugin/registry.js";
import { readPackageTarball, TarballError } from "../src/plugin/tarball.js";
import { pickRegistryVersion, savedRange } from "../src/plugin/version-pick.js";
import {
  fakeFetch,
  fetchFailed,
  jsonResponse,
  stubFetch,
  type FetchFake,
} from "./fixtures/fetch.js";
import { NPM_PACK_CASES } from "./fixtures/npm-pack-cases.js";
import { integrityOf, packageTarball, tarball, type TarEntry } from "./fixtures/npm-tarball.js";
import { contentTable } from "./plugin-fixtures.js";
import { apiClient, createTestApp, loginAdmin, type TestApp } from "./helpers.js";

type Files = Record<string, string | Uint8Array>;

/** A built plugin of Skills, `name@version`, as the files of its package directory. */
function skillsPlugin(
  name: string,
  version: string,
  manifest: Record<string, unknown> = {},
): Files {
  return {
    "package.json": JSON.stringify({ name, version, description: "Take notes.", ...manifest }),
    "ifaces.json": contentTable(name, { card: { title: "Notes" }, skills: ["notes"] }),
    "skills/notes/SKILL.md": `---\nname: notes\ndescription: Take notes.\nversion: 2026.11.19.1\n---\n\nBody.\n`,
  };
}

/** A version on the fake registry: its files, the manifest fields its document entry adds, its tarball's bytes. */
interface Published {
  files: Files;
  manifest?: Record<string, unknown>;
  tarball?: Uint8Array;
}

const tarballUrl = (registry: string, name: string, version: string) =>
  `${registry}/${name}/-/${name.slice(name.lastIndexOf("/") + 1)}-${version}.tgz`;

/**
 * The routes a fake registry answers: each package's abbreviated document, and each version's
 * tarball. `answer` overrides a URL (a tampered mirror, a dead address); anything unrouted
 * fails like a host that does not resolve.
 */
function registryRoutes(
  registry: string,
  packages: Record<string, Record<string, Published>>,
): Map<string, () => Response | Promise<Response>> {
  const routes = new Map<string, () => Response | Promise<Response>>();
  for (const [name, versions] of Object.entries(packages)) {
    const entries: Record<string, unknown> = {};
    for (const [version, published] of Object.entries(versions)) {
      const bytes = published.tarball ?? packageTarball(published.files);
      const url = tarballUrl(registry, name, version);
      routes.set(url, () => new Response(bytes));
      const own = JSON.parse(String(published.files["package.json"])) as Record<string, unknown>;
      entries[version] = {
        ...own,
        ...published.manifest,
        name,
        version,
        dist: { tarball: url, integrity: integrityOf(bytes) },
      };
    }
    const latest = Object.keys(versions).at(-1)!;
    routes.set(`${registry}/${name.replace("/", "%2f")}`, () =>
      jsonResponse({ name, "dist-tags": { latest }, versions: entries }),
    );
  }
  return routes;
}

/** The fetch fake answering `routes`; an unrouted URL is a host that does not resolve. */
function serving(routes: Map<string, () => Response | Promise<Response>>): FetchFake {
  return fakeFetch((call) => {
    const route = routes.get(call.url);
    if (route === undefined) throw fetchFailed("ENOTFOUND");
    return route();
  });
}

const NO_NPM_NOTES = [
  "no npm beside this node (/opt/app/lib/node_modules/npm/bin/npm-cli.js)",
  "no npm on PATH",
];

/** npm, which must not run: every call is counted and fails. */
function forbiddenNpm(): { runs: string[][]; run: NpmRun } {
  const runs: string[][] = [];
  return {
    runs,
    run: async (_prefix, args) => {
      runs.push([...args]);
      throw new Error("npm must not run on a machine without npm");
    },
  };
}

const roots: string[] = [];
const tempRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-no-npm-"));
  roots.push(root);
  return root;
};
afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const prefixOf = (root: string) => path.join(root, "plugins");
/** A package's files as the placer takes them: bytes, none executable. */
const filesOf = (files: Files) =>
  new Map(
    Object.entries(files).map(([rel, v]) => [
      rel,
      { data: typeof v === "string" ? strToU8(v) : v, executable: false },
    ]),
  );
const installedDir = (root: string, name: string) =>
  path.join(prefixOf(root), "node_modules", ...name.split("/"));
const prefixDeps = async (root: string) =>
  (
    JSON.parse(await fs.readFile(path.join(prefixOf(root), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    }
  ).dependencies ?? {};
const present = (at: string) =>
  fs.lstat(at).then(
    () => true,
    () => false,
  );
const installedVersion = async (root: string, name: string) =>
  (
    JSON.parse(await fs.readFile(path.join(installedDir(root, name), "package.json"), "utf8")) as {
      version: string;
    }
  ).version;

const zip = (files: Files) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v]),
      ),
    ),
  ).toString("base64");

describe("the installed-plugins routes on a machine without npm", () => {
  const INDEX = "https://index.example/index.json";
  const RELEASE =
    "https://releases.example/acme/channels/releases/download/v1.0.0/channels-1.0.0.tgz";
  const channelAsset = packageTarball(skillsPlugin("@acme/channels", "1.0.0"));
  const routes = registryRoutes(OFFICIAL_REGISTRY, {
    "@acme/notes": { "1.0.0": { files: skillsPlugin("@acme/notes", "1.0.0") } },
    "@acme/bare": {
      "1.0.0": {
        files: { "package.json": JSON.stringify({ name: "@acme/bare", version: "1.0.0" }) },
      },
    },
    "@acme/heavy": {
      "1.0.0": {
        files: skillsPlugin("@acme/heavy", "1.0.0", { dependencies: { "left-pad": "^1.3.0" } }),
      },
    },
  });
  routes.set(INDEX, () =>
    jsonResponse([
      {
        name: "@acme/channels",
        version: "1.0.0",
        description: "the package the channel serves",
        authors: ["acme"],
        license: "MIT",
        integrity: integrityOf(channelAsset),
        channels: [{ kind: "github", url: RELEASE }],
      },
    ]),
  );
  routes.set(RELEASE, () => new Response(channelAsset));
  routes.set(`${OFFICIAL_REGISTRY}/@acme%2fnowhere`, () => new Response("{}", { status: 404 }));
  routes.set(
    `${OFFICIAL_REGISTRY}/@acme%2fchannels`,
    () => new Response("not found", { status: 404 }),
  );

  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let registry: FetchFake;
  const npm = forbiddenNpm();
  const install = (specifier: string) =>
    admin.post("/api/projects/default_project/plugins/installed", { specifier });
  const library = async () =>
    ((await (await admin.get("/api/plugins")).json()) as PluginLibraryResponse).groups.flatMap(
      (g) => g.plugins,
    );
  const fetchedUrls = () => registry.calls.map((c) => c.url);

  beforeAll(async () => {
    // One fake for every fetch the app makes, so the index lookup (which takes the global fetch
    // when the routes are set up) and the installer read the same registry.
    registry = stubFetch((call) => {
      const route = routes.get(call.url);
      if (route === undefined) throw fetchFailed("ENOTFOUND");
      return route();
    });
    t = await createTestApp({
      pluginPackages: new NpmPluginPackages({
        locate: () => ({ found: false, notes: NO_NPM_NOTES }),
        npm: npm.run,
        fetch: () => registry.fetch,
      }),
    });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const saved = await admin.put("/api/admin/plugin-config", {
      name: "plugin-index",
      values: { sources: [INDEX] },
    });
    expect(saved.status).toBe(200);
  });
  afterAll(async () => {
    await t.cleanup();
    vi.unstubAllGlobals();
  });

  it("installs a plugin with no dependencies from the registry, lists it, and records ^<version>, with no npm", async () => {
    const res = await install("@acme/notes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as InstalledPluginsResponse;
    expect(body.installed).toMatchObject({ name: "@acme/notes", version: "1.0.0", library: true });
    expect(body.installed).not.toHaveProperty("withoutNpm");
    expect((await library()).find((p) => p.name === "notes")).toMatchObject({
      package: "@acme/notes",
      source: "installed",
      version: "1.0.0",
    });
    expect((await prefixDeps(t.root))["@acme/notes"]).toBe("^1.0.0");
    expect(npm.runs).toEqual([]);
  });

  it("removes that plugin again without npm: its directory and its record go", async () => {
    const res = await admin.delete(
      "/api/projects/default_project/plugins/installed?specifier=%40acme%2Fnotes",
    );
    expect(res.status).toBe(200);
    expect(await present(installedDir(t.root, "@acme/notes"))).toBe(false);
    expect(await prefixDeps(t.root)).not.toHaveProperty("@acme/notes");
    expect((await library()).find((p) => p.name === "notes")).toBeUndefined();
    expect(npm.runs).toEqual([]);
  });

  it("falls through to the index's release channel for a name the registry does not have, and records the release URL", async () => {
    const res = await install("@acme/channels");
    expect(res.status).toBe(200);
    expect(((await res.json()) as InstalledPluginsResponse).installed).toMatchObject({
      name: "@acme/channels",
      version: "1.0.0",
    });
    expect(await installedVersion(t.root, "@acme/channels")).toBe("1.0.0");
    expect((await prefixDeps(t.root))["@acme/channels"]).toBe(
      "file:archives/acme-channels-1.0.0.tgz",
    );
    expect(
      await fs.readFile(path.join(prefixOf(t.root), "archives", "acme-channels-1.0.0.tgz")),
    ).toEqual(Buffer.from(channelAsset));
    expect(npm.runs).toEqual([]);
  });

  it("refuses a name neither the registry nor the index has, in the installer's own words", async () => {
    const res = await install("@acme/nowhere");
    expect(res.status).toBe(400);
    const { code, message } = ((await res.json()) as { error: { code: string; message: string } })
      .error;
    // The not-published refusal leads with the cause and names the registry's host; it never
    // says npm said it.
    expect(code).toBe("plugin_not_published");
    expect(message).toBe("@acme/nowhere is not published on registry.npmjs.org yet.");
  });

  it("installs the build's offline archive without npm when the registry does not answer", async () => {
    // The archive staged in the installation's builtin prefix the way scripts/build-plugins.mjs
    // stages it (the program entry points into that installation). The fetch fake has no route
    // for the name: every address fails as an unresolved host does.
    const entry = process.argv[1];
    const builtin = path.join(t.root, "install", "plugins");
    const offline = path.join(builtin, "offline");
    const files = skillsPlugin("@acme/desk", "1.0.0");
    const asset = packageTarball(files);
    await fs.mkdir(path.join(offline, "desk"), { recursive: true });
    await fs.writeFile(path.join(builtin, "package.json"), '{"name":"prefix","private":true}');
    await fs.writeFile(path.join(offline, "acme-desk-1.0.0.tgz"), asset);
    await fs.writeFile(path.join(offline, "desk", "package.json"), files["package.json"]!);
    await fs.writeFile(path.join(offline, "desk", "ifaces.json"), files["ifaces.json"]!);
    await fs.writeFile(
      path.join(offline, "index.json"),
      JSON.stringify([
        {
          name: "@acme/desk",
          version: "1.0.0",
          file: "acme-desk-1.0.0.tgz",
          integrity: integrityOf(asset),
          meta: "desk",
        },
      ]),
    );
    process.argv[1] = path.join(t.root, "install", "bin", "server.js");
    try {
      const res = await install("@acme/desk");
      expect(res.status).toBe(200);
      expect(((await res.json()) as InstalledPluginsResponse).installed).toMatchObject({
        name: "@acme/desk",
        version: "1.0.0",
        from: "offline",
      });
      expect((await prefixDeps(t.root))["@acme/desk"]).toBe("file:archives/acme-desk-1.0.0.tgz");
      expect(npm.runs).toEqual([]);
    } finally {
      if (entry !== undefined) process.argv[1] = entry;
    }
  });

  it("refuses a plugin with dependencies before fetching its tarball, saying why and how to get npm", async () => {
    const res = await install("@acme/heavy");
    expect(res.status).toBe(400);
    const { code, message } = ((await res.json()) as { error: { code: string; message: string } })
      .error;
    expect(code).toBe("plugin_install_failed");
    expect(message).toMatch(/^@acme\/heavy@1\.0\.0 needs npm to install: it depends on left-pad/);
    expect(message).toContain("no npm on PATH");
    expect(message).toContain("Install Node.js");
    expect(fetchedUrls()).not.toContain(tarballUrl(OFFICIAL_REGISTRY, "@acme/heavy", "1.0.0"));
    expect(await present(installedDir(t.root, "@acme/heavy"))).toBe(false);
    expect(await prefixDeps(t.root)).not.toHaveProperty("@acme/heavy");
  });

  it("takes a package that is no plugin out again, without claiming that its scripts ran", async () => {
    const res = await install("@acme/bare");
    expect(res.status).toBe(400);
    const { code, message } = ((await res.json()) as { error: { code: string; message: string } })
      .error;
    expect(code).toBe("not_a_plugin");
    expect(message).toMatch(/It was removed again\.$/);
    expect(message).not.toContain("install scripts");
    expect(await present(installedDir(t.root, "@acme/bare"))).toBe(false);
    expect(await prefixDeps(t.root)).not.toHaveProperty("@acme/bare");
  });

  it("installs a zip of a plugin with no dependencies from the files its `files` field publishes, recorded as an uploaded tarball", async () => {
    const files = {
      ...skillsPlugin("@acme/zipped", "1.2.0", { files: ["ifaces.json", "skills"] }),
      "README.md": "# Zipped\n",
      "src/index.ts": "export {};\n",
    };
    const res = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: zip(files),
    });
    expect(res.status).toBe(201);
    const dir = installedDir(t.root, "@acme/zipped");
    expect(await present(path.join(dir, "skills", "notes", "SKILL.md"))).toBe(true);
    expect(await present(path.join(dir, "README.md"))).toBe(true);
    expect(await present(path.join(dir, "src"))).toBe(false);
    expect((await prefixDeps(t.root))["@acme/zipped"]).toBe("file:archives/acme-zipped-1.2.0.tgz");
    expect(await present(path.join(prefixOf(t.root), "archives", "acme-zipped-1.2.0.tgz"))).toBe(
      true,
    );
    expect((await library()).find((p) => p.name === "zipped")).toMatchObject({ version: "1.2.0" });
    expect(npm.runs).toEqual([]);
  });

  it("refuses a zip of a plugin with dependencies, and nothing lands", async () => {
    const files = skillsPlugin("@acme/zipdeps", "1.0.0", { dependencies: { koffi: "^2.0.0" } });
    const res = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: zip(files),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /^@acme\/zipdeps@1\.0\.0 needs npm to install: it depends on koffi/,
    );
    expect(await present(installedDir(t.root, "@acme/zipdeps"))).toBe(false);
  });

  it("answers a prefix package.json that will not parse with 400, not a 500", async () => {
    const manifest = path.join(prefixOf(t.root), "package.json");
    const kept = await fs.readFile(manifest);
    await fs.writeFile(manifest, "{ not json");
    try {
      const res = await install("@acme/notes");
      expect(res.status).toBe(400);
      const { code, message } = ((await res.json()) as { error: { code: string; message: string } })
        .error;
      expect(code).toBe("plugin_install_failed");
      expect(message).toMatch(/the plugin prefix's package\.json .* could not be read/);
    } finally {
      await fs.writeFile(manifest, kept);
    }
  });
});

describe("the installed-plugins routes on a machine with npm", () => {
  it("installs a plugin with no dependencies through npm, and never reads the registry itself", async () => {
    const registry = serving(new Map());
    const runs: string[][] = [];
    // npm as far as the server can see it: an install writes the package and its record.
    const standIn: NpmRun = async (prefix, args) => {
      runs.push([...args]);
      // The registry check before the install: `npm view` answers the version it found.
      if (args.includes("view")) return '"3.1.0"\n';
      const spec = args.at(-1)!;
      const dir = path.join(prefix, "node_modules", ...spec.split("/"));
      for (const [rel, data] of Object.entries(skillsPlugin(spec, "3.1.0"))) {
        await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
        await fs.writeFile(path.join(dir, rel), data);
      }
      const manifest = path.join(prefix, "package.json");
      const own = JSON.parse(await fs.readFile(manifest, "utf8")) as Record<string, unknown>;
      await fs.writeFile(manifest, JSON.stringify({ ...own, dependencies: { [spec]: "^3.1.0" } }));
      return "";
    };
    const t = await createTestApp({
      pluginPackages: new NpmPluginPackages({
        locate: () => ({ found: true }),
        npm: standIn,
        fetch: () => registry.fetch,
      }),
    });
    try {
      const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
      const res = await admin.post("/api/projects/default_project/plugins/installed", {
        specifier: "@acme/notes",
      });
      expect(res.status).toBe(200);
      expect(runs).toHaveLength(2);
      expect(runs[0]).toEqual(expect.arrayContaining(["view", "--", "@acme/notes", "version"]));
      expect(runs[1]).toEqual(expect.arrayContaining(["install", "--", "@acme/notes"]));
      expect(registry.calls).toEqual([]);
    } finally {
      await t.cleanup();
    }
  });
});

describe("installing without npm", () => {
  const REGISTRY = "https://registry.example";
  const MIRRORS: PluginProxyRule[] = [
    {
      kind: "rewrite",
      match: "^https:\\/\\/registry\\.example\\/(.+)$",
      rewrite: "https://mirror.example/$1",
    },
  ];
  const mirrored = (url: string) => url.replace(REGISTRY, "https://mirror.example");

  const io = (fake: FetchFake, extra: Partial<WithoutNpm> = {}): WithoutNpm => ({
    fetch: fake.fetch,
    npmNotes: NO_NPM_NOTES,
    registry: REGISTRY,
    mirrors: MIRRORS,
    ...extra,
  });

  /** Installs `name@spec` from a registry serving `packages`, with `answer` overriding URLs. */
  const installFrom = async (
    root: string,
    packages: Record<string, Record<string, Published>>,
    spec: string,
    answer: Record<string, () => Response | Promise<Response>> = {},
    extra: Partial<WithoutNpm> = {},
  ) => {
    const routes = registryRoutes(REGISTRY, packages);
    for (const [url, route] of Object.entries(answer)) routes.set(url, route);
    const fake = serving(routes);
    return { fake, result: installFromRegistry(root, spec, io(fake, extra)) };
  };

  const refusedWith = async (promise: Promise<unknown>, pattern: RegExp) => {
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PluginInstallError);
    expect((err as Error).message).toMatch(pattern);
    return err as PluginInstallError;
  };

  const notes = (version: string, manifest: Record<string, unknown> = {}): Published => ({
    files: skillsPlugin("@acme/notes", version, manifest),
  });

  it("passes over an address serving tampered bytes for the mirror that serves the pinned ones", async () => {
    const root = await tempRoot();
    const url = tarballUrl(REGISTRY, "@acme/notes", "1.0.0");
    const genuine = packageTarball(skillsPlugin("@acme/notes", "1.0.0"));
    const { fake, result } = await installFrom(
      root,
      {
        "@acme/notes": {
          "1.0.0": { files: skillsPlugin("@acme/notes", "1.0.0"), tarball: genuine },
        },
      },
      "@acme/notes",
      {
        [url]: () =>
          new Response(packageTarball(skillsPlugin("@acme/notes", "1.0.0", { evil: true }))),
        [mirrored(url)]: () => new Response(genuine),
      },
    );
    expect(await result).toEqual({ name: "@acme/notes", version: "1.0.0", withoutNpm: true });
    expect(fake.calls.map((c) => c.url)).toEqual([`${REGISTRY}/@acme%2fnotes`, url, mirrored(url)]);
    expect(
      JSON.parse(
        await fs.readFile(path.join(installedDir(root, "@acme/notes"), "package.json"), "utf8"),
      ),
    ).not.toHaveProperty("evil");
  });

  it("refuses when every address serves tampered bytes, and places nothing", async () => {
    const root = await tempRoot();
    const url = tarballUrl(REGISTRY, "@acme/notes", "1.0.0");
    const tampered = () =>
      new Response(packageTarball(skillsPlugin("@acme/notes", "1.0.0", { evil: true })));
    const { result } = await installFrom(
      root,
      { "@acme/notes": { "1.0.0": notes("1.0.0") } },
      "@acme/notes",
      {
        [url]: tampered,
        [mirrored(url)]: tampered,
      },
    );
    const err = await refusedWith(result, /could not download @acme\/notes@1\.0\.0: .*sha512/);
    expect(err.withoutNpm).toBe(true);
    expect(await present(installedDir(root, "@acme/notes"))).toBe(false);
  });

  it.each([
    [
      "declared",
      (bytes: Uint8Array) =>
        new Response(bytes, { headers: { "content-length": String(2 * 1024 * 1024) } }),
    ],
    [
      "streamed",
      (bytes: Uint8Array) => new Response(new Uint8Array([...bytes, ...new Uint8Array(4096)])),
    ],
  ])("refuses a tarball past the download cap (%s)", async (_how, respond) => {
    const root = await tempRoot();
    const url = tarballUrl(REGISTRY, "@acme/notes", "1.0.0");
    const bytes = packageTarball(skillsPlugin("@acme/notes", "1.0.0"));
    const over = () => respond(bytes);
    const { result } = await installFrom(
      root,
      { "@acme/notes": { "1.0.0": notes("1.0.0") } },
      "@acme/notes",
      { [url]: over, [mirrored(url)]: over },
      { limits: { tarballMaxBytes: bytes.byteLength + 1024 } },
    );
    await refusedWith(result, /cap/);
    expect(await present(installedDir(root, "@acme/notes"))).toBe(false);
  });

  it("refuses a tarball that unpacks past its cap", async () => {
    const root = await tempRoot();
    const files = {
      ...skillsPlugin("@acme/notes", "1.0.0"),
      "pad.bin": new Uint8Array(256 * 1024),
    };
    const { result } = await installFrom(
      root,
      { "@acme/notes": { "1.0.0": { files } } },
      "@acme/notes",
      {},
      { limits: { unpackedMaxBytes: 64 * 1024 } },
    );
    await refusedWith(result, /unpacks to more than/);
    expect(await present(installedDir(root, "@acme/notes"))).toBe(false);
  });

  it.each([
    ["climbs out with ..", "package/../../escape.txt"],
    ["is absolute", "/escape-absolute.txt"],
    ["names a drive", "C:/escape-drive.txt"],
    ["carries a backslash", "package\\..\\escape.txt"],
    ["carries a colon", "package/skills:stream"],
  ])("refuses a tarball whose entry %s, and writes nothing anywhere", async (_why, hostile) => {
    const root = await tempRoot();
    const entries: TarEntry[] = [
      ...Object.entries(skillsPlugin("@acme/notes", "1.0.0")).map(([rel, data]) => ({
        path: `package/${rel}`,
        data,
      })),
      { path: hostile, data: "escaped" },
    ];
    const { result } = await installFrom(
      root,
      {
        "@acme/notes": {
          "1.0.0": { files: skillsPlugin("@acme/notes", "1.0.0"), tarball: tarball(entries) },
        },
      },
      "@acme/notes",
    );
    await refusedWith(result, /nothing is installed/);
    expect(await present(installedDir(root, "@acme/notes"))).toBe(false);
    expect(await present(path.join(root, "escape.txt"))).toBe(false);
    expect(await present(path.join(prefixOf(root), "escape.txt"))).toBe(false);
    expect(await fs.readdir(path.join(prefixOf(root), ".staging")).catch(() => [])).toEqual([]);
  });

  it("never creates the links or devices a tarball carries, and places its files", async () => {
    const root = await tempRoot();
    const entries: TarEntry[] = [
      { path: "package/", type: "dir" },
      ...Object.entries(skillsPlugin("@acme/notes", "1.0.0")).map(([rel, data]) => ({
        path: `package/${rel}`,
        data,
      })),
      { path: "package/to-passwd", type: "symlink", linkTo: "/etc/passwd" },
      { path: "package/hard", type: "hardlink", linkTo: "package/package.json" },
      { path: "package/null", type: "chardev" },
      { path: "package/pipe", type: "fifo" },
    ];
    const { result } = await installFrom(
      root,
      {
        "@acme/notes": {
          "1.0.0": { files: skillsPlugin("@acme/notes", "1.0.0"), tarball: tarball(entries) },
        },
      },
      "@acme/notes",
    );
    await result;
    const dir = installedDir(root, "@acme/notes");
    expect(await present(path.join(dir, "skills", "notes", "SKILL.md"))).toBe(true);
    for (const name of ["to-passwd", "hard", "null", "pipe"]) {
      expect(await present(path.join(dir, name))).toBe(false);
    }
  });

  it("replaces the installed version whole on an upgrade, records the new range, and leaves no staging", async () => {
    const root = await tempRoot();
    const v1: Published = {
      files: { ...skillsPlugin("@acme/notes", "1.0.0"), "old-only.txt": "1" },
    };
    await (
      await installFrom(root, { "@acme/notes": { "1.0.0": v1 } }, "@acme/notes")
    ).result;
    await (
      await installFrom(
        root,
        { "@acme/notes": { "1.0.0": v1, "2.0.0": notes("2.0.0") } },
        "@acme/notes@^2.0.0",
      )
    ).result;
    expect(await installedVersion(root, "@acme/notes")).toBe("2.0.0");
    expect(await present(path.join(installedDir(root, "@acme/notes"), "old-only.txt"))).toBe(false);
    expect((await prefixDeps(root))["@acme/notes"]).toBe("^2.0.0");
    expect(await fs.readdir(path.join(prefixOf(root), ".staging"))).toEqual([]);
  });

  it("leaves the installed version as it was when an upgrade is refused", async () => {
    const root = await tempRoot();
    await (
      await installFrom(root, { "@acme/notes": { "1.0.0": notes("1.0.0") } }, "@acme/notes")
    ).result;
    const url = tarballUrl(REGISTRY, "@acme/notes", "2.0.0");
    const tampered = () =>
      new Response(packageTarball(skillsPlugin("@acme/notes", "2.0.0", { evil: true })));
    const { result } = await installFrom(
      root,
      { "@acme/notes": { "1.0.0": notes("1.0.0"), "2.0.0": notes("2.0.0") } },
      "@acme/notes@2.0.0",
      { [url]: tampered, [mirrored(url)]: tampered },
    );
    await refusedWith(result, /sha512/);
    expect(await installedVersion(root, "@acme/notes")).toBe("1.0.0");
    expect((await prefixDeps(root))["@acme/notes"]).toBe("^1.0.0");
  });

  it("lands two installs made at once, and records both", async () => {
    const root = await tempRoot();
    const packages = {
      "@acme/notes": { "1.0.0": notes("1.0.0") },
      "@acme/todo": { "1.0.0": { files: skillsPlugin("@acme/todo", "1.0.0") } },
    };
    const fake = serving(registryRoutes(REGISTRY, packages));
    await Promise.all([
      installFromRegistry(root, "@acme/notes", io(fake)),
      installFromRegistry(root, "@acme/todo", io(fake)),
    ]);
    expect(await prefixDeps(root)).toEqual({ "@acme/notes": "^1.0.0", "@acme/todo": "^1.0.0" });
  });

  it("sweeps staging left over from more than an hour ago at the next install, and keeps a fresh one", async () => {
    const root = await tempRoot();
    const staging = path.join(prefixOf(root), ".staging");
    await fs.mkdir(path.join(staging, "crashed", "package"), { recursive: true });
    await fs.mkdir(path.join(staging, "in-flight"), { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(path.join(staging, "crashed"), twoHoursAgo, twoHoursAgo);
    await fs.writeFile(
      path.join(prefixOf(root), "package.json"),
      '{"name":"penguin-plugins","private":true,"version":"0.0.0"}\n',
    );
    await (
      await installFrom(root, { "@acme/notes": { "1.0.0": notes("1.0.0") } }, "@acme/notes")
    ).result;
    expect((await fs.readdir(staging)).sort()).toEqual(["in-flight"]);
  });

  it("gives an address that never answers its window, then takes the next address", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const root = await tempRoot();
      const documentUrl = `${REGISTRY}/@acme%2fnotes`;
      // Answers nothing until the caller gives up on it.
      const silent = (): Promise<Response> =>
        new Promise((_resolve, reject) => {
          const signal = fake.calls.at(-1)!.init!.signal!;
          const abort = () => reject(new DOMException("aborted", "AbortError"));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort);
        });
      const routes = registryRoutes(REGISTRY, { "@acme/notes": { "1.0.0": notes("1.0.0") } });
      routes.set(mirrored(documentUrl), routes.get(documentUrl)!);
      routes.set(documentUrl, silent);
      const fake = serving(routes);
      const result = installFromRegistry(
        root,
        "@acme/notes",
        io(fake, { limits: { timeoutMs: 5_000 } }),
      );
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await result).toEqual({ name: "@acme/notes", version: "1.0.0", withoutNpm: true });
      expect(fake.calls.map((c) => c.url).slice(0, 2)).toEqual([
        documentUrl,
        mirrored(documentUrl),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes a registry's refusal (403) as the answer: no mirror is asked, and the refusal says why", async () => {
    const root = await tempRoot();
    const documentUrl = `${REGISTRY}/@acme%2fprivate`;
    const fake = serving(
      new Map([[documentUrl, () => new Response("forbidden", { status: 403 })]]),
    );
    await refusedWith(
      installFromRegistry(root, "@acme/private", io(fake)),
      /refused to answer for @acme\/private \(403\).*\.npmrc/,
    );
    expect(fake.calls.map((c) => c.url)).toEqual([documentUrl]);
  });

  it.each([
    [
      "an install script",
      { scripts: { postinstall: "node setup.js" } },
      /needs npm to install: it has install scripts \(postinstall\)/,
    ],
    [
      "an install script the document marks",
      { hasInstallScript: true },
      /needs npm to install: it has install scripts/,
    ],
    [
      "a dependency",
      { dependencies: { "left-pad": "^1.3.0" } },
      /needs npm to install: it depends on left-pad/,
    ],
    [
      "a required peer",
      { peerDependencies: { react: "^19.0.0" } },
      /needs npm to install: it depends on react/,
    ],
    ["binding.gyp", { gypfile: true }, /needs npm to install: it carries binding\.gyp/],
    [
      "an os list excluding this machine",
      { os: [`!${process.platform}`] },
      /does not install on this machine/,
    ],
  ])(
    "refuses a version with %s, before its tarball is fetched",
    async (_what, manifest, pattern) => {
      const root = await tempRoot();
      const { fake, result } = await installFrom(
        root,
        { "@acme/notes": { "1.0.0": notes("1.0.0", manifest) } },
        "@acme/notes",
      );
      await refusedWith(result, pattern);
      expect(fake.calls).toHaveLength(1);
      expect(await present(installedDir(root, "@acme/notes"))).toBe(false);
    },
  );

  it.each([
    ["a prepare script alone", { scripts: { prepare: "tsup", build: "tsup" } }],
    [
      "an optional peer",
      {
        peerDependencies: { react: "^19.0.0" },
        peerDependenciesMeta: { react: { optional: true } },
      },
    ],
  ])("installs a version with %s", async (_what, manifest) => {
    const root = await tempRoot();
    const { result } = await installFrom(
      root,
      { "@acme/notes": { "1.0.0": notes("1.0.0", manifest) } },
      "@acme/notes",
    );
    expect(await result).toEqual({ name: "@acme/notes", version: "1.0.0", withoutNpm: true });
  });

  it("refuses a tarball whose package.json names another version than was asked for", async () => {
    const root = await tempRoot();
    const { result } = await installFrom(
      root,
      {
        "@acme/notes": {
          "1.0.0": {
            files: skillsPlugin("@acme/notes", "1.0.0"),
            tarball: packageTarball(skillsPlugin("@acme/notes", "9.9.9")),
          },
        },
      },
      "@acme/notes",
    );
    await refusedWith(result, /says "@acme\/notes"@"9\.9\.9", not the @acme\/notes@1\.0\.0/);
    expect(await present(installedDir(root, "@acme/notes"))).toBe(false);
  });

  it("installs a release channel's asset only when it matches the entry's sha512", async () => {
    const root = await tempRoot();
    const asset = packageTarball(skillsPlugin("@acme/channels", "1.0.0"));
    const url = "https://releases.example/channels-1.0.0.tgz";
    const mirror = "https://mirror.example/channels-1.0.0.tgz";
    const fake = serving(
      new Map([
        [
          url,
          () =>
            new Response(packageTarball(skillsPlugin("@acme/channels", "1.0.0", { evil: true }))),
        ],
        [mirror, () => new Response(asset)],
      ]),
    );
    const channel = {
      name: "@acme/channels",
      version: "1.0.0",
      integrity: integrityOf(asset),
      url,
      mirrors: [mirror],
    };
    expect(await installChannel(root, channel, io(fake))).toEqual({
      name: "@acme/channels",
      version: "1.0.0",
      withoutNpm: true,
    });
    expect((await prefixDeps(root))["@acme/channels"]).toBe(
      "file:archives/acme-channels-1.0.0.tgz",
    );
    expect(
      await fs.readFile(path.join(prefixOf(root), "archives", "acme-channels-1.0.0.tgz")),
    ).toEqual(Buffer.from(asset));
  });

  it("refuses a tarball that carries no package.json", async () => {
    const root = await tempRoot();
    const { result } = await installFrom(
      root,
      {
        "@acme/notes": {
          "1.0.0": {
            files: skillsPlugin("@acme/notes", "1.0.0"),
            tarball: packageTarball({ "ifaces.json": "{}" }),
          },
        },
      },
      "@acme/notes",
    );
    await refusedWith(result, /carries no readable package\.json/);
  });

  it.each<[string, () => Response]>([
    [
      "unreachable",
      () => {
        throw fetchFailed("ECONNREFUSED");
      },
    ],
    ["a server error", () => new Response("down", { status: 503 })],
    ["a page that is not JSON", () => new Response("<html>captive portal</html>")],
    ["JSON that is no registry document", () => jsonResponse({ ok: true })],
    ["another package's document", () => jsonResponse({ name: "@acme/other", versions: {} })],
    [
      "a body that breaks off",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"name":'));
              controller.error(new Error("socket hang up"));
            },
          }),
        ),
    ],
  ])(
    "takes the mirror's document when the registry's address answers %s",
    async (_what, answer) => {
      const root = await tempRoot();
      const documentUrl = `${REGISTRY}/@acme%2fnotes`;
      const routes = registryRoutes(REGISTRY, { "@acme/notes": { "1.0.0": notes("1.0.0") } });
      routes.set(mirrored(documentUrl), routes.get(documentUrl)!);
      routes.set(documentUrl, answer);
      const fake = serving(routes);
      await expect(installFromRegistry(root, "@acme/notes", io(fake))).resolves.toMatchObject({
        version: "1.0.0",
      });
      expect(fake.calls.map((c) => c.url).slice(0, 2)).toEqual([
        documentUrl,
        mirrored(documentUrl),
      ]);
    },
  );

  it("refuses when no address answers a document, naming each", async () => {
    const root = await tempRoot();
    const err = await refusedWith(
      installFromRegistry(root, "@acme/notes", io(serving(new Map()))),
      /could not read @acme\/notes from the registry: .*registry\.example.*unreachable.*mirror\.example.*unreachable/,
    );
    // As npm's network failures are: the offline archive may still answer.
    expect(err.reason).toBe("unreachable");
  });

  it.each<[string, string, RegExp, "unavailable" | "other"]>([
    [
      "a version the registry does not have",
      "@acme/notes@^9.0.0",
      /no version of @acme\/notes matches \^9\.0\.0/,
      "unavailable",
    ],
    [
      "a name the registry does not have",
      "@acme/absent",
      /@acme\/absent is not on the registry/,
      "unavailable",
    ],
    ["a spec that is no package name", "not a package!", /Give an npm package name/, "other"],
    [
      "a link",
      "https://github.com/acme/notes",
      /Installing from the link .* needs npm to install: npm is what fetches a link/,
      "other",
    ],
  ])("refuses %s", async (_what, spec, pattern, reason) => {
    const root = await tempRoot();
    const routes = registryRoutes(REGISTRY, { "@acme/notes": { "1.0.0": notes("1.0.0") } });
    routes.set(`${REGISTRY}/@acme%2fabsent`, () => new Response("{}", { status: 404 }));
    const err = await refusedWith(installFromRegistry(root, spec, io(serving(routes))), pattern);
    expect(err.reason).toBe(reason);
  });

  it.each([
    ["over plain http off this machine", "http://cdn.example/notes-1.0.0.tgz", false],
    ["over http on the loopback", "http://127.0.0.1:4873/notes-1.0.0.tgz", true],
    ["with credentials that only look local", "http://localhost:1@evil.example/x.tgz", false],
  ])(
    "fetches a tarball the registry names %s only when it is https or local",
    async (_how, url, installs) => {
      const root = await tempRoot();
      const bytes = packageTarball(skillsPlugin("@acme/notes", "1.0.0"));
      const document = {
        name: "@acme/notes",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": {
            name: "@acme/notes",
            version: "1.0.0",
            dist: { tarball: url, integrity: integrityOf(bytes) },
          },
        },
      };
      const routes = new Map<string, () => Response>([
        [`${REGISTRY}/@acme%2fnotes`, () => jsonResponse(document)],
        [url, () => new Response(bytes)],
      ]);
      const result = installFromRegistry(root, "@acme/notes", io(serving(routes)));
      if (installs) await expect(result).resolves.toMatchObject({ version: "1.0.0" });
      else await refusedWith(result, /names no https tarball/);
    },
  );

  it("refuses a version that pins no sha512", async () => {
    const root = await tempRoot();
    const routes = registryRoutes(REGISTRY, { "@acme/notes": { "1.0.0": notes("1.0.0") } });
    const sha1Only = {
      name: "@acme/notes",
      "dist-tags": { latest: "1.0.0" },
      versions: {
        "1.0.0": {
          name: "@acme/notes",
          version: "1.0.0",
          dist: { tarball: tarballUrl(REGISTRY, "@acme/notes", "1.0.0"), shasum: "abc" },
        },
      },
    };
    routes.set(`${REGISTRY}/@acme%2fnotes`, () => jsonResponse(sha1Only));
    await refusedWith(
      installFromRegistry(root, "@acme/notes", io(serving(routes))),
      /pins no sha512/,
    );
  });

  it.each([
    ["an unreadable sha512", "sha1-abc", /sha512 integrity is not readable/],
    [
      "no address that answers",
      integrityOf(new Uint8Array([1])),
      /could not install the release asset from any of https:\/\/releases\.example\/x\.tgz/,
    ],
  ])("refuses a release channel with %s", async (_what, integrity, pattern) => {
    const root = await tempRoot();
    const channel = {
      name: "@acme/channels",
      version: "1.0.0",
      integrity,
      url: "https://releases.example/x.tgz",
    };
    await refusedWith(installChannel(root, channel, io(serving(new Map()))), pattern);
  });

  it.each(Object.entries(NPM_PACK_CASES))(
    "installs from a zip exactly what npm pack publishes, given %s",
    async (_what, { files, packed }) => {
      const root = await tempRoot();
      const packages = new NpmPluginPackages({
        locate: () => ({ found: false, notes: NO_NPM_NOTES }),
        npm: forbiddenNpm().run,
        fetch: () => serving(new Map()).fetch,
      });
      await packages.installFiles(
        root,
        Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
      );
      const dir = installedDir(root, "@acme/probe");
      const installed = (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
        .filter((e) => e.isFile())
        .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
        .sort();
      expect(installed).toEqual(packed);
      const archive = await fs.readFile(
        path.join(prefixOf(root), "archives", "acme-probe-1.0.0.tgz"),
      );
      expect([...readPackageTarball(archive).keys()].sort()).toEqual(packed);
    },
  );

  it.skipIf(!locateNpm().found)(
    "keeps a release channel's asset so a later real npm run installs from disk, offline",
    async () => {
      const root = await tempRoot();
      const asset = packageTarball(skillsPlugin("@acme/channels", "1.0.0"));
      const url = "https://releases.invalid/acme/channels-1.0.0.tgz";
      await installChannel(
        root,
        { name: "@acme/channels", version: "1.0.0", integrity: integrityOf(asset), url },
        io(serving(new Map([[url, () => new Response(asset)]]))),
      );
      const other = path.join(root, "other-1.0.0.tgz");
      await fs.writeFile(
        other,
        packageTarball({
          "package.json": JSON.stringify({ name: "@acme/other", version: "1.0.0" }),
        }),
      );
      // An unrelated install by real npm, with the network off: it has to rebuild the prefix
      // from what package.json records, the channel's package among it.
      await realNpm(prefixOf(root), [
        "install",
        "--offline",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        "--",
        other,
      ]);
      expect(await installedVersion(root, "@acme/channels")).toBe("1.0.0");
      expect(await installedVersion(root, "@acme/other")).toBe("1.0.0");
    },
    60_000,
  );

  it.each<[string, Files, RegExp]>([
    [
      "dependencies",
      skillsPlugin("@acme/notes", "1.0.0", { dependencies: { "left-pad": "^1.3.0" } }),
      /needs npm to install: it depends on left-pad/,
    ],
    [
      "an install script",
      skillsPlugin("@acme/notes", "1.0.0", { scripts: { postinstall: "node setup.js" } }),
      /needs npm to install: it has install scripts \(postinstall\)/,
    ],
    [
      "binding.gyp",
      { ...skillsPlugin("@acme/notes", "1.0.0"), "binding.gyp": "{}" },
      /needs npm to install: it carries binding\.gyp/,
    ],
  ])(
    "refuses a tarball whose own package needs npm (%s), though the registry's document did not say so",
    async (_what, packed, pattern) => {
      const root = await tempRoot();
      const { fake, result } = await installFrom(
        root,
        {
          "@acme/notes": {
            "1.0.0": {
              files: skillsPlugin("@acme/notes", "1.0.0"),
              tarball: packageTarball(packed),
            },
          },
        },
        "@acme/notes",
      );
      await refusedWith(result, pattern);
      expect(fake.calls.map((c) => c.url)).toContain(tarballUrl(REGISTRY, "@acme/notes", "1.0.0"));
      expect(await present(installedDir(root, "@acme/notes"))).toBe(false);
    },
  );

  it("installs a package carrying binding.gyp whose manifest says gypfile: false", async () => {
    const root = await tempRoot();
    const files = {
      ...skillsPlugin("@acme/notes", "1.0.0", { gypfile: false }),
      "binding.gyp": "{}",
    };
    const { result } = await installFrom(
      root,
      { "@acme/notes": { "1.0.0": { files } } },
      "@acme/notes",
    );
    await expect(result).resolves.toMatchObject({ version: "1.0.0" });
  });

  it("refuses a release channel's asset whose package depends on others, and keeps nothing", async () => {
    const root = await tempRoot();
    const asset = packageTarball(
      skillsPlugin("@acme/channels", "1.0.0", { dependencies: { koffi: "^2.0.0" } }),
    );
    const url = "https://releases.example/channels-1.0.0.tgz";
    await refusedWith(
      installChannel(
        root,
        { name: "@acme/channels", version: "1.0.0", integrity: integrityOf(asset), url },
        io(serving(new Map([[url, () => new Response(asset)]]))),
      ),
      /needs npm to install: it depends on koffi/,
    );
    expect(await present(installedDir(root, "@acme/channels"))).toBe(false);
    expect(await present(path.join(prefixOf(root), "archives"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("leaves every bin target executable", async () => {
    const root = await tempRoot();
    const files = {
      ...skillsPlugin("@acme/notes", "1.0.0", { bin: { notes: "./bin/notes.js" } }),
      "bin/notes.js": "#!/usr/bin/env node\n",
    };
    await (
      await installFrom(root, { "@acme/notes": { "1.0.0": { files } } }, "@acme/notes")
    ).result;
    const { mode } = await fs.stat(path.join(installedDir(root, "@acme/notes"), "bin", "notes.js"));
    expect(mode & 0o111).not.toBe(0);
  });

  it.each<[string, string, string, RegExp]>([
    [
      "from the loopback to plain http elsewhere",
      "http://127.0.0.1:4873/notes-1.0.0.tgz",
      "http://objects.example/notes-1.0.0.tgz",
      /redirects to http:\/\/objects\.example\/notes-1\.0\.0\.tgz, which is not an https address/,
    ],
    [
      "back to itself, over and over",
      "https://loop.example/notes-1.0.0.tgz",
      "https://loop.example/notes-1.0.0.tgz",
      /redirects more than 10 times/,
    ],
  ])("refuses a tarball that redirects %s", async (_how, url, target, pattern) => {
    const root = await tempRoot();
    const bytes = packageTarball(skillsPlugin("@acme/notes", "1.0.0"));
    const document = {
      name: "@acme/notes",
      "dist-tags": { latest: "1.0.0" },
      versions: {
        "1.0.0": {
          name: "@acme/notes",
          version: "1.0.0",
          dist: { tarball: url, integrity: integrityOf(bytes) },
        },
      },
    };
    const routes = new Map<string, () => Response>([
      [`${REGISTRY}/@acme%2fnotes`, () => jsonResponse(document)],
      [url, () => new Response(null, { status: 302, headers: { location: target } })],
    ]);
    await refusedWith(installFromRegistry(root, "@acme/notes", io(serving(routes))), pattern);
  });

  it.each([
    ["to https on another host", "https://objects.example/notes-1.0.0.tgz", true],
    ["down to plain http", "http://objects.example/notes-1.0.0.tgz", false],
  ])(
    "follows a tarball's redirect %s only when it stays on https",
    async (_how, target, follows) => {
      const root = await tempRoot();
      const url = tarballUrl(REGISTRY, "@acme/notes", "1.0.0");
      const bytes = packageTarball(skillsPlugin("@acme/notes", "1.0.0"));
      const { result } = await installFrom(
        root,
        {
          "@acme/notes": {
            "1.0.0": { files: skillsPlugin("@acme/notes", "1.0.0"), tarball: bytes },
          },
        },
        "@acme/notes",
        {
          [url]: () => new Response(null, { status: 302, headers: { location: target } }),
          [target]: () => new Response(bytes),
        },
      );
      if (follows) await expect(result).resolves.toMatchObject({ version: "1.0.0" });
      else await refusedWith(result, /redirects from https down to http:\/\/objects\.example/);
    },
  );

  it("tries a rename again while something briefly holds the files, and installs", async () => {
    const root = await tempRoot();
    await (
      await installFrom(root, { "@acme/notes": { "1.0.0": notes("1.0.0") } }, "@acme/notes")
    ).result;
    let renames = 0;
    let clock = 0;
    const ops: PrefixOps = {
      rename: async (from, to) => {
        renames += 1;
        if (renames === 2 || renames === 3) {
          throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
        }
        await fs.rename(from, to);
      },
      retryBusy: true,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    };
    await placePackage(
      root,
      "@acme/notes",
      filesOf(skillsPlugin("@acme/notes", "2.0.0")),
      "^2.0.0",
      {
        ops,
      },
    );
    expect(await installedVersion(root, "@acme/notes")).toBe("2.0.0");
    expect((await prefixDeps(root))["@acme/notes"]).toBe("^2.0.0");
  });

  it("keeps the installed version where it is when it cannot be moved back, says where, and the sweep leaves it", async () => {
    const root = await tempRoot();
    await (
      await installFrom(root, { "@acme/notes": { "1.0.0": notes("1.0.0") } }, "@acme/notes")
    ).result;
    let renames = 0;
    let clock = 0;
    const ops: PrefixOps = {
      // The installed version moves aside; nothing moves after that.
      rename: async (from, to) => {
        renames += 1;
        if (renames === 1) return fs.rename(from, to);
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}'`), {
          code: "EPERM",
        });
      },
      retryBusy: true,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    };
    const err = await refusedWith(
      placePackage(root, "@acme/notes", filesOf(skillsPlugin("@acme/notes", "2.0.0")), "^2.0.0", {
        ops,
      }),
      /could not be moved back .* it is kept at /,
    );
    // It kept trying for the whole window before it said so.
    expect(clock).toBeGreaterThanOrEqual(60_000);
    const keptAt = /it is kept at (.+?previous)\./.exec(err.message)![1]!;
    expect(
      (
        JSON.parse(await fs.readFile(path.join(keptAt, "package.json"), "utf8")) as {
          version: string;
        }
      ).version,
    ).toBe("1.0.0");
    expect((await prefixDeps(root))["@acme/notes"]).toBe("^1.0.0");
    // An hour later, the next install's sweep passes it by.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(path.dirname(keptAt), twoHoursAgo, twoHoursAgo);
    await (
      await installFrom(
        root,
        { "@acme/todo": { "1.0.0": { files: skillsPlugin("@acme/todo", "1.0.0") } } },
        "@acme/todo",
      )
    ).result;
    expect(await present(path.join(keptAt, "package.json"))).toBe(true);
  });

  it.each<[string, (prefix: string) => Promise<void>, RegExp]>([
    [
      "a prefix package.json that will not parse",
      async (prefix) => {
        await fs.mkdir(prefix, { recursive: true });
        await fs.writeFile(path.join(prefix, "package.json"), "{ not json");
      },
      /the plugin prefix's package\.json .* could not be read/,
    ],
    [
      "staging that cannot be written",
      async (prefix) => {
        await fs.mkdir(prefix, { recursive: true });
        await fs.writeFile(path.join(prefix, "package.json"), '{"name":"penguin-plugins"}\n');
        await fs.writeFile(path.join(prefix, ".staging"), "a file where a folder goes");
      },
      /@acme\/notes could not be written into the plugin prefix \(ENOTDIR|EEXIST/,
    ],
  ])("refuses in words, given %s", async (_what, arrange, pattern) => {
    const root = await tempRoot();
    await arrange(prefixOf(root));
    const { result } = await installFrom(
      root,
      { "@acme/notes": { "1.0.0": notes("1.0.0") } },
      "@acme/notes",
    );
    const err = await refusedWith(result, pattern);
    expect(err.withoutNpm).toBe(true);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses an upgrade over a directory that cannot be moved, and leaves the installed version",
    async () => {
      const root = await tempRoot();
      await (
        await installFrom(root, { "@acme/notes": { "1.0.0": notes("1.0.0") } }, "@acme/notes")
      ).result;
      const scope = path.dirname(installedDir(root, "@acme/notes"));
      await fs.chmod(scope, 0o555);
      try {
        const { result } = await installFrom(
          root,
          { "@acme/notes": { "1.0.0": notes("1.0.0"), "2.0.0": notes("2.0.0") } },
          "@acme/notes@2.0.0",
        );
        await refusedWith(result, /the installed @acme\/notes could not be moved/);
      } finally {
        await fs.chmod(scope, 0o755);
      }
      expect(await installedVersion(root, "@acme/notes")).toBe("1.0.0");
      expect((await prefixDeps(root))["@acme/notes"]).toBe("^1.0.0");
    },
  );

  it.each<[string, (p: NpmPluginPackages, root: string) => Promise<unknown>, string]>([
    ["a name", (p, root) => p.install(root, "@acme/notes"), "install"],
    [
      "a zip",
      (p, root) =>
        p.installFiles(root, {
          "package.json": strToU8('{"name":"@acme/notes","version":"1.0.0"}'),
        }),
      "pack",
    ],
    [
      "a channel",
      (p, root) =>
        p.installChannel(root, {
          name: "@acme/channels",
          version: "1.0.0",
          integrity: integrityOf(new Uint8Array([1])),
          url: "https://releases.example/x.tgz",
        }),
      "install",
    ],
    [
      "a removal",
      async (p, root) => {
        await fs.mkdir(prefixOf(root), { recursive: true });
        await fs.writeFile(path.join(prefixOf(root), "package.json"), "{}");
        await p.remove(root, "@acme/notes");
      },
      "uninstall",
    ],
  ])("hands %s to npm when the machine has npm, and fetches nothing", async (_what, run, verb) => {
    const root = await tempRoot();
    const fake = serving(new Map());
    const runs: string[][] = [];
    const packages = new NpmPluginPackages({
      locate: () => ({ found: true }),
      npm: async (_prefix, args) => {
        runs.push([...args]);
        throw new PluginInstallError("npm stand-in: no network here");
      },
      fetch: () => fake.fetch,
    });
    await run(packages, root).catch(() => undefined);
    expect(runs[0]).toContain(verb);
    expect(fake.calls).toEqual([]);
  });

  it("removes a name never installed, from a prefix never created or one that lists others, without an error", async () => {
    const root = await tempRoot();
    const packages = new NpmPluginPackages({
      locate: () => ({ found: false, notes: NO_NPM_NOTES }),
      npm: forbiddenNpm().run,
      fetch: () => serving(new Map()).fetch,
    });
    await expect(packages.remove(root, "@acme/never")).resolves.toBeUndefined();
    expect(await present(prefixOf(root))).toBe(false);
    await (
      await installFrom(root, { "@acme/notes": { "1.0.0": notes("1.0.0") } }, "@acme/notes")
    ).result;
    await expect(packages.remove(root, "@acme/never")).resolves.toBeUndefined();
    expect(await prefixDeps(root)).toEqual({ "@acme/notes": "^1.0.0" });
  });
});

describe("the tarball reader", () => {
  const files = (archive: Uint8Array) => [...readPackageTarball(archive).keys()].sort();
  const longPath = `${"d".repeat(60)}/${"e".repeat(60)}/file.txt`;
  const text = (value: string) => new TextEncoder().encode(value);
  /** One pax record, `<length> <key>=<value>\n`, its length counting itself. */
  const pax = (key: string, value: string) => {
    const body = ` ${key}=${value}\n`;
    let length = body.length;
    while (`${length}${body}`.length !== length) length = `${length}${body}`.length;
    return `${length}${body}`;
  };

  it.each<[string, Uint8Array, string[]]>([
    ["a plain tar", tarball([{ path: "package/a.txt", data: "a" }], { gzip: false }), ["a.txt"]],
    ["a pax long name", tarball([{ path: `package/${longPath}`, data: "x" }]), [longPath]],
    [
      "a GNU long name",
      tarball([
        { path: "././@LongLink", typeflag: "L", data: `package/${longPath}\0` },
        { path: `package/${longPath}`.slice(0, 100), data: "x" },
      ]),
      [longPath],
    ],
    [
      "a global header and a long link name, skipped",
      tarball([
        { path: "pax_global_header", typeflag: "g", data: "19 comment=penguin\n" },
        { path: "././@LongLink", typeflag: "K", data: "target\0" },
        { path: "package/a.txt", data: "a" },
      ]),
      ["a.txt"],
    ],
    [
      "GNU's magic, whose prefix bytes are not a path",
      tarball([
        {
          path: "package/a.txt",
          data: "a",
          patch: (h) => {
            h.set(text("ustar  \0"), 257);
            h.set(text("junk"), 345);
          },
        },
      ]),
      ["a.txt"],
    ],
    [
      "a base-256 size",
      tarball([
        {
          path: "package/a.txt",
          data: "abc",
          patch: (h) => {
            h.fill(0, 124, 136);
            h[124] = 0x80;
            h[135] = 3;
          },
        },
      ]),
      ["a.txt"],
    ],
    [
      "a global header's size, which later entries take",
      tarball([
        { path: "pax_global_header", typeflag: "g", data: pax("size", "3") },
        { path: "package/a.txt", data: "abc", patch: (h) => h.set(text("00000000000\0"), 124) },
      ]),
      ["a.txt"],
    ],
    [
      "a lone zero block between two entries",
      (() => {
        const first = tarball([{ path: "package/a.txt", data: "a" }], { gzip: false });
        const second = tarball([{ path: "package/b.txt", data: "b" }], { gzip: false });
        return new Uint8Array([...first.subarray(0, 1024 + 512), ...second]);
      })(),
      ["a.txt", "b.txt"],
    ],
    [
      "a GNU long name read after a pax path, which wins",
      tarball([
        { path: "././@PaxHeader", typeflag: "x", data: pax("path", "package/from-pax.txt") },
        { path: "././@LongLink", typeflag: "L", data: "package/from-gnu.txt\0" },
        { path: "package/short", data: "x" },
      ]),
      ["from-gnu.txt"],
    ],
    [
      "a pending pax size, kept off the long-name record and given to the entry",
      tarball([
        { path: "././@PaxHeader", typeflag: "x", data: pax("size", "3") },
        { path: "././@LongLink", typeflag: "L", data: "package/long.txt\0" },
        { path: "package/short", data: "abc", patch: (h) => h.set(text("00000000000\0"), 124) },
      ]),
      ["long.txt"],
    ],
    [
      "an old-style file entry whose name ends in /, a directory",
      tarball([
        { path: "package/dir/", typeflag: "0" },
        { path: "package/dir/a.txt", data: "a" },
      ]),
      ["dir/a.txt"],
    ],
  ])("reads %s", (_what, archive, expected) => {
    expect(files(archive)).toEqual(expected);
  });

  it.each<[string, () => Uint8Array, RegExp]>([
    [
      "a corrupt gzip",
      () => new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]),
      /not a readable gzip archive/,
    ],
    [
      "a broken checksum",
      () => tarball([{ path: "package/a.txt", data: "a", corrupt: true }]),
      /checksum does not match/,
    ],
    [
      "an entry longer than the archive",
      () => tarball([{ path: "package/a.txt", data: "a" }], { gzip: false }).subarray(0, 512),
      /truncated/,
    ],
    [
      "a header cut short",
      () =>
        tarball(
          [
            { path: "package/a.txt", data: "a" },
            { path: "package/b.txt", data: "b" },
          ],
          { gzip: false },
        ).subarray(0, 1024 + 100),
      /truncated/,
    ],
    [
      "a file that is also a directory",
      () =>
        tarball([
          { path: "package/a", data: "a" },
          { path: "package/a/b", data: "b" },
        ]),
      /"a" and "a\/b" would land on one path/,
    ],
    [
      "names equal but for case",
      () =>
        tarball([
          { path: "package/package.json", data: "{}" },
          { path: "package/PACKAGE.JSON", data: "{}" },
        ]),
      /would land on one path/,
    ],
    [
      "names equal once Unicode is normalised",
      () =>
        tarball([
          { path: "package/café.txt", data: "a" },
          { path: "package/café.txt", data: "b" },
        ]),
      /would land on one path/,
    ],
  ])("refuses %s", (_what, archive, pattern) => {
    expect(() => readPackageTarball(archive())).toThrow(TarballError);
    expect(() => readPackageTarball(archive())).toThrow(pattern);
  });

  it("refuses more files than its cap, and a plain tar past its unpacked cap", () => {
    const three = tarball(
      ["a", "b", "c"].map((n) => ({ path: `package/${n}`, data: n })),
      { gzip: false },
    );
    expect(() => readPackageTarball(three, { maxFiles: 2 })).toThrow(/more than 2 files/);
    expect(() => readPackageTarball(three, { maxUnpackedBytes: 512 })).toThrow(
      /unpacks to more than/,
    );
  });
});

describe("which version a spec picks from a registry document", () => {
  const document = {
    "dist-tags": { latest: "1.4.2", next: "2.0.0-rc.1" },
    versions: Object.fromEntries(
      ["0.2.3", "0.2.9", "0.3.0", "1.0.0", "1.4.2", "1.5.0-beta.1", "2.0.0-rc.1"].map((v) => [
        v,
        {},
      ]),
    ),
  };

  it.each([
    [undefined, "1.4.2", "^1.4.2"],
    ["latest", "1.4.2", "^1.4.2"],
    ["next", "2.0.0-rc.1", "^2.0.0-rc.1"],
    ["1.0.0", "1.0.0", "^1.0.0"],
    ["v1.0.0", "1.0.0", "^1.0.0"],
    ["^1.0.0", "1.4.2", "^1.4.2"],
    ["^0.2.0", "0.2.9", "^0.2.9"],
    ["~0.2.3", "0.2.9", "^0.2.9"],
    ["~1.0.0", "1.0.0", "~1.0.0"],
    ["1.x", "1.4.2", "^1.4.2"],
    ["*", "1.4.2", "^1.4.2"],
    ["^1.5.0-beta.0", "1.5.0-beta.1", "^1.5.0-beta.1"],
  ])("%s picks %s and is recorded as %s", (spec, version, recorded) => {
    expect(pickRegistryVersion("@acme/notes", document, spec)).toEqual({ version });
    expect(savedRange(spec, version)).toBe(recorded);
  });

  it.each([
    ["^3.0.0", true],
    ["nope", true],
    [">=1.0.0", false],
    ["1.0.0||2.0.0", false],
    ["9999999999999999999999", true],
  ])("%s picks nothing (unavailable: %s)", (spec, unavailable) => {
    expect(pickRegistryVersion("@acme/notes", document, spec)).toMatchObject({ unavailable });
  });
});

describe("where a package may install", () => {
  it.each<[string, Record<string, unknown>, string, string, string | undefined, boolean]>([
    ["an os named as a string", { os: "linux" }, "linux", "x64", "glibc", true],
    ["an os excluded by name", { os: ["!linux"] }, "linux", "x64", "glibc", false],
    ["any os", { os: ["any"] }, "win32", "x64", undefined, true],
    ["another cpu", { cpu: ["arm64"] }, "linux", "x64", "glibc", false],
    ["the C library this Linux runs on", { libc: ["glibc"] }, "linux", "x64", "glibc", true],
    ["another C library", { libc: ["glibc"] }, "linux", "x64", "musl", false],
    ["a C library list off Linux", { libc: ["glibc"] }, "darwin", "arm64", undefined, false],
  ])("given %s, admits the machine: %s", (_what, manifest, platform, arch, libc, admitted) => {
    expect(platformRefusal(manifest, platform, arch, () => libc) === null).toBe(admitted);
  });

  it("names this machine's own C library: a list of both admits Linux, and nothing else", () => {
    expect(platformRefusal({ libc: ["glibc", "musl"] }) === null).toBe(
      process.platform === "linux",
    );
  });
});
