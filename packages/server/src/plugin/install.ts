/**
 * Installing a plugin package into the data root.
 *
 * A plugin has to EXIST on the machine before `plugins.json` naming it means anything, and
 * where it can exist is not free: the installation directory belongs to the installer (the
 * desktop app's is inside the application bundle, and read-only in the places that matter), so
 * the harness owns one of its own — `<root>/plugins/`, an ordinary npm prefix. `npm install`
 * writes the package there, and the loader resolves from there before the installation.
 *
 * npm is the whole implementation on purpose: a plugin is an npm package, its dependencies are
 * npm's problem, and a registry, a proxy or a private scope is then configured the way every
 * other npm consumer on that machine configures it (.npmrc, the ambient environment).
 *
 * Three sources reach the prefix, all through `npm install`: a package name from the registry,
 * a link npm fetches itself (a git repository or a tarball over https), and the files of an
 * uploaded zip. The zip is packed first (`npm pack --ignore-scripts`, so nothing in it runs at
 * pack time) and the tarball installed, which resolves its dependencies the normal way; the
 * tarball is kept in `<prefix>/archives/`, because npm records the install as a `file:`
 * dependency and reconciles the prefix against it on every later install. No install runs a
 * lifecycle script (`--ignore-scripts`): a plugin package has no reason to.
 * A fourth arrives through the plugin index: a version published on a github release channel
 * is installed by handing the channel's URL to `npm install` itself, and what npm settled is
 * then verified against the sha512 the entry pins, through the integrity npm recorded in the
 * prefix's package-lock (installPluginChannel) — npm stays the first source and carries the
 * bytes; the channel is where an npm-missing name can still come from.
 */
import { execFile } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Component } from "@prismshadow/penguin-core/kernel";
import type { PluginPackages } from "../mechanisms/plugins.js";
import type { IndexChannel } from "./registry.js";

const execFileAsync = promisify(execFile);

/** Long enough for a cold registry fetch with dependencies; short enough not to hang a request. */
const INSTALL_TIMEOUT_MS = 180_000;

/** `<root>/plugins`: the npm prefix this deployment installs plugins into. */
export function pluginsPrefix(root: string): string {
  return path.join(root, "plugins");
}

/** `<prefix>/archives`: the tarballs packed from uploaded zips, which the prefix's manifest names. */
const ARCHIVES_DIR = "archives";
/** `<prefix>/.staging`: where an uploaded package is unpacked and packed; emptied after each install. */
const STAGING_DIR = ".staging";

export class PluginInstallError extends Error {
  /**
   * Why npm failed, when the failure came from npm: "unavailable" — npm answered that the
   * package (or the requested version of it) does not exist on the registry, the one outcome
   * a published-index channel may stand in for; "other" — everything else (a refusing
   * registry, a dependency that will not resolve, a failed lifecycle script), where the
   * channel is not the answer and the failure is reported as is. Undefined on errors that
   * did not come from npm at all.
   */
  reason?: "unavailable" | "other";
}

/** A package npm put in the prefix: its name and the version it settled on. */
export interface InstalledPackage {
  name: string;
  version: string | null;
}

/** The prefix, created with a package.json of its own when it is not there yet. */
async function ensurePrefix(root: string): Promise<string> {
  const prefix = pluginsPrefix(root);
  await fs.mkdir(prefix, { recursive: true });
  // An npm prefix needs a package.json of its own, or npm walks up and installs into whatever
  // it finds above — for a data root under a checkout, that would be the checkout.
  const manifest = path.join(prefix, "package.json");
  try {
    await fs.access(manifest);
  } catch {
    await fs.writeFile(
      manifest,
      `${JSON.stringify({ name: "penguin-plugins", private: true, version: "0.0.0" }, null, 2)}\n`,
    );
  }
  return prefix;
}

/** What the prefix's package.json depends on: package name → what npm recorded (a range, a link, a `file:` tarball). */
export async function prefixDependencies(prefix: string): Promise<Record<string, string>> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(prefix, "package.json"), "utf8")) as {
      dependencies?: Record<string, unknown>;
    };
    return Object.fromEntries(
      Object.entries(manifest.dependencies ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

async function npm(prefix: string, args: readonly string[], cwd = prefix): Promise<string> {
  try {
    // On Windows npm is a batch file, and Node refuses to spawn one directly (`spawn EINVAL`)
    // — every install, from a name, a link or a `file:` tarball, would fail there. cmd.exe is
    // a real executable, so the line runs through it: `/d` skips the AutoRun scripts, and
    // `/s /c` runs the rest as given. Node quotes each argument for its own spawn, but cmd.exe
    // does not honor those quotes as escape — a `|` in a version string or an `&` in a URL
    // would be read as a pipe or a command join. Each argument is therefore wrapped in `cmd`
    // quotes (double quotes with inner pairs doubled, the only form cmd.exe honors) and the
    // whole line is passed as one argument, so no metacharacter of a package name, a version
    // or a link ever reaches the shell.
    const [file, argv] =
      process.platform === "win32"
        ? ([
            "cmd.exe",
            [
              "/d",
              "/s",
              "/c",
              `"${[npmCommand(), ...args].map(cmdQuote).join(" ")}"`,
            ],
          ] as const)
        : ([npmCommand(), [...args]] as const);
    const { stdout } = await execFileAsync(file, argv, {
      cwd,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
      windowsVerbatimArguments: true,
    });
    return stdout;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    const failure = new PluginInstallError(npmReason(stderr, err as Error));
    failure.reason = npmFailureKind(stderr);
    throw failure;
  }
}

/** One argument as cmd.exe reads it: double quotes, with inner double quotes doubled. */
export function cmdQuote(arg: string): string {
  return `"${arg.replaceAll('"', '""')}"`;
}

/**
 * Which bucket a failed npm run falls in, from its stderr's `code E<NAME>` lines: E404 (the
 * package or the requested version is not on the registry) and ETARGET (no version matches
 * the requested range) are the outcomes a published-index channel may stand in for —
 * "unavailable". Everything else — a refusing registry, a dependency that will not resolve,
 * a failed lifecycle script — is "other", and stays a failure. This reads the raw stderr, so
 * it runs before npmReason strips the `code E404` line the answer lives on.
 */
export function npmFailureKind(stderr: string | undefined): "unavailable" | "other" {
  return /npm error code (E404|ETARGET)\b/m.test(stderr ?? "") ? "unavailable" : "other";
}

// Scripts are off for every install, from any source: a plugin package has no reason to run a
// lifecycle script, and an install script that ran is the one refusal the route cannot take
// back after the fact.
const install = (prefix: string, spec: string) =>
  npm(prefix, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--", spec]);

/**
 * Installs (or upgrades) one package into the root's plugin prefix. Returns the version npm
 * settled on, so the caller can report what it actually got rather than what was asked for.
 */
export async function installPluginPackage(
  root: string,
  specifier: string,
): Promise<string | null> {
  const prefix = await ensurePrefix(root);
  await install(prefix, specifier);
  const name = packageName(specifier);
  return name === null ? null : readInstalledVersion(prefix, name);
}

/**
 * Installs a package by name (`name`, `name@range`) or by a link npm fetches (a git repository,
 * a tarball), and answers which package that was. A link names no package until npm has read
 * it, so its name is the dependency the install added to — or changed in — the prefix's
 * package.json; a link installed again changes nothing there, and is then found by what npm
 * recorded for it. The caller has validated the source; this only runs npm on it.
 */
export async function installPluginSource(root: string, source: string): Promise<InstalledPackage> {
  const prefix = await ensurePrefix(root);
  const before = await prefixDependencies(prefix);
  await install(prefix, source);
  const after = await prefixDependencies(prefix);
  const name = source.includes(":")
    ? (changedDependency(before, after) ?? recordedFor(source, after))
    : packageName(source);
  if (name === null) {
    throw new PluginInstallError(`could not tell which package ${source} installed`);
  }
  await pruneArchives(prefix);
  return { name, version: await readInstalledVersion(prefix, name) };
}

/** The one dependency that is new or recorded differently after an install; null when there is not exactly one. */
function changedDependency(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string | null {
  const changed = Object.keys(after).filter((name) => before[name] !== after[name]);
  return changed.length === 1 ? changed[0]! : null;
}

/**
 * The dependency npm recorded a link as: the link itself, or — for a GitHub repository, which
 * npm records in its shorthand — `github:<owner>/<repo>[#ref]`.
 */
function recordedFor(source: string, deps: Readonly<Record<string, string>>): string | null {
  const github = /^(?:git\+)?https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?\/?(#.+)?$/.exec(
    source,
  );
  const forms = new Set([
    source,
    ...(github ? [`github:${github[1]}/${github[2]}${github[3] ?? ""}`] : []),
  ]);
  const found = Object.keys(deps).filter((name) => forms.has(deps[name]!));
  return found.length === 1 ? found[0]! : null;
}

/**
 * Installs the files of an unpacked package directory (relative POSIX path → bytes; checked by
 * the caller: a package.json at the top, no path leaving the directory). They are written to
 * a staging directory under the prefix, packed with `npm pack --ignore-scripts` into
 * `<prefix>/archives/`, and the tarball installed; the staging directory goes either way, and a
 * tarball no install names any more goes with it.
 */
export async function installPluginFiles(
  root: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<InstalledPackage> {
  const prefix = await ensurePrefix(root);
  const staging = path.join(prefix, STAGING_DIR, randomUUID());
  const dir = path.join(staging, "package");
  try {
    for (const [rel, bytes] of files) {
      const file = path.join(dir, ...rel.split("/"));
      if (!file.startsWith(dir + path.sep)) {
        throw new PluginInstallError(`a file of the package leaves its directory: ${rel}`);
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
    }
    const archives = path.join(prefix, ARCHIVES_DIR);
    await fs.mkdir(archives, { recursive: true });
    const packed = await npm(
      prefix,
      ["pack", "--ignore-scripts", "--json", "--pack-destination", archives],
      dir,
    );
    // Named relative to the prefix, so npm records `file:archives/<tarball>` whatever the data
    // root's path goes through: given an absolute path, npm records it relative to the prefix's
    // real path, which climbs to the filesystem root wherever a symlink sits on the way (macOS's
    // temp directory, a data root on a linked disk).
    await install(prefix, `./${ARCHIVES_DIR}/${packedFileName(packed)}`);
    const name = await readPackageName(path.join(dir, "package.json"));
    await pruneArchives(prefix);
    return { name, version: await readInstalledVersion(prefix, name) };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/** The tarball `npm pack --json` wrote: `[{ filename }]` on stdout. */
function packedFileName(stdout: string): string {
  let parsed: unknown;
  try {
    // npm prints its JSON after any notices a lifecycle could not suppress; the array is last.
    parsed = JSON.parse(stdout.slice(stdout.indexOf("[")));
  } catch {
    throw new PluginInstallError("npm pack did not report the tarball it wrote");
  }
  const file = Array.isArray(parsed)
    ? (parsed[0] as { filename?: unknown } | undefined)
    : undefined;
  if (typeof file?.filename !== "string" || path.basename(file.filename) !== file.filename) {
    throw new PluginInstallError("npm pack did not report the tarball it wrote");
  }
  return file.filename;
}

async function readPackageName(manifest: string): Promise<string> {
  const name = (JSON.parse(await fs.readFile(manifest, "utf8")) as { name?: unknown }).name;
  if (typeof name !== "string") throw new PluginInstallError("the package carries no name");
  return name;
}

/**
 * Deletes the tarballs in `<prefix>/archives/` that no dependency of the prefix names any more
 * — the previous version's after a replacement, a removed package's after an uninstall.
 */
async function pruneArchives(prefix: string): Promise<void> {
  const archives = path.join(prefix, ARCHIVES_DIR);
  let names: string[];
  try {
    names = await fs.readdir(archives);
  } catch {
    return;
  }
  const named = new Set(
    Object.values(await prefixDependencies(prefix))
      .filter((spec) => spec.startsWith("file:"))
      .map((spec) => path.basename(spec.slice("file:".length))),
  );
  for (const name of names) {
    if (!named.has(name)) await fs.rm(path.join(archives, name), { force: true });
  }
}

/**
 * Removes a package from the prefix. Through `npm uninstall`, not an rm of its directory:
 * `npm install` records the package in the prefix's own package.json, and a directory
 * removed behind npm's back comes back on the next install of anything else, when npm
 * reconciles the tree with that manifest. A specifier that was never installed is not an
 * error, and a prefix that was never created has nothing to uninstall from.
 */
export async function removePluginPackage(root: string, specifier: string): Promise<void> {
  const prefix = pluginsPrefix(root);
  const name = packageName(specifier);
  if (name === null) return;
  try {
    await fs.access(path.join(prefix, "package.json"));
  } catch {
    return;
  }
  await npm(prefix, ["uninstall", "--ignore-scripts", "--no-audit", "--no-fund", "--", name]);
  await pruneArchives(prefix);
}

/** The bare or scoped name of a specifier, without any version range; null for a non-name. */
function packageName(specifier: string): string | null {
  const at = specifier.lastIndexOf("@");
  const name = at > 0 ? specifier.slice(0, at) : specifier;
  if (name === "" || name.includes("..") || path.isAbsolute(name)) return null;
  return name;
}

/** `<prefix>/node_modules/<name>` for a bare or scoped name. */
export function installedPackageDir(prefix: string, name: string): string {
  return path.join(prefix, "node_modules", ...name.split("/"));
}

/** The version of a package in the prefix, or null when it is not there. */
export async function readInstalledVersion(prefix: string, name: string): Promise<string | null> {
  try {
    const raw = JSON.parse(
      await fs.readFile(path.join(installedPackageDir(prefix, name), "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof raw.version === "string" ? raw.version : null;
  } catch {
    return null;
  }
}

/**
 * The line of npm's stderr worth showing. npm ends every failure with "A complete log of this
 * run can be found in …", so the last line is the one line that never says anything; the
 * reason is the first `npm error` line that is not that pointer, not a bare code, and not the
 * empty continuation lines npm pads the block with.
 */
function npmReason(stderr: string | undefined, err: Error): string {
  const lines = (stderr ?? "")
    .split("\n")
    .map((l) => l.replace(/^npm (error|ERR!)\s*/, "").trim())
    .filter((l) => l !== "" && !/^A complete log/.test(l) && !/^code [A-Z0-9]+$/.test(l));
  const reason = lines.find((l) => l.length > 8);
  return reason ?? err.message;
}

/** Windows resolves `npm` through npm.cmd; everywhere else the plain name is on PATH. */
function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/**
 * Installs a version through an index entry's github channel, with npm carrying the bytes:
 * the channel's URL is handed to `npm install` as a plain link spec (npm downloads it, in
 * its own streaming pipeline, with its own retries and timeouts — nothing of the release
 * asset is held in this process's memory), and what npm settled is then checked against the
 * index, both ways:
 *
 *   - the package-lock.json npm wrote into the prefix records the dependency with the
 *     `integrity` npm itself computed for what it downloaded; that digest has to equal the
 *     `sha512-<base64>` the index entry pins — a release asset that was replaced, or that
 *     came from anywhere but the pinned source, fails the comparison and is uninstalled;
 *   - the installed package's own manifest has to agree with the entry's name and version,
 *     so the prefix never holds a package the index did not publish under that name.
 *
 * A mismatch uninstalls the package (`npm uninstall`) and refuses the install; a missing or
 * unreadable integrity pin refuses before npm runs at all. `install` is injectable so a test
 * stands in for npm. The route's stream still names a download phase and its progress events
 * for a channel install (plugins-installed.ts) — npm reports no per-byte progress, so the
 * events say the download is under way and hand the total when the asset's size is known,
 * which is the page's contract, not npm's.
 */
export async function installPluginChannel(
  root: string,
  channel: IndexChannel,
  { install: run = (prefix, spec) => install(prefix, spec).then(() => undefined) }: {
    install?: (prefix: string, spec: string) => Promise<void>;
  } = {},
): Promise<InstalledPackage> {
  // The pin is read before anything runs: an entry whose integrity npm's own shape cannot
  // even describe has nothing to be verified against, and nothing is installed.
  const pinned = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(channel.integrity);
  if (pinned === null) {
    throw new PluginInstallError(
      `the index entry's integrity is not sha512-<base64>: ${JSON.stringify(channel.integrity)}`,
    );
  }
  const prefix = await ensurePrefix(root);
  await run(prefix, channel.url);
  const lock = await readLockfileIntegrity(prefix, channel.name);
  if (lock === null) {
    await uninstall(prefix, channel.name);
    throw new PluginInstallError(
      `the prefix's package-lock.json records no integrity for ${channel.name}; the install cannot be verified against the sha512 the index pins, and it is uninstalled`,
    );
  }
  // The lock's integrity is npm's own shape, `sha512-<base64>`; the pin's digest is the
  // base64 after its prefix. Compare digests, not strings.
  const actual = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(lock)?.[1];
  const expected = pinned[1]!;
  if (
    actual === undefined ||
    actual.length !== expected.length ||
    !timingSafeEqual(Buffer.from(actual, "base64"), Buffer.from(expected, "base64"))
  ) {
    await uninstall(prefix, channel.name);
    throw new PluginInstallError(
      `what npm downloaded for ${channel.name} does not match the sha512 the index entry pins (${lock} vs sha512-${expected}); it was uninstalled and is not installed`,
    );
  }
  const version = await readInstalledVersion(prefix, channel.name);
  if (version !== channel.version) {
    await uninstall(prefix, channel.name);
    throw new PluginInstallError(
      `npm settled on ${JSON.stringify(version ?? null)} for ${channel.name}, not the ${channel.version} the index entry publishes; it was uninstalled and is not installed`,
    );
  }
  return { name: channel.name, version };
}

/**
 * The `integrity` npm recorded for one dependency in the prefix's package-lock.json — the
 * digest npm computed over what IT downloaded, the only hash that says what actually landed
 * on the disk. Null when the lock carries none: an install npm could not pin (a link it
 * served without an integrity) cannot be verified against the index and is refused.
 */
async function readLockfileIntegrity(prefix: string, name: string): Promise<string | null> {
  let lock: {
    packages?: Record<string, { integrity?: unknown }>;
  };
  try {
    lock = JSON.parse(await fs.readFile(path.join(prefix, "package-lock.json"), "utf8"));
  } catch {
    return null;
  }
  // The lock's rows are keyed by the path under node_modules, `node_modules/<name>`, with a
  // scope spelled as a directory (`node_modules/@scope/pkg`).
  const row = lock.packages?.[`node_modules/${name}`];
  return typeof row?.integrity === "string" ? row.integrity : null;
}

/** Uninstalls one name from the prefix, leaving nothing a later install could reconcile in. */
async function uninstall(prefix: string, name: string): Promise<void> {
  await npm(prefix, ["uninstall", "--ignore-scripts", "--no-audit", "--no-fund", "--", name]);
  await pruneArchives(prefix);
}

/**
 * The installer as a node, so a test stands in for npm instead of running it: the routes reach
 * the prefix only through this.
 */
@Component()
export class NpmPluginPackages implements PluginPackages {
  /** By name or by link (see installPluginSource). */
  install(root: string, source: string): Promise<InstalledPackage> {
    return installPluginSource(root, source);
  }

  /** An uploaded package's files (see installPluginFiles). */
  installFiles(root: string, files: Record<string, Uint8Array>): Promise<InstalledPackage> {
    return installPluginFiles(root, new Map(Object.entries(files)));
  }

  remove(root: string, name: string): Promise<void> {
    return removePluginPackage(root, name);
  }
}
