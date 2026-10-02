/**
 * Installing a plugin package into the data root.
 *
 * A plugin has to EXIST on the machine before `plugins.json` naming it means anything, and
 * where it can exist is not free: the installation directory belongs to the installer (the
 * desktop app's is inside the application bundle, and read-only in the places that matter), so
 * the harness owns one of its own — `<root>/plugins/`, an ordinary npm prefix. `npm install`
 * writes library content there; server modules are copied into the store and load from an activated generation.
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
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Component } from "@prismshadow/penguin-core/kernel";
import type { PluginPackages } from "../mechanisms/plugins.js";

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

export class PluginInstallError extends Error {}

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
    const invocation = npmCommand(args);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, {
      cwd,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      shell: invocation.shell,
      env: npmEnv(process.env),
    });
    return stdout;
  } catch (err) {
    throw new PluginInstallError(npmReason((err as { stderr?: string }).stderr, err as Error));
  }
}

const install = (prefix: string, spec: string) =>
  npm(prefix, ["install", "--no-audit", "--no-fund", "--omit=dev", "--", spec]);

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
 * empty continuation lines npm pads the block with. Warnings printed before it (a deprecated
 * package, an engine mismatch) are not the reason; stderr without any `npm error` line — a
 * shell that could not start npm at all — answers its own first line.
 */
export function npmReason(stderr: string | undefined, err: Error): string {
  const raw = (stderr ?? "").split(/\r?\n/);
  const errors = raw.filter((l) => /^npm (error|ERR!)/.test(l));
  const lines = (errors.length > 0 ? errors : raw.filter((l) => !/^npm (warn|WARN)/.test(l)))
    .map((l) => l.replace(/^npm (error|ERR!)\s*/, "").trim())
    .filter((l) => l !== "" && !/^A complete log/.test(l) && !/^code [A-Z0-9]+$/.test(l));
  const reason = lines.find((l) => l.length > 8);
  return reason ?? err.message;
}

/** How to start npm: the file, its arguments, and whether through a shell. */
export interface NpmCommand {
  command: string;
  args: string[];
  shell: boolean;
}

/**
 * cmd.exe does not unquote spawn arguments: under `shell: true` they are joined into one
 * command line. Inside double quotes cmd takes `& | < > ^` and spaces literally — a version
 * range like `>=1 <2` included — so every argument is quoted; what quotes cannot contain (a
 * quote, `%` expansion, a line break) is refused rather than passed to a shell.
 */
function cmdQuote(arg: string): string {
  if (/["%\r\n]/.test(arg)) {
    throw new PluginInstallError(`'${arg}' cannot be passed to npm.cmd through cmd.exe`);
  }
  return `"${arg}"`;
}

/**
 * The npm on PATH, the way every other npm consumer on the machine runs it. On Windows that is
 * `npm.cmd`, which Node starts only through a shell (EINVAL without one), so there it runs
 * through cmd.exe with every argument quoted.
 */
export function npmCommand(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): NpmCommand {
  return platform === "win32"
    ? { command: "npm.cmd", args: args.map(cmdQuote), shell: true }
    : { command: "npm", args: [...args], shell: false };
}

/**
 * The installer as a node, so a test stands in for npm instead of running it: the routes reach
 * the prefix only through this.
 */
@Component()
export class NpmPluginPackages implements PluginPackages {
  /** By name or by link (see installPluginSource). */
  async install(root: string, source: string, expected?: string): Promise<InstalledPackage> {
    if (expected !== undefined) {
      // Verify before touching the visible library prefix. Install those exact stored bytes,
      // not a second registry fetch, which could resolve to different content.
      const { fetchIntoStore, PACKAGE_DIR } = await import("./store.js");
      const entry = await fetchIntoStore(root, source, { expected });
      const prefix = await ensurePrefix(root);
      const archives = path.join(prefix, ARCHIVES_DIR);
      await fs.mkdir(archives, { recursive: true });
      const dir = path.join(entry.dir, PACKAGE_DIR);
      // Pack the verified local bytes; never perform a second registry lookup for the package.
      const packed = await npm(
        prefix,
        ["pack", "--ignore-scripts", "--json", "--pack-destination", archives],
        dir,
      );
      await install(prefix, `./${ARCHIVES_DIR}/${packedFileName(packed)}`);
      await pruneArchives(prefix);
      return { name: entry.name, version: entry.version };
    }
    const installed = await installPluginSource(root, source);
    await storeInstalledPlugin(root, installed.name);
    return installed;
  }

  /** An uploaded package's files (see installPluginFiles). */
  async installFiles(root: string, files: Record<string, Uint8Array>): Promise<InstalledPackage> {
    const installed = await installPluginFiles(root, new Map(Object.entries(files)));
    await storeInstalledPlugin(root, installed.name);
    return installed;
  }

  remove(root: string, name: string): Promise<void> {
    return removePluginPackage(root, name);
  }
}

/**
 * The environment of the fetch's npm, and of nothing else: `env` with the directory of the Node
 * runtime running this server appended to PATH. A CLI bundle carries its own runtime, npm
 * beside node, so a machine without npm still fetches; appended rather than prepended, a user's
 * own npm keeps coming first. Only this child sees it: the server's PATH, and every agent
 * command inheriting it, stay as they were. Windows spells the variable `Path`, so the key
 * already present is the one extended.
 */
export function npmEnv(
  env: NodeJS.ProcessEnv,
  runtimeDir: string = path.dirname(process.execPath),
  delimiter: string = path.delimiter,
): NodeJS.ProcessEnv {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const dirs = (env[key] ?? "").split(delimiter).filter((d) => d !== "");
  if (dirs.includes(runtimeDir)) return { ...env };
  return { ...env, [key]: [...dirs, runtimeDir].join(delimiter) };
}

/** Library content stays in its prefix; server modules load only from an activated store entry. */
export async function storeInstalledPlugin(root: string, name: string): Promise<void> {
  const { storePackage } = await import("./store.js");
  const { INTEGRITY, tarballIntegrity } = await import("../../../../scripts/plugin-entry.mjs");
  const prefix = pluginsPrefix(root);
  const dir = installedPackageDir(prefix, name);
  const lock = JSON.parse(
    await fs.readFile(path.join(prefix, "package-lock.json"), "utf8").catch(() => "{}"),
  ) as {
    packages?: Record<string, { integrity?: string }>;
  };
  const recorded = lock.packages?.[`node_modules/${name}`]?.integrity;
  let integrity = recorded?.split(/\s+/).find((value) => INTEGRITY.test(value));
  if (integrity === undefined) {
    // Git links need not have npm lockfile integrity. Name their locally packed tarball,
    // rather than pretending that the registry vouched for this non-registry source.
    const archives = path.join(prefix, ARCHIVES_DIR);
    await fs.mkdir(archives, { recursive: true });
    const packed = await npm(
      prefix,
      ["pack", "--ignore-scripts", "--json", "--pack-destination", archives],
      dir,
    );
    integrity = await tarballIntegrity(path.join(archives, packedFileName(packed)));
  }
  await storePackage(root, dir, prefix, integrity);
  await pruneArchives(prefix);
}

/** Adopt server modules installed before generations existed; leave their library prefix intact. */
export async function adoptInstalledPlugins(
  root: string,
  log: (message: string) => void,
): Promise<void> {
  const { PACKAGE_NAME } = await import("./loader.js");
  const prefix = pluginsPrefix(root);
  for (const name of Object.keys(await prefixDependencies(prefix))) {
    if (!PACKAGE_NAME.test(name)) continue;
    const dir = installedPackageDir(prefix, name);
    if (
      !(await fs.access(path.join(dir, "ifaces.json")).then(
        () => true,
        () => false,
      ))
    )
      continue;
    try {
      // Reuse the exact recorded SRI, or locally pack sources without one. A matching
      // name and version alone cannot establish that an entry has the same content.
      // storePackage itself skips entries whose exact integrity is already stored.
      await storeInstalledPlugin(root, name);
    } catch (err) {
      log(`[plugin-store] adopting ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
