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
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path, { relative } from "node:path";
import { promisify } from "node:util";
import { Component } from "@prismshadow/penguin-core/kernel";
// `which` is CommonJS exporting the function itself (module.exports = which, plus
// which.sync): the default import IS the function, and the sync form is what the
// candidates check uses — a path answer or null, never a thrown ENOENT.
import which from "which";
import type { PluginPackages } from "../mechanisms/plugins.js";
import type { IndexChannel } from "./registry.js";
const execFileAsync = promisify(execFile);

/** Long enough for a cold registry fetch with dependencies; short enough not to hang a request. */
const INSTALL_TIMEOUT_MS = 180_000;
/** One address's npm window: a dead address costs this, not a hang. */
const CHANNEL_TIMEOUT_MS = 15_000;
/** npm's own per-request window and retries (see `install`). */
const FETCH_TIMEOUT_MS = 60_000;
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

/** A bare package name, scoped or not — the same rule loader.ts resolves by. */
const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export class PluginInstallError extends Error {
  /**
   * Why npm failed, when the failure came from npm: "unavailable" — npm answered that the
   * package (or the requested version of it) does not exist on the registry, the one outcome
   * a published-index channel may stand in for; "unreachable" — the registry (or a proxy on
   * the way) did not answer: refused, unresolved, reset or timed out, including npm killed at
   * its window; "missing" — there is no npm on this machine at all; "other" — everything else
   * (a refusing registry, a dependency that will not resolve, a failed lifecycle script), where
   * no fallback is the answer and the failure is reported as is. Undefined on errors that did
   * not come from npm at all.
   */
  reason?: "unavailable" | "unreachable" | "missing" | "other";
  /** The registry address npm named in its failure, when it named one. */
  registry?: string;
  /** npm's own words, when this failure goes on to say what the fallbacks after npm said. */
  npmSaid?: string;
  /** What a fallback after npm said (an offline archive, an index channel), worth the reader's eye. */
  fallback?: string;
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

/** The registry the installer's npm runs are pointed at, or null when npm's own configuration answers. */
export function currentNpmRegistry(): string | null {
  return npmRegistry ?? process.env.npm_config_registry ?? null;
}

/**
 * How to run npm, resolved once per process: an ordered list of spawnable commands, built by
 * asking the file system what is really here rather than assuming where npm lives. The shape
 * mirrors cross-spawn's (the resolver every npm-spawning tool sits on): locate first, spawn
 * second, and never guess an extension or a layout.
 *
 * 1. The npm SHIPPED beside this interpreter. Node's official distribution carries npm in a
 *    fixed layout (`<execPath dir>/../lib/node_modules/npm` on POSIX, `<execPath dir>/node_modules/npm`
 *    on Windows — node.exe sits at the archive root), and the layout survives every
 *    distribution that unpacks the dist unchanged: the platform packages and Docker images,
 *    and the version managers, whose PATH shims are links into exactly this tree. Probed,
 *    not assumed. Running the CLI through node itself avoids every batch-file question.
 * 2. Whatever `npm` this machine puts on PATH — the way every other npm consumer here
 *    resolves it. Debian splits npm out of its node package, so the layout above can be
 *    absent on a machine that has npm; the PATH form covers it. Located with `which`, the
 *    resolver cross-spawn itself sits on: it walks PATH under PATHEXT on Windows (npm.cmd
 *    on node-installed machines, npm.exe under scoop) and checks executability on POSIX —
 *    the quirks a hand-rolled scan forgets, settled once in a package every resolver here
 *    already trusts. The command itself stays the plain `npm` name, which the system then
 *    resolves the same way it would for any other consumer.
 *
 * A candidate is offered only when its file is proven present, so a failed install never
 * reads as "npm is missing" when npm ran and failed: a broken npm surfaces through the
 * install's own error, in npm's own words. Nothing here runs a probe install — existence is
 * checkable without starting a process, and `npm --version` would prove nothing the check
 * does not.
 */

interface NpmCommand {
  /** What this candidate is, in the error shown when nothing is found. */
  label: string;
  /** The spawn executable and the args every install command is appended to. */
  file: string;
  argv: readonly string[];
}

const npmCandidates = (): { candidates: readonly NpmCommand[]; notes: readonly string[] } => {
  // The layout the official dist unpacks to, relative to the running interpreter.
  const bundled = path.join(
    path.dirname(process.execPath),
    ...(process.platform === "win32"
      ? (["node_modules", "npm", "bin", "npm-cli.js"] as const)
      : (["..", "lib", "node_modules", "npm", "bin", "npm-cli.js"] as const)),
  );
  const candidates: NpmCommand[] = [];
  const notes: string[] = [];
  if (existsSync(bundled)) {
    // node itself runs the CLI: no batch file, no shell, every platform.
    candidates.push({
      label: `the npm beside this node (${bundled})`,
      file: process.execPath,
      argv: [bundled],
    });
  } else {
    notes.push(`no npm beside this node (${bundled})`);
  }
  const onPath = which.sync("npm", { nothrow: true });
  if (onPath !== null) {
    // On Windows the PATH entry is a batch file, which node refuses to spawn directly
    // (`spawn EINVAL`), so cmd.exe runs it — a real executable; `/d` skips AutoRun scripts,
    // `/s /c` runs the rest as given, each argument quoted by Node (the same line
    // cross-spawn builds for cmd shims). The bare `npm` name, so cmd.exe resolves it as it
    // would for any consumer, whatever shim form the machine carries.
    candidates.push(
      process.platform === "win32"
        ? { label: `npm on PATH (${onPath})`, file: "cmd.exe", argv: ["/d", "/s", "/c", "npm"] }
        : { label: `npm on PATH (${onPath})`, file: "npm", argv: [] },
    );
  } else {
    notes.push("no npm on PATH");
  }
  return { candidates, notes };
};

let npmCommandCache: Promise<NpmCommand> | null = null;
function npmCommand(): Promise<NpmCommand> {
  // Resolved once: the chosen npm does not move under a running process.
  npmCommandCache ??= (async () => {
    const { candidates, notes } = npmCandidates();
    const [candidate] = candidates;
    if (candidate !== undefined) return candidate;
    const missing = new PluginInstallError(
      `npm, the installer of plugins, is not on this machine (${notes.join("; ")})`,
    );
    missing.reason = "missing";
    throw missing;
  })();
  return npmCommandCache;
}

async function npm(
  prefix: string,
  args: readonly string[],
  cwd = prefix,
  window = INSTALL_TIMEOUT_MS,
): Promise<string> {
  const command = await npmCommand();
  try {
    const { stdout } = await execFileAsync(command.file, [...command.argv, ...args], {
      cwd,
      timeout: window,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    return stdout;
  } catch (err) {
    const error = err as Error & { code?: string; stderr?: string; killed?: boolean };
    const killed = error.killed === true;
    const failure = new PluginInstallError(
      killed
        ? `npm did not finish within ${Math.round(window / 1000)} s`
        : npmReason(error.stderr, error),
    );
    failure.reason = killed ? "unreachable" : npmFailureKind(error.stderr);
    const registry = npmRegistryNamed(error.stderr);
    if (registry !== undefined) failure.registry = registry;
    throw failure;
  }
}

/** The registry origin npm named in its failure (`GET https://host/...`), if it named one. */
export function npmRegistryNamed(stderr: string | undefined): string | undefined {
  const url = /\b(?:GET|PUT|POST)\s+(https?:\/\/[^\s/]+)/.exec(stderr ?? "")?.[1];
  return url;
}

/**
 * Which bucket a failed npm run falls in, from its stderr's `code E<NAME>` lines: E404 (the
 * package or the requested version is not on the registry) and ETARGET (no version matches
 * the requested range) are the outcomes a published-index channel may stand in for —
 * "unavailable". Everything else — a refusing registry, a dependency that will not resolve,
 * a failed lifecycle script — is "other", and stays a failure. This reads the raw stderr, so
 * it runs before npmReason strips the `code E404` line the answer lives on.
 */
export function npmFailureKind(
  stderr: string | undefined,
): "unavailable" | "unreachable" | "other" {
  const text = stderr ?? "";
  if (/npm (?:error|ERR!) code (E404|ETARGET)\b/m.test(text)) return "unavailable";
  // What a registry that cannot be reached looks like to npm: the connection refused, reset or
  // timed out, the name unresolved, or the fetch timed out (`--fetch-timeout`).
  if (
    /npm (?:error|ERR!) (?:code|errno) (ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ERR_SOCKET_TIMEOUT|EPROXY)\b/m.test(
      text,
    ) ||
    /network (?:request|timeout) .*(?:failed|timed out)|ERR_SOCKET_TIMEOUT/m.test(text)
  ) {
    return "unreachable";
  }
  return "other";
}

// `--install-links=false` on EVERY install: it is what makes npm reify a `file:` directory
// dependency as a symlink to the author's directory instead of a copy (npm 7+ defaults the
// other way). Every install carries the flag — a plain install that dropped it would silently
// replace an existing link with a frozen copy — and no config file is relied on: the same
// command behaves the same whatever npm version ships with the runtime.
// `--fetch-timeout` and `--fetch-retries` bound how long one registry that does not answer can
// hold an install: npm's own defaults (five minutes, two retries) outlast the install's window,
// so a dead registry would read as npm killed rather than as the registry not answering.
const install = (prefix: string, spec: string) =>
  npm(prefix, [
    ...(npmRegistry !== undefined ? [`--registry=${npmRegistry}`] : []),
    "install",
    "--no-audit",
    "--no-fund",
    "--omit=dev",
    "--install-links=false",
    `--fetch-timeout=${FETCH_TIMEOUT_MS}`,
    "--fetch-retries=1",
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

/**
 * Installs a package tarball already on this machine — an offline archive the build carried
 * (plugin/offline-archives.ts), verified by the caller — the way an uploaded zip's tarball is
 * installed: copied into `<prefix>/archives/` and installed from there, so npm records it as a
 * `file:archives/<tarball>` dependency it can reconcile on every later install.
 */
export async function installPluginTarball(
  root: string,
  file: string,
  name: string,
): Promise<InstalledPackage> {
  const prefix = await ensurePrefix(root);
  const archives = path.join(prefix, ARCHIVES_DIR);
  await fs.mkdir(archives, { recursive: true });
  const base = path.basename(file);
  await fs.copyFile(file, path.join(archives, base));
  await install(prefix, `./${ARCHIVES_DIR}/${base}`);
  await pruneArchives(prefix);
  return { name, version: await readInstalledVersion(prefix, name) };
}

/** Packs a package directory into `into` as `npm publish` would (`npm pack --ignore-scripts`); answers the tarball's path. */
export async function packPackageDirectory(dir: string, into: string): Promise<string> {
  const packed = await npm(
    into,
    ["pack", "--ignore-scripts", "--json", "--pack-destination", into],
    dir,
    60_000,
  );
  return path.join(into, packedFileName(packed));
}

/**
 * The tarball `npm pack --json` wrote, from its report on stdout: `[{ filename }]` through
 * npm 11, `{ "<name>": { filename } }` from npm 12 on. Exported for tests: the shape follows
 * whichever npm the machine has.
 */
export function packedFileName(stdout: string): string {
  let parsed: unknown;
  try {
    // npm prints its JSON after any notices a lifecycle could not suppress; the report opens a
    // line of its own and runs to the end.
    parsed = JSON.parse(stdout.slice(stdout.search(/^[[{]/m)));
  } catch {
    throw new PluginInstallError("npm pack did not report the tarball it wrote");
  }
  // One package was packed: the array's one entry, or the object's one value.
  const reports: unknown[] = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed)
      : [];
  const file = reports[0] as { filename?: unknown } | undefined;
  if (typeof file?.filename !== "string" || path.basename(file.filename) !== file.filename) {
    throw new PluginInstallError("npm pack did not report the tarball it wrote");
  }
  return file.filename;
}

/**
 * Links a local package directory into the prefix the way npm itself does it: `npm install
 * file:<dir>` records the directory as a `file:` dependency in the prefix's package.json and
 * reifies it as a symlink to the author's directory (every install runs with
 * `--install-links=false` — see `install`). Nothing here is penguin's own record — the
 * manifest entry IS the link table (the route reads it back as one), npm keeps the symlink
 * and the entry in step through its own re-entry, and `npm uninstall <name>` takes a link out
 * the same way it takes any package out. The link is npm's, so are its semantics.
 *
 * The directory is vetted before npm is asked: its package.json must be readable and carry a
 * name npm accepts (the same rule the loader resolves by). An existing dependency under the
 * same name that is not itself this kind of link refuses unless `overwrite` — replacing an
 * installed package with a link is the operator's to confirm, the way a replacing install is.
 */
export async function linkPluginDirectory(
  root: string,
  dir: string,
  overwrite = false,
): Promise<InstalledPackage> {
  const prefix = await ensurePrefix(root);
  const real = await fs.realpath(dir);
  const name = await (async () => {
    try {
      return await readPackageName(path.join(real, "package.json"));
    } catch (err) {
      throw new PluginInstallError(
        `${dir} is not a plugin package (its package.json could not be read: ${err instanceof Error ? err.message : String(err)})`,
      );
    }
  })();
  if (!PACKAGE_NAME.test(name)) {
    throw new PluginInstallError(`'${name}' is not a package name npm would accept`);
  }
  const existing = (await prefixDependencies(prefix))[name];
  if (existing !== undefined && !existing.startsWith("link:") && !overwrite) {
    throw new PluginInstallError(
      `${name} is installed in the prefix at ${existing}; pass --overwrite to replace it with a link.`,
    );
  }
  // Named relative to the prefix's REAL path — npm resolves a `file:` spec against the real
  // prefix, and the two diverge wherever a symlink sits on the way to the data root (macOS's
  // temp directory is /var/folders over a /private/var/folders real body; npm failing to open
  // the directory there is "syscall open", with the reason line never naming the path). npm
  // then records the entry relative to that same real path (see installPluginFiles, whose
  // tarball install is recorded the same way).
  const realPrefix = await fs.realpath(prefix).catch(() => prefix);
  await install(prefix, `file:${relative(realPrefix, real)}`);
  return { name, version: await readInstalledVersion(prefix, name) };
}

/**
 * The prefix's link table, as npm itself keeps it: every `file:` dependency whose spec names
 * a DIRECTORY (a `file:` naming a tarball under archives/ is an uploaded zip's install, not a
 * link) and whose node_modules entry exists — lstat it, not the directory it names: a dangling
 * link (the author's directory deleted) stays in the table and the page reports its fault. A
 * symlink lstats as a symlink (isDirectory is false on it), so both count. Specs are resolved
 * against the prefix's real path, the one npm records them relative to (see
 * linkPluginDirectory): on macOS the logical path and the real one diverge through the temp
 * directory's symlink, and only the real path walks back to the author's directory.
 */
export async function linkedPackages(prefix: string): Promise<Map<string, string>> {
  const table = new Map<string, string>();
  const realPrefix = await fs.realpath(prefix).catch(() => prefix);
  for (const [name, spec] of Object.entries(await prefixDependencies(prefix))) {
    if (!spec.startsWith("file:")) continue;
    const dir = path.resolve(realPrefix, spec.slice("file:".length));
    if (/\.tgz$|\.tar\.gz$/.test(dir)) continue;
    const st = await fs.lstat(installedPackageDir(prefix, name)).catch(() => null);
    if (st?.isDirectory() || st?.isSymbolicLink()) table.set(name, dir);
  }
  return table;
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

  /** A verified package tarball on this machine (see installPluginTarball). */
  installTarball(root: string, file: string, name: string): Promise<InstalledPackage> {
    return installPluginTarball(root, file, name);
  }

  remove(root: string, name: string): Promise<void> {
    return removePluginPackage(root, name);
  }
}
