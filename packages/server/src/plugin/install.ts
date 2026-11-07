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
 * is fetched, verified against the sha512 the entry pins, and its verified bytes install as
 * the same `file:` record (installPluginChannel) — npm stays the first source; the channel is
 * where an npm-missing name can still come from.
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
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
    // `/s /c` runs the rest as given, with each argument quoted by Node on the way in.
    const [file, argv] =
      process.platform === "win32"
        ? (["cmd.exe", ["/d", "/s", "/c", npmCommand(), ...args]] as const)
        : ([npmCommand(), [...args]] as const);
    const { stdout } = await execFileAsync(file, argv, {
      cwd,
      timeout: INSTALL_TIMEOUT_MS,
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
 * Checks the bytes a channel served against the hash the index entry pins: npm's
 * `integrity` shape, `sha512-<base64>`. A mismatch, or an integrity that is not even
 * readable, refuses the install — the verified bytes are the only ones that install. Returns
 * the base64 digest, which names the archive file the verified bytes are written under.
 */
export function verifyIntegrity(bytes: Uint8Array, integrity: string): string {
  const pinned = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  if (pinned === null) {
    throw new PluginInstallError(
      `the index entry's integrity is not sha512-<base64>: ${JSON.stringify(integrity)}`,
    );
  }
  const actual = createHash("sha512").update(bytes).digest("base64");
  const expected = pinned[1]!;
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  ) {
    throw new PluginInstallError(
      "the release asset does not match the sha512 the index entry pins; it is not installed",
    );
  }
  return actual;
}

/** The size step a no-length answer reports by: every mebibyte read, rather than every chunk. */
const PROGRESS_MIB = 1024 * 1024;

/**
 * The response's body, whole. With `onProgress` the body is read chunk by chunk and the
 * reader is told as it goes — the bytes received and the total when the answer names one —
 * but only in steps: one call per percent of a known size, one per mebibyte without it. A
 * call per chunk would be thousands for one asset, none the caller could show. Without an
 * `onProgress` nothing streams, and the body arrives as it always did.
 */
async function readAsset(
  res: Awaited<ReturnType<typeof fetch>>,
  onProgress: ((received: number, total: number | null) => void) | undefined,
): Promise<Uint8Array> {
  const totalHeader = Number(res.headers.get("content-length"));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  if (res.body === null || onProgress === undefined) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    onProgress?.(bytes.byteLength, total ?? bytes.byteLength);
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastStep = -1;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    // The step counter doubles as the mebibyte counter when no total is known; either way a
    // step is a call, and a chunk is not.
    const step =
      total === null
        ? Math.floor(received / PROGRESS_MIB)
        : Math.min(100, Math.floor((received / total) * 100));
    if (step > lastStep) {
      lastStep = step;
      onProgress(received, total);
    }
  }
  onProgress(received, total ?? received);
  const bytes = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * Installs a version through an index entry's github channel: the release asset is
 * fetched, verified against the entry's sha512, and only the verified bytes are written —
 * into the prefix's archives, where `npm install` takes them as a `file:` dependency, the
 * same record an uploaded zip installs under. The hash pins the bytes, not what they are:
 * before anything is published under its final name, the tarball's own package.json is read
 * (`tar -xzOf`) and has to agree with the entry's name and version — an archive that says it
 * is another package, or another version, is refused, so the manifest never names a package
 * that was not what the index published, and the caller's post-install vetting cannot end up
 * vetting, or uninstalling, the wrong one. The verified bytes are written to a temporary file
 * first and renamed into place, so a concurrent install never sees a half-written archive.
 * `fetchImpl` and `install` are injectable so a test stands in for the network and npm;
 * `onProgress`, when given, is called as the asset is read — the bytes received so far and
 * the total when the answer carries a content-length — in steps a progress bar can show.
 */
export async function installPluginChannel(
  root: string,
  channel: IndexChannel,
  {
    fetchImpl = fetch,
    install: run = (prefix, spec) => install(prefix, spec).then(() => undefined),
    onProgress = undefined,
  }: {
    fetchImpl?: typeof fetch;
    install?: (prefix: string, spec: string) => Promise<void>;
    onProgress?: (received: number, total: number | null) => void;
  } = {},
): Promise<InstalledPackage> {
  const prefix = await ensurePrefix(root);
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl(channel.url, { redirect: "follow" });
  } catch (err) {
    throw new PluginInstallError(
      `could not fetch the release asset ${channel.url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new PluginInstallError(`the release asset answered ${res.status}: ${channel.url}`);
  }
  const bytes = new Uint8Array(await readAsset(res, onProgress));
  const digest = verifyIntegrity(bytes, channel.integrity);
  const archives = path.join(prefix, ARCHIVES_DIR);
  await fs.mkdir(archives, { recursive: true });
  const staging = path.join(archives, `.tmp-${randomUUID()}.tgz`);
  await fs.writeFile(staging, bytes);
  // The tarball's own manifest, read straight out of the archive; anything unreadable, or
  // disagreeing with the index entry, refuses the install and leaves nothing behind.
  let manifest: { name?: unknown; version?: unknown };
  try {
    manifest = JSON.parse(
      // Relative to the staging dir: a Windows path carries a drive letter, which GNU tar
      // reads as a remote host name.
      (
        await execFileAsync("tar", ["-xzOf", path.basename(staging), "package/package.json"], {
          cwd: path.dirname(staging),
        })
      ).stdout,
    ) as { name?: unknown; version?: unknown };
  } catch (err) {
    await fs.rm(staging, { force: true });
    throw new PluginInstallError(
      `the release asset does not carry a readable package/package.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (manifest.name !== channel.name || manifest.version !== channel.version) {
    await fs.rm(staging, { force: true });
    throw new PluginInstallError(
      `the release asset's package.json says ${JSON.stringify(manifest.name)}@${JSON.stringify(manifest.version)}, not the ${channel.name}@${channel.version} the index entry publishes; it is not installed`,
    );
  }
  // A file name under the prefix's archives: a package name's safe characters with the scope
  // slash joined, a version's, and the first sixteen characters of the verified digest — so
  // two entries that sanitize to the same name cannot overwrite one another, and a re-served
  // tarball for the same version lands under its own name rather than replacing bytes npm may
  // still be reading.
  const base = `${channel.name
    .split("/")
    .filter((part) => /^[@A-Za-z0-9._~-]+$/.test(part))
    .join("-")}-${channel.version.replace(/[^A-Za-z0-9._-]/g, "")}`;
  if (base === "-" || base.length < 3) {
    await fs.rm(staging, { force: true });
    throw new PluginInstallError(
      `the index entry's name and version do not make a file name: ${channel.name}@${channel.version}`,
    );
  }
  // The digest tags the archive file. Base64 carries `/` and `+`, neither of which belongs in
  // a file name (a `/` would make the rename a write into a directory that does not exist), so
  // the tag is the digest's first sixteen file-safe characters — still collision-proof, since
  // a sha512's base64 is 44 characters of which almost all are safe.
  const tag = (digest.match(/[A-Za-z0-9._~-]/g) ?? []).slice(0, 16).join("");
  const file = `${base}-${tag}.tgz`;
  await fs.rename(staging, path.join(archives, file));
  try {
    await run(prefix, `./${ARCHIVES_DIR}/${file}`);
  } finally {
    await pruneArchives(prefix);
  }
  return { name: channel.name, version: await readInstalledVersion(prefix, channel.name) };
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
