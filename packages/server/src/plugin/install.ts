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
 * dependency and reconciles the prefix against it on every later install. Installing runs the
 * package's install scripts exactly as installing it from the registry does — the same trust.
 * A fourth arrives through the plugin index: a version published on a github release channel
 * has its release URL installed by npm itself — the URL is a spec npm natively understands
 * (a gzipped tarball over https) — and what npm actually installed is verified after the
 * fact against the sha512 the entry pins (installPluginChannel) — npm stays the first source;
 * the channel is where an npm-missing name can still come from.
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
/** One address's npm window: a dead address costs this, not a hang. */
const CHANNEL_TIMEOUT_MS = 15_000;
/**
 * The asset address npm last installed from and whose install verified for each channel URL,
 * tried first next time. Memory, not a speed test: the walk still tries one address at a time
 * in a fixed order, only its start moves. A dead canonical would otherwise cost its window on
 * every install; starting where the last install succeeded returns the common case to one
 * address. Keyed by the channel URL, so two sources' assets never lend each other's start.
 */
const lastGoodAsset = new Map<string, string>();

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

/**
 * The registry URL the installer's npm runs are pointed at, set by the Plugin sources
 * settings group (see source-settings.ts). Undefined — the default — passes nothing: npm's
 * own configuration (its .npmrc chain, the ambient environment) answers, exactly as before
 * the group existed. Set, it rides every npm run of the installer as `--registry`, which
 * overrides that chain for the plugins' installs without touching how npm is configured on
 * the machine.
 */
let npmRegistry: string | undefined = undefined;

/** The settings group sets (or clears) the registry the installer's npm runs are pointed at. */
export function setNpmRegistry(url: string | undefined): void {
  npmRegistry = url;
}

async function npm(
  prefix: string,
  args: readonly string[],
  cwd = prefix,
  window = INSTALL_TIMEOUT_MS,
): Promise<string> {
  try {
    // On Windows npm is a batch file, and Node refuses to spawn one directly (`spawn EINVAL`)
    // — every install, from a name, a link or a `file:` tarball, would fail there. cmd.exe is
    // a real executable, so the line runs through it: `/d` skips the AutoRun scripts, and
    // `/s /c` runs the rest as given, with each argument quoted by Node on the way in.
    const [file, argv] =
      process.platform === "win32"
        ? (["cmd.exe", ["/d", "/s", "/c", npmCommand(), ...args]] as const)
        : ([npmCommand(), [...args]] as const);
    const { stdout } = await execFileAsync(file, argv, {
      cwd,
      timeout: window,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    return stdout;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    const failure = new PluginInstallError(npmReason(stderr, err as Error));
    failure.reason = npmFailureKind(stderr);
    throw failure;
  }
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

const install = (prefix: string, spec: string) =>
  npm(prefix, [
    ...(npmRegistry !== undefined ? [`--registry=${npmRegistry}`] : []),
    "install",
    "--no-audit",
    "--no-fund",
    "--omit=dev",
    "--",
    spec,
  ]);

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
  await npm(prefix, ["uninstall", "--no-audit", "--no-fund", "--", name]);
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
 * The per-address timeout the channel install's npm runs carry. The walk still tries one
 * address at a time in a fixed order, only its start moves: the sticky start (the address
 * that last installed and verified) goes first, the URL the index published and this
 * source's CDN mirrors follow in their configured order, and a dead start hands the walk
 * back to that order within the same install. Each address's npm run carries its own
 * timeout, so a dead one costs one window, not a hang. All of them failed: the error names
 * the addresses that were tried and the failure it ended on.
 */

/** The prefix's package-lock.json, the record npm keeps of what it actually installed. */
interface LockEntry {
  resolved?: unknown;
  integrity?: unknown;
}

/** The prefix's package-lock.json, whole; null when npm has written none (never run here). */
async function readLockfile(prefix: string): Promise<Record<string, LockEntry> | null> {
  try {
    const lock = JSON.parse(await fs.readFile(path.join(prefix, "package-lock.json"), "utf8")) as {
      packages?: Record<string, LockEntry>;
    };
    return lock.packages ?? null;
  } catch {
    return null;
  }
}

/**
 * What npm actually installed for a spec, as its lockfile records it: the `integrity` of the
 * entry whose `resolved` names the given URL, plus the name and version the installed
 * package declares. An entry npm recorded under another shape (a `file:` tarball, a git
 * link) answers null, as does a prefix whose lockfile does not name the URL at all.
 */
async function installedRecord(
  prefix: string,
  url: string,
): Promise<{ integrity: string; name: string; version: string } | null> {
  const lock = await readLockfile(prefix);
  if (lock === null) return null;
  const found = Object.entries(lock).find(([, pkg]) => pkg.resolved === url);
  if (found === undefined || typeof found[1].integrity !== "string") return null;
  // The installed package's own manifest names what landed on disk; without it there is
  // nothing to check the entry against.
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(prefix, found[0], "package.json"), "utf8"),
    ) as { name?: unknown; version?: unknown };
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") return null;
    return { integrity: found[1].integrity, name: manifest.name, version: manifest.version };
  } catch {
    return null;
  }
}

/** Whether two integrity digests agree, compared the way a hash check compares. */
function sameDigest(actual: string, expected: string): boolean {
  return (
    actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

/**
 * Installs a version through an index entry's github channel: the release URL is a spec npm
 * natively understands (a gzipped tarball over https), so each address's attempt is npm
 * itself installing it — npm downloads, unpacks and records what it took. What npm actually
 * installed is verified after the fact: the prefix's package-lock.json records the integrity
 * of the tarball the install resolved to, and it has to agree with the entry's sha512 — a
 * mismatch throws the install away (npm uninstall) and the walk moves to the next address,
 * so an address serving tampered bytes is refused like any other source, and never becomes
 * the sticky start. The tarball's own package.json is checked the same way: the lockfile
 * entry must say it installed the entry's package and version — an archive that says it is
 * another package, or another version, is refused, so the caller's post-install vetting
 * cannot end up vetting, or uninstalling, the wrong one. `install` is injectable so a test
 * stands in for npm; `onProgress`, when given, is called once per address's install — npm's
 * own download is npm's to report, the caller sees the address boundaries.
 */
export async function installPluginChannel(
  root: string,
  channel: IndexChannel,
  {
    install: run = (prefix, spec) => runNpmInstallSpec(prefix, spec, timeoutMs),
    uninstall: remove = (prefix, name) => runNpmUninstall(prefix, name),
    onProgress = undefined,
    timeoutMs = CHANNEL_TIMEOUT_MS,
  }: {
    install?: (prefix: string, spec: string) => Promise<void>;
    /** What takes a refused install out of the prefix; npm's uninstall by default. */
    uninstall?: (prefix: string, name: string) => Promise<void>;
    onProgress?: (received: number, total: number | null) => void;
    /** One address's npm window; the walk moves on when it runs out. */
    timeoutMs?: number;
  } = {},
): Promise<InstalledPackage> {
  const prefix = await ensurePrefix(root);
  // The asset's addresses in try order: the sticky start first (the address that last
  // installed and verified for this channel URL), then the URL the index published and
  // this source's CDN mirrors in their configured order. Mirrors change only where the
  // bytes come from: what npm installs is verified against the entry's integrity exactly
  // as the canonical URL's would be, so a mirror serving tampered bytes is refused like
  // any other source — and never becomes the sticky start.
  const canonical = [channel.url, ...(channel.mirrors ?? [])];
  const remembered = lastGoodAsset.get(channel.url);
  const addresses =
    remembered !== undefined && canonical.includes(remembered) && remembered !== channel.url
      ? [remembered, ...canonical.filter((address) => address !== remembered)]
      : canonical;
  // One address at a time, in the order given: the first address whose npm install lands
  // and whose lockfile record verifies carries the install. An npm failure (a dead
  // address, a non-ok answer — npm collapses both into its exit) moves on to the next
  // address; so does an install whose post-check refuses it (a tampered tarball, another
  // package's manifest). Each address carries its own timeout, so a dead one costs one
  // window, not a hang. All of them failed: the error names the addresses that were tried
  // and the failure it ended on.
  let lastError: unknown = null;
  for (const address of addresses) {
    try {
      await run(prefix, address);
    } catch (err) {
      lastError = err;
      continue;
    }
    const installed = await installedRecord(prefix, address);
    if (installed === null) {
      lastError = new PluginInstallError(
        "npm recorded no install of the release asset; the address did not serve it",
      );
      continue;
    }
    const actual = digestOf(installed.integrity);
    const expected = pinnedDigest(channel.integrity);
    if (actual === null || expected === null || !sameDigest(actual, expected)) {
      lastError = new PluginInstallError(
        "the release asset does not match the sha512 the index entry pins; it is not installed",
      );
    } else if (
      installed.name === channel.name &&
      installed.version === channel.version &&
      (await readInstalledVersion(prefix, channel.name)) === channel.version
    ) {
      // The install carried, the bytes are the entry's own: from now on this address
      // is where the next install of this channel starts. An address whose install
      // fails the checks throws above (or falls through) and is never remembered.
      if (address !== channel.url) lastGoodAsset.set(channel.url, address);
      onProgress?.(0, null);
      return { name: channel.name, version: channel.version };
    } else {
      lastError = new PluginInstallError(
        `the release asset's package.json says ${JSON.stringify(installed.name)}@${JSON.stringify(installed.version)}, not the ${channel.name}@${channel.version} the index entry publishes; it is not installed`,
      );
    }
    // A refused install does not stay in the prefix: whatever npm put there for the
    // address goes, so a later address starts clean.
    await remove(prefix, channel.name);
  }
  const why = lastError instanceof Error ? lastError.message : String(lastError);
  throw new PluginInstallError(
    `could not install the release asset from any of ${addresses.join(", ")}: ${why}`,
  );
}

/** npm's own install of one spec, with the address's window on it. */
async function runNpmInstallSpec(prefix: string, spec: string, timeoutMs: number): Promise<void> {
  await npm(
    prefix,
    [
      ...(npmRegistry !== undefined ? [`--registry=${npmRegistry}`] : []),
      "install",
      "--no-audit",
      "--no-fund",
      "--omit=dev",
      "--",
      spec,
    ],
    prefix,
    timeoutMs,
  );
}

/** npm's uninstall of a refused install, best effort — a clean prefix for the next address. */
async function runNpmUninstall(prefix: string, name: string): Promise<void> {
  try {
    await npm(
      prefix,
      ["uninstall", "--no-audit", "--no-fund", "--", name],
      prefix,
      CHANNEL_TIMEOUT_MS,
    );
  } catch {
    // Nothing to remove, or npm could not — the walk reports its own failure either way.
  }
}

/** The digest half of an npm integrity string (`sha512-<base64>`); null for another shape. */
function digestOf(integrity: string): string | null {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  return match === null ? null : match[1]!;
}

/** The digest half of the entry's pinned integrity; null when the pin is not even readable. */
function pinnedDigest(integrity: string): string | null {
  return digestOf(integrity);
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
