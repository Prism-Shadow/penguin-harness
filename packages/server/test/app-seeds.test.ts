/**
 * The seeds a built-in plugin ships for a system app's data (PRFC-0036 `ProjectsModule.appSeeds`).
 *
 * Copying (copyAppSeeds, over real folders):
 * - Given a built-in package the Project lists, each folder under its seeds path lands in the
 *   app's data folder under its own name, its files and subfolders with it; a name already taken
 *   there is left as it was.
 * - A package the Project does not list, one installed into the data root's prefix (which shadows
 *   a built-in copy of the same name), and one listed by a path seed nothing.
 * - A seeds path that climbs out of the package, and a seeds folder that is a link out of it, are
 *   ignored and logged; a link inside a seed is not copied.
 *
 * At a Project's creation (the real app):
 * - The first owner's adoption of a `default_project` the CLI made, listing a built-in package,
 *   writes that package's seeds into the system Agent's data folder of the app.
 * - Nothing later writes them: a seed the user deleted stays deleted across a restart, and a
 *   Project that lists the package only after it was created never gets them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentDir, projectConfigPath, SYSTEM_AGENT_ID } from "@prismshadow/penguin-core";
import { copyAppSeeds } from "../src/services/app-seeds.js";
import type { SeedTarget } from "../src/services/app-seeds.js";
import type { PluginBase } from "../src/plugin/loader.js";
import {
  createTestApp,
  makeTempRoot,
  provisionUser,
  removeTempRoot,
  restartTestApp,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PKG = "@acme/seeded";
const PROJECT = "default_project";

/** A package's files: a table whose one module declares seeds for `app` at `seedsPath`, and the seeds. */
function seededPackage(
  name: string,
  seeds: Record<string, string>,
  seedsPath = "seeds/fixture",
  app = "fixture",
): Record<string, string> {
  return {
    "package.json": JSON.stringify({ name, version: "1.0.0", type: "module", main: "./index.js" }),
    "ifaces.json": JSON.stringify({
      ifaces: {},
      types: {},
      modules: {
        Seeded: {
          name: "Seeded",
          requires: {},
          provides: {},
          contributes: {
            "ProjectsModule.appSeeds": [{ id: "seeded.seeds", app, path: seedsPath }],
          },
          children: [],
        },
      },
      plugin: { modules: ["Seeded"], replaces: [] },
    }),
    ...Object.fromEntries(
      Object.entries(seeds).map(([rel, body]) => [`seeds/fixture/${rel}`, body]),
    ),
  };
}

/** Writes `files` as package `name` into the npm prefix `prefix`, listed in its manifest. */
async function intoPrefix(prefix: string, name: string, files: Record<string, string>) {
  const dir = path.join(prefix, "node_modules", ...name.split("/"));
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), body);
  }
  const manifest = path.join(prefix, "package.json");
  const listed = JSON.parse(await fs.readFile(manifest, "utf8").catch(() => "{}")) as {
    dependencies?: Record<string, string>;
  };
  await fs.writeFile(
    manifest,
    JSON.stringify({ private: true, dependencies: { ...listed.dependencies, [name]: "1.0.0" } }),
  );
  return dir;
}

/** Lists `packages` in the shared `[plugins]` table of a Project's config, written as the CLI writes one. */
async function listIn(root: string, projectId: string, packages: string[]) {
  const file = projectConfigPath(root, projectId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const prior = await fs.readFile(file, "utf8").catch(() => "");
  const table = packages.map((p) => `${JSON.stringify(p)} = "*"`).join("\n");
  await fs.writeFile(file, `${prior}\n[plugins]\n${table}\n`);
}

const tree = async (dir: string): Promise<string[]> =>
  (await fs.readdir(dir, { recursive: true }).catch(() => [] as string[]))
    .map((p) => p.split(path.sep).join("/"))
    .sort();

describe("copyAppSeeds", () => {
  let root: string;
  let builtin: string;
  let user: string;
  let lines: string[];
  let target: SeedTarget;
  const data = (app = "fixture") => path.join(root, "data", app);

  beforeEach(async () => {
    root = await makeTempRoot();
    builtin = path.join(root, "shipped");
    user = path.join(root, "plugins");
    lines = [];
    const bases: PluginBase[] = [
      { file: path.join(user, "package.json"), builtin: false },
      { file: path.join(builtin, "package.json"), builtin: true },
    ];
    target = {
      root,
      projectId: "p1",
      machineId: null,
      bases,
      dataDirOf: async (app) => {
        await fs.mkdir(data(app), { recursive: true });
        return data(app);
      },
      log: (line) => lines.push(line),
    };
  });
  afterEach(async () => {
    await removeTempRoot(root);
  });

  it("copies each seed folder of a listed built-in package once, leaving a taken name alone", async () => {
    await intoPrefix(
      builtin,
      PKG,
      seededPackage(PKG, { "alpha/a.txt": "a", "alpha/deep/d.txt": "d", "beta/b.txt": "b" }),
    );
    await listIn(root, "p1", [PKG]);
    await fs.mkdir(path.join(data(), "beta"), { recursive: true });
    await fs.writeFile(path.join(data(), "beta", "mine.txt"), "mine");

    await copyAppSeeds(target);

    expect(await tree(data())).toEqual([
      "alpha",
      "alpha/a.txt",
      "alpha/deep",
      "alpha/deep/d.txt",
      "beta",
      "beta/mine.txt",
    ]);
    expect(await fs.readFile(path.join(data(), "alpha", "deep", "d.txt"), "utf8")).toBe("d");
  });

  it("seeds nothing from a package that is unlisted, installed by the operator, or listed by a path", async () => {
    await intoPrefix(builtin, PKG, seededPackage(PKG, { "alpha/a.txt": "a" }));
    await intoPrefix(
      builtin,
      "@acme/unlisted",
      seededPackage("@acme/unlisted", { "u/u.txt": "u" }),
    );
    // The operator's copy under <root>/plugins shadows the shipped one of the same name.
    await intoPrefix(
      builtin,
      "@acme/shadowed",
      seededPackage("@acme/shadowed", { "s/s.txt": "s" }),
    );
    await intoPrefix(user, "@acme/shadowed", seededPackage("@acme/shadowed", { "o/o.txt": "o" }));
    const checkout = path.join(builtin, "node_modules", ...PKG.split("/"), "index.js");
    await listIn(root, "p1", ["@acme/shadowed", checkout]);

    await copyAppSeeds(target);

    expect(await tree(data())).toEqual([]);
  });

  it("ignores a seeds path out of the package and a seeds folder that links out, and copies no link", async () => {
    const outside = path.join(root, "outside");
    await fs.mkdir(path.join(outside, "stolen"), { recursive: true });
    await fs.writeFile(path.join(outside, "stolen", "secret.txt"), "secret");
    await intoPrefix(builtin, "@acme/climbs", seededPackage("@acme/climbs", {}, "../../outside"));
    const linked = await intoPrefix(builtin, "@acme/linked", seededPackage("@acme/linked", {}));
    await fs.mkdir(path.join(linked, "seeds"), { recursive: true });
    await fs.symlink(outside, path.join(linked, "seeds", "fixture"), "dir");
    const inner = await intoPrefix(builtin, PKG, seededPackage(PKG, { "alpha/a.txt": "a" }));
    await fs.symlink(
      path.join(outside, "stolen"),
      path.join(inner, "seeds", "fixture", "alpha", "stolen"),
      "dir",
    );
    await listIn(root, "p1", ["@acme/climbs", "@acme/linked", PKG]);

    await copyAppSeeds(target);

    expect(await tree(data())).toEqual(["alpha", "alpha/a.txt"]);
    expect(lines.some((l) => l.includes("@acme/climbs"))).toBe(true);
    expect(lines.some((l) => l.includes("@acme/linked"))).toBe(true);
  });
});

describe("app seeds at a Project's creation", () => {
  let t: TestApp;
  let assets: string;
  let root: string;
  const seedsOf = (app: TestApp, projectId: string) =>
    tree(path.join(agentDir(app.root, projectId, SYSTEM_AGENT_ID), "app", "data", "fixture"));

  beforeAll(async () => {
    root = await makeTempRoot();
    assets = path.join(root, "pushed-assets");
    await intoPrefix(
      path.join(assets, "plugins"),
      PKG,
      seededPackage(PKG, { "alpha/a.txt": "a", "beta/b.txt": "b" }),
    );
    t = await createTestApp({
      durableDatabase: true,
      assetsDir: assets,
      // The data root a CLI made first: its default_project lists the package already.
      beforeSeed: (at) => listIn(at, PROJECT, [PKG]),
    });
  });
  afterAll(async () => {
    await t.cleanup();
    await removeTempRoot(root);
  });

  it("writes the listed built-in package's seeds when the first owner adopts default_project", async () => {
    expect(await seedsOf(t, PROJECT)).toEqual(["alpha", "alpha/a.txt", "beta", "beta/b.txt"]);
  });

  it("never writes them again: a deleted seed stays deleted, and a later listing gets none", async () => {
    const { user } = await provisionUser(t.app, "later");
    const later = `${user.userId}-default_project`;
    await listIn(t.root, later, [PKG]);
    await fs.rm(
      path.join(agentDir(t.root, PROJECT, SYSTEM_AGENT_ID), "app", "data", "fixture", "beta"),
      { recursive: true },
    );

    t = await restartTestApp(t, { assetsDir: assets });

    expect(await seedsOf(t, PROJECT)).toEqual(["alpha", "alpha/a.txt"]);
    expect(await seedsOf(t, later)).toEqual([]);
  });
});
