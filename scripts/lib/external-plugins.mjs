/**
 * External built-in plugins (PRFC-0036): `@penguinharness/*` packages published from their own
 * repositories and shipped preinstalled like the `plugins/*` packages of this one.
 *
 * Each is pinned to one exact version in the `dependencies` of the three host packages —
 * packages/server (the plugin library and the built-in prefix), packages/cli (the npm CLI's
 * library) and packages/desktop — and pnpm-lock.yaml records the sha512 of the tarball that
 * version is: the one lock. A plugin of this repository is a `workspace:` dependency of the
 * hosts, so a `@penguinharness/*` dependency that is not one is external.
 *
 * scripts/build-plugins.mjs stages each one with a code entry in the built-in prefix, from the
 * locked tarball this module finds and checks, trying in order:
 *
 *   1. `PENGUIN_PLUGIN_TARBALLS=<dir>`: the file `npm pack` names, `penguinharness-<name>-<version>.tgz`;
 *   2. npm: `npm pack <name>@<version>`, which reads npm's cache before its registry — a cache
 *      warmed with `npm cache add <name>@<version>` builds offline;
 *   3. the github channel of the version's entry in the plugin index (scripts/lib/plugin-index.mjs).
 *
 * A source that cannot supply the tarball hands over to the next; a tarball whose sha512 is not
 * the lock's fails the build wherever it came from. pnpm's store is not a source: it keeps a
 * package's files, not the tarball they came in, so the lock's sha512 cannot be checked there.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFromGithubChannel, pluginIndexUrl } from "./plugin-index.mjs";
import { run } from "./run-command.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// The server's own dependency, as scripts/asset-archives.mjs uses it.
const tar = createRequire(path.join(REPO, "packages", "server", "package.json"))("tar");

/** The packages that list the shipped plugins, each by its directory (its lockfile importer). */
export const HOST_PACKAGES = ["packages/server", "packages/cli", "packages/desktop"];
/** The host whose pins the built-in prefix ships. */
const PREFIX_HOST = "packages/server";
const SCOPE = "@penguinharness/";
/** One exact semver version: what a pin is. */
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The external `@penguinharness/*` dependencies a host's package.json names: name → range. */
function externalRanges(root, host) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, host, "package.json"), "utf8"));
  return new Map(
    Object.entries(pkg.dependencies ?? {}).filter(
      ([name, range]) => name.startsWith(SCOPE) && !String(range).startsWith("workspace:"),
    ),
  );
}

/** What pnpm-lock.yaml resolves `name` to for `host`: its version and that version's integrity. */
function lockedFor(lock, host, name) {
  // `0.1.0(<peers>)` → `0.1.0`, as scripts/lib/locked-prefix.mjs reads a ref.
  const version = lock.importers?.[host]?.dependencies?.[name]?.version?.replace(/\(.*$/, "");
  const integrity =
    version === undefined
      ? undefined
      : lock.packages?.[`${name}@${version}`]?.resolution?.integrity;
  return { version, integrity };
}

/** Why `host`'s pin of `name` cannot be shipped, or null. */
function pinFault(lock, host, name, range) {
  if (!EXACT.test(range)) {
    return `${host} names ${name} "${range}": an external built-in plugin is pinned to one exact version`;
  }
  const { version, integrity } = lockedFor(lock, host, name);
  if (version !== range) {
    return `pnpm-lock.yaml resolves ${name} for ${host} to ${version ?? "nothing"}, not ${range}: run pnpm install`;
  }
  if (!integrity?.startsWith("sha512-")) {
    return `pnpm-lock.yaml records no sha512 integrity for ${name}@${range}`;
  }
  return null;
}

/**
 * The external built-in plugins the built-in prefix ships — packages/server's pins — as
 * `{ name, version, integrity }`, by name. Throws when one is not pinned the way a build can
 * ship it: a range rather than an exact version, or a lock that does not resolve it to that
 * version with a sha512.
 */
export function externalPins(root, lock) {
  const pins = [];
  for (const [name, range] of [...externalRanges(root, PREFIX_HOST)].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const fault = pinFault(lock, PREFIX_HOST, name, range);
    if (fault !== null) throw new Error(fault);
    pins.push({ name, version: range, integrity: lockedFor(lock, PREFIX_HOST, name).integrity });
  }
  return pins;
}

/**
 * Every way the three hosts' pins fall short of one shipped set, as messages (empty when they
 * agree): a package one host pins and another does not, two versions of one package, a range
 * instead of a version, a lock that does not resolve the pin.
 */
export function pinProblems(root, lock) {
  const hosts = HOST_PACKAGES.map((host) => ({ host, ranges: externalRanges(root, host) }));
  const names = [...new Set(hosts.flatMap(({ ranges }) => [...ranges.keys()]))].sort();
  const problems = [];
  for (const name of names) {
    const pinned = hosts.filter(({ ranges }) => ranges.has(name));
    if (pinned.length < hosts.length) {
      const missing = hosts.filter(({ ranges }) => !ranges.has(name)).map(({ host }) => host);
      problems.push(
        `${name} is pinned in ${pinned.map(({ host }) => host).join(", ")} but not in ${missing.join(", ")}: the hosts ship it together`,
      );
    }
    const ranges = new Set(pinned.map(({ ranges }) => ranges.get(name)));
    if (ranges.size > 1) {
      const each = pinned.map(({ host, ranges }) => `${host} ${ranges.get(name)}`).join(", ");
      problems.push(`${name} is pinned to different versions: ${each}`);
    }
    for (const { host, ranges } of pinned) {
      const fault = pinFault(lock, host, name, ranges.get(name));
      if (fault !== null) problems.push(fault);
    }
  }
  return problems;
}

/** The file `npm pack` writes for a package: `@scope/name` 1.0.0 → `scope-name-1.0.0.tgz`. */
export function tarballName({ name, version }) {
  return `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

const sha512 = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

/** The one failure no later source may paper over: bytes that are not the locked ones. */
class NotTheLockedTarball extends Error {}

/** `file`, when it is the tarball `pin` locks; throws otherwise. */
async function checked(pin, file, source) {
  const found = sha512(await fsp.readFile(file));
  if (found !== pin.integrity) {
    throw new NotTheLockedTarball(
      `${pin.name}@${pin.version} from ${source} is not the locked tarball: its sha512 is ${found}, pnpm-lock.yaml pins ${pin.integrity}`,
    );
  }
  return { file, source };
}

const reason = (err) => (err instanceof Error ? err.message : String(err)).split("\n")[0];

/** What npm said when it failed: its own error lines, without the pointer to its log file. */
function npmReason(err) {
  const lines = (err instanceof Error ? err.message : String(err)).split("\n");
  const said = lines
    .filter((line) => /^npm (error|ERR!)/.test(line) && !/complete log of this run/i.test(line))
    .map((line) => line.replace(/^npm (error|ERR!) ?/, "").trim())
    .filter((line) => line !== "");
  return said.length > 0 ? said.join("; ") : lines[0];
}

/**
 * The locked tarball of `pin`, written into the empty directory `into`: `{ file, source }`.
 * Throws when its bytes are not the lock's, or when no source can supply it (naming what each
 * said, and what an offline build needs).
 */
export async function lockedTarball(pin, { into, env = process.env }) {
  const name = tarballName(pin);
  const tried = [];
  const dir = env.PENGUIN_PLUGIN_TARBALLS;
  if (dir) {
    const file = path.resolve(dir, name);
    if (fs.existsSync(file)) return checked(pin, file, `PENGUIN_PLUGIN_TARBALLS (${file})`);
    tried.push(`PENGUIN_PLUGIN_TARBALLS: no ${name} in ${path.resolve(dir)}`);
  }
  const target = path.join(into, name);
  try {
    // A registry spec is packed as the registry serves it: the published tarball, byte for byte.
    await run(
      "npm",
      ["pack", `${pin.name}@${pin.version}`, "--pack-destination", into, "--prefer-offline"],
      into,
      env,
    );
    return await checked(pin, target, "npm");
  } catch (err) {
    if (err instanceof NotTheLockedTarball) throw err;
    tried.push(`npm: ${npmReason(err)}`);
  }
  try {
    const { bytes, source } = await fetchFromGithubChannel(pin, pluginIndexUrl(env));
    await fsp.writeFile(target, bytes);
    return await checked(pin, target, source);
  } catch (err) {
    if (err instanceof NotTheLockedTarball) throw err;
    tried.push(`github channel: ${reason(err)}`);
  }
  throw new Error(
    `no source supplied ${pin.name}@${pin.version} (${pin.integrity}):\n  ${tried.join("\n  ")}\n` +
      `An offline build needs ${name} in PENGUIN_PLUGIN_TARBALLS=<dir>, or npm's cache warmed with \`npm cache add ${pin.name}@${pin.version}\`.`,
  );
}

/** Archive entries that are a package's content: files and directories, never links. */
const CONTENT = new Set(["File", "OldFile", "ContiguousFile", "Directory"]);

/**
 * Unpacks a package tarball into `dir` the way npm unpacks one — the archive's top directory
 * stripped, links dropped, every file readable and executable only where the archive marks it
 * so — and returns its package.json.
 */
export async function unpackPackage(file, dir) {
  await fsp.mkdir(dir, { recursive: true });
  await tar.x({ file, cwd: dir, strip: 1, filter: (_path, entry) => CONTENT.has(entry.type) });
  for (const entry of await fsp.readdir(dir, { recursive: true, withFileTypes: true })) {
    const abs = path.join(entry.parentPath, entry.name);
    if (entry.isDirectory()) await fsp.chmod(abs, 0o755);
    else await fsp.chmod(abs, ((await fsp.stat(abs)).mode & 0o111) !== 0 ? 0o755 : 0o644);
  }
  return JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
}
