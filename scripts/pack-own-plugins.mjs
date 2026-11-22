#!/usr/bin/env node
/**
 * The plugins that carry their own version (scripts/lib/own-version-plugins.mjs), packed the way
 * the release ships them: one tarball per plugin, which release.yml attaches to the tag's GitHub
 * Release and publishes to npm as it is. Every channel then serves one set of bytes, and the
 * plugin index registers one sha512 for all of them.
 *
 *   node scripts/pack-own-plugins.mjs [--build] [--out <dir>] [--offline <dir>] [--registry]
 *
 * For each plugin (`--build` runs the package's own `build` before each pack, so the second pack
 * is of a second build):
 *   1. its manifest names no workspace package as `workspace:*`, `workspace:^` or `workspace:~`.
 *      pnpm pack writes that package's current version in their place, which is the harness's
 *      version, so the tarball would change with every harness release while the plugin's own
 *      version stood still. A range (`workspace:>=0.2.0`) is packed as written;
 *   2. `pnpm pack` twice gives the same bytes, so the sha512 belongs to the source and not to
 *      the run. The tarball carries the version committed in package.json (HEAD's, where git can
 *      tell), which nothing in the release path may rewrite, everything its `files` names (npm
 *      skips a missing entry without a word: an unbuilt `ifaces.json` would ship a plugin no
 *      host can read) and the repository's LICENSE;
 *   3. with `--offline <dir>`, the build's offline archive of the plugin (`<dir>/index.json`,
 *      scripts/lib/offline-archives.mjs) is those same bytes;
 *   4. with `--registry`, a version npm already has with other bytes is reported: the package
 *      changed without its version moving, and a release would attach a tarball npm does not
 *      serve. That is a warning, as a name npm has never seen is (scripts/check-publishable.mjs).
 *
 * `--out <dir>` receives each plugin's tarball under the name `pnpm pack` gives it, the file a
 * release attaches. Exits non-zero when any check of 1–3 fails.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { integrityOf } from "./lib/offline-archives.mjs";
import { ownVersionPackages } from "./lib/own-version-plugins.mjs";
import { run } from "./lib/run-command.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
/** The workspace ranges pnpm pack replaces with the named package's current version. */
const CURRENT_VERSION = /^workspace:[*^~]$/;

/** The dependency entries of `manifest` that pack as the workspace's current version. */
export function currentVersionRanges(manifest) {
  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries(manifest[field] ?? {})
      .filter(([, range]) => CURRENT_VERSION.test(String(range)))
      .map(([dep, range]) => `${field} ${dep} "${range}"`),
  );
}

/** The paths a tarball holds. */
function entries(tarball) {
  return execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean);
}

/** One file of a tarball, or null where the tarball has none. */
function member(tarball, file) {
  try {
    return execFileSync("tar", ["-xzOf", tarball, `package/${file}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** The version `dir`'s package.json carries at HEAD, or null where git cannot tell. */
function committedVersion(dir) {
  const rel = path.relative(ROOT, path.join(dir, "package.json")).split(path.sep).join("/");
  try {
    const text = execFileSync("git", ["show", `HEAD:${rel}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(text).version ?? null;
  } catch {
    return null;
  }
}

/** The sha512 npm reports for `name@version`, or "" where npm has no such version. */
function publishedIntegrity(name, version) {
  try {
    return execFileSync("npm", ["view", `${name}@${version}`, "dist.integrity"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** Packs `dir` into the empty directory `dest` and answers the tarball's path. */
async function pack(dir, dest) {
  await fsp.mkdir(dest, { recursive: true });
  await run("pnpm", ["pack", "--pack-destination", dest], dir);
  const made = (await fsp.readdir(dest)).filter((f) => f.endsWith(".tgz"));
  if (made.length !== 1) throw new Error(`pnpm pack left ${made.length} tarballs in ${dest}`);
  return path.join(dest, made[0]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      build: { type: "boolean" },
      out: { type: "string" },
      offline: { type: "string" },
      registry: { type: "boolean" },
    },
  });
  const offline = values.offline
    ? JSON.parse(fs.readFileSync(path.join(values.offline, "index.json"), "utf8"))
    : null;
  const license = fs.readFileSync(path.join(ROOT, "LICENSE"));
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-own-plugins-"));
  const problems = [];
  try {
    for (const plugin of ownVersionPackages(ROOT)) {
      const before = problems.length;
      const fail = (message) => problems.push(`${plugin.name}: ${message}`);
      const ranges = currentVersionRanges(plugin.manifest);
      if (ranges.length > 0) {
        fail(
          `package.json names ${ranges.join(", ")}, which pnpm pack replaces with the harness's ` +
            "version; write a range (workspace:>=x.y.z) so the tarball is the plugin's alone",
        );
        continue;
      }
      const unscoped = plugin.name.replace(/^@[^/]+\//, "");
      const packOnce = async (n) => {
        if (values.build) await run("pnpm", ["--filter", plugin.name, "run", "build"], ROOT);
        return pack(plugin.dir, path.join(work, unscoped, `pack-${n}`));
      };
      const first = await packOnce(1);
      const second = await packOnce(2);
      const integrity = integrityOf(await fsp.readFile(first));
      if (integrityOf(await fsp.readFile(second)) !== integrity) {
        fail("two packs of one source differ, so no sha512 can stand for its content");
        continue;
      }
      const packed = JSON.parse(String(member(first, "package.json")));
      const committed = committedVersion(plugin.dir);
      if (
        packed.version !== plugin.version ||
        (committed !== null && committed !== packed.version)
      ) {
        fail(
          `the tarball carries ${packed.version}, its package.json was committed with ` +
            `${committed ?? plugin.version}: something rewrote a version that is its own`,
        );
      }
      const held = entries(first);
      // A glob in `files` names no one path, so only the plain entries are looked for.
      const absent = (plugin.manifest.files ?? [])
        .filter((entry) => !/[*?[\]{}!]/.test(entry))
        .map((entry) => entry.replace(/^\.\/|\/+$/g, ""))
        .filter(
          (entry) =>
            !held.some((p) => p === `package/${entry}` || p.startsWith(`package/${entry}/`)),
        );
      if (absent.length > 0) {
        fail(`the tarball lacks ${absent.join(", ")}: build the package first`);
      }
      if (!member(first, "LICENSE")?.equals(license)) {
        fail("the tarball does not carry the repository's LICENSE");
      }
      if (offline !== null) {
        const row = offline.find((r) => r.name === plugin.name);
        if (row === undefined) fail(`the build carries no offline archive of it`);
        else if (row.version !== packed.version || row.integrity !== integrity) {
          fail(
            `the build's offline archive is ${row.version} ${row.integrity}, the release packs ` +
              `${packed.version} ${integrity}`,
          );
        }
      }
      if (values.registry) {
        const published = publishedIntegrity(plugin.name, packed.version);
        if (published !== "" && published !== integrity) {
          console.log(
            `::warning::${plugin.name}@${packed.version} is on npm as ${published}, but this ` +
              `tree packs ${integrity}: the package changed without its version moving. Raise ` +
              "its version in package.json, or the next release attaches bytes npm does not serve.",
          );
        }
      }
      if (problems.length > before) continue;
      const file = path.basename(first);
      if (values.out) {
        await fsp.mkdir(values.out, { recursive: true });
        await fsp.copyFile(first, path.join(values.out, file));
      }
      console.log(`${plugin.name}@${packed.version}: ${file} ${integrity}`);
    }
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
  if (problems.length > 0) {
    console.error(`own-version plugins:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
}
