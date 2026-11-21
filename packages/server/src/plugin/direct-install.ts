/**
 * Installing a plugin package on a machine with no npm (the desktop app's server runs under
 * Electron's utilityProcess, with no npm beside it), for a package that needs nothing npm does:
 * no dependencies and no install scripts (npm-requirement.ts). packages.ts sends an install
 * here only when npm is not found; with npm, npm does everything (install.ts).
 *
 * Four ways in, one way onto disk (prefix-place.ts):
 *
 * - **A name from the registry.** The registry the Plugin sources setting names (the official
 *   one when it names none — npm's own `.npmrc` is npm's, not read here) answers the package's
 *   abbreviated document, each address followed by the mirrors the Plugin mirrors setting
 *   rewrites it into. The version is picked by npm's rules (version-pick.ts); a name or a
 *   version the registry does not have is "unavailable", as npm's E404 / ETARGET is, so the
 *   published index's channel still answers it. The version's `dist.tarball` (https, or http
 *   on the loopback) is downloaded under a cap and checked against `dist.integrity`'s sha512
 *   **before** a byte of it is unpacked; a tarball that does not match moves to the next
 *   address, and a version that pins no sha512 is refused.
 * - **A release channel** of the published index: its asset, checked against the entry's
 *   sha512 the same way, over the channel's addresses in order, then kept in `archives/` and
 *   recorded as `file:archives/<asset>` so a later npm run never has to fetch it again.
 * - **An uploaded zip** (or a package directory the CLI zipped): exactly the files `npm pack`
 *   would publish from it (packlist.ts: `files`, `.npmignore` / `.gitignore`, npm's defaults,
 *   `bin` and `main`), packed by this server into the `archives/` tarball npm pack would have
 *   written, so the prefix records the install as npm does.
 * - Every `bin` target is left executable, as npm's bin-links leaves it.
 * - **Removal**: the directory and its package.json entry.
 *
 * Whatever was downloaded is read by tarball.ts (regular files only, no path leaving the
 * package), and the package's own package.json has to be the name and version asked for and
 * pass the same npm rule before anything is placed. A link (a git repository, an https
 * tarball) is npm's to fetch and still needs it.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import {
  ARCHIVES_DIR,
  configuredNpmRegistry,
  digestOf,
  packageName,
  pluginsPrefix,
  sameDigest,
  type InstalledPackage,
} from "./install.js";
import { indexMirrorRules } from "./mirror-settings.js";
import { npmNeededBecause, platformRefusal, type PackageManifest } from "./npm-requirement.js";
import { normalizedBins, packedFiles } from "./packlist.js";
import { placePackage, refusal, removePackage } from "./prefix-place.js";
import { pluginProxyMirrors, type IndexChannel, type PluginProxyRule } from "./registry.js";
import {
  AddressError,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TIMEOUT_MS,
  fetchableAddress,
  fetchFirst,
  TARBALL_MAX_BYTES,
  TARBALL_TIMEOUT_MS,
  WalkError,
} from "./registry-fetch.js";
import { parsePluginSource } from "./source.js";
import { collidingPaths, readPackageTarball, TarballError, type TarballFile } from "./tarball.js";
import { pickRegistryVersion, savedRange, type RegistryDocument } from "./version-pick.js";

/** The registry a deployment that names none installs from — npm's own default. */
export const OFFICIAL_REGISTRY = "https://registry.npmjs.org";

/** What npm asks a registry for: the abbreviated document, the full one where that is all there is. */
const DOCUMENT_TYPES = "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";

/** The date npm pack stamps on every entry, so the same files pack to the same bytes. */
const PACK_MTIME = new Date("1985-10-26T08:15:00.000Z");

/** How an install made without npm reaches the network, and what it says when npm is needed. */
export interface WithoutNpm {
  /** The fetch documents, tarballs and release assets come through. */
  fetch: typeof fetch;
  /** Where npm was looked for and not found: named when a package turns out to need it. */
  npmNotes: readonly string[];
  /** The registry to read; the Plugin sources setting's, else the official one. */
  registry?: string;
  /** The mirror rewrite rules; the Plugin mirrors setting's. */
  mirrors?: readonly PluginProxyRule[];
  /** A download's progress: bytes so far, and the total when the answer declared one. */
  onProgress?: (received: number, total: number | null) => void;
  /** The caps and windows, for a caller that needs them smaller. */
  limits?: Partial<{
    documentMaxBytes: number;
    tarballMaxBytes: number;
    unpackedMaxBytes: number;
    timeoutMs: number;
  }>;
}

/** The sentence that refuses a package npm would have to install. */
function needsNpm(what: string, reasons: readonly string[], io: WithoutNpm): Error {
  return refusal(
    `${what} needs npm to install: ${reasons.join("; ")}. This machine has no npm (${io.npmNotes.join("; ")}). Install Node.js, which includes npm (https://nodejs.org), then restart PenguinHarness so it finds npm.`,
  );
}

/** Refuses a package this machine cannot install without npm, or at all; passes one it can. */
function admit(label: string, manifest: PackageManifest, bindingGyp: boolean, io: WithoutNpm) {
  const platform = platformRefusal(manifest);
  if (platform !== null) throw refusal(`${label} does not install on this machine: ${platform}.`);
  const reasons = npmNeededBecause(manifest, { bindingGyp });
  if (reasons.length > 0) throw needsNpm(label, reasons, io);
}

/** The regular files of a downloaded tarball, or the refusal saying why there are none. */
function unpack(label: string, bytes: Uint8Array, io: WithoutNpm): Map<string, TarballFile> {
  try {
    return readPackageTarball(bytes, { maxUnpackedBytes: io.limits?.unpackedMaxBytes });
  } catch (err) {
    if (err instanceof TarballError) throw refusal(`${label}: ${err.message}`);
    throw err;
  }
}

/** The unpacked package has to be the one asked for, and installable without npm. */
function vetUnpacked(
  label: string,
  files: ReadonlyMap<string, TarballFile>,
  name: string,
  version: string,
  io: WithoutNpm,
): void {
  const raw = files.get("package.json");
  let manifest: PackageManifest | null = null;
  try {
    manifest =
      raw === undefined
        ? null
        : (JSON.parse(Buffer.from(raw.data).toString("utf8")) as PackageManifest);
  } catch {
    manifest = null;
  }
  if (manifest === null || typeof manifest !== "object") {
    throw refusal(`${label}: the tarball carries no readable package.json; it is not installed`);
  }
  if (manifest.name !== name || manifest.version !== version) {
    throw refusal(
      `${label}: the tarball's package.json says ${JSON.stringify(manifest.name)}@${JSON.stringify(manifest.version)}, not the ${label} that was asked for; it is not installed`,
    );
  }
  admit(label, manifest, files.has("binding.gyp"), io);
}

/**
 * The files with every `bin` target executable, as npm's bin-links leaves them once it has
 * installed a package (the targets as npm normalizes the manifest).
 */
function withExecutableBins(
  files: ReadonlyMap<string, TarballFile>,
  manifest: PackageManifest,
): Map<string, TarballFile> {
  const out = new Map(files);
  for (const target of Object.values(normalizedBins(manifest, { files: files.keys() }))) {
    const file = out.get(target);
    if (file !== undefined) out.set(target, { ...file, executable: true });
  }
  return out;
}

/** A package's manifest from its unpacked files; `{}` when there is none to read (vetUnpacked has refused that). */
function manifestOf(files: ReadonlyMap<string, TarballFile>): PackageManifest {
  try {
    const raw = files.get("package.json");
    return raw === undefined
      ? {}
      : (JSON.parse(Buffer.from(raw.data).toString("utf8")) as PackageManifest);
  } catch {
    return {};
  }
}

/** A download's checker: the bytes pass only when their sha512 is the pinned one. */
function pinnedTo(digest: string, what: string) {
  return (bytes: Uint8Array): Uint8Array => {
    const actual = createHash("sha512").update(bytes).digest("base64");
    if (!sameDigest(actual, digest)) {
      throw new AddressError(`served bytes that do not match the sha512 ${what} pins`);
    }
    return bytes;
  };
}

/** A registry document, or the AddressError that moves the walk to the next address. */
function parseDocument(name: string) {
  return (bytes: Uint8Array): RegistryDocument => {
    let doc: unknown;
    try {
      doc = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      throw new AddressError("did not answer a registry document");
    }
    const versions = (doc as { versions?: unknown } | null)?.versions;
    if (typeof versions !== "object" || versions === null) {
      throw new AddressError("did not answer a registry document");
    }
    const named = (doc as { name?: unknown }).name;
    if (named !== undefined && named !== name) {
      throw new AddressError(`answered the document of ${JSON.stringify(named)}`);
    }
    return doc as RegistryDocument;
  };
}

/**
 * Installs a registry name (`name`, `name@<version, range or tag>`) without npm (see the
 * header). A link refuses: npm is what fetches one.
 */
export async function installFromRegistry(
  root: string,
  specifier: string,
  io: WithoutNpm,
): Promise<InstalledPackage> {
  let source: ReturnType<typeof parsePluginSource>;
  try {
    source = parsePluginSource(specifier);
  } catch (err) {
    throw refusal(err instanceof Error ? err.message : String(err));
  }
  if (source.kind === "link") {
    throw needsNpm(`Installing from the link ${specifier}`, ["npm is what fetches a link"], io);
  }
  const { name } = source;
  const registry = (io.registry ?? configuredNpmRegistry() ?? OFFICIAL_REGISTRY).replace(
    /\/+$/,
    "",
  );
  const mirrors = io.mirrors ?? indexMirrorRules();
  const documentUrl = `${registry}/${name.replace("/", "%2f")}`;
  let document: RegistryDocument;
  try {
    document = await fetchFirst(
      [documentUrl, ...pluginProxyMirrors(documentUrl, mirrors)],
      {
        fetch: io.fetch,
        timeoutMs: io.limits?.timeoutMs ?? DOCUMENT_TIMEOUT_MS,
        maxBytes: io.limits?.documentMaxBytes ?? DOCUMENT_MAX_BYTES,
        mediaTypes: DOCUMENT_TYPES,
      },
      { take: parseDocument(name), settles: [401, 403, 404] },
    );
  } catch (err) {
    if (!(err instanceof WalkError)) throw err;
    if (err.settled === 404) {
      throw refusal(`${name} is not on the registry ${registry}`, "unavailable");
    }
    if (err.settled !== null) {
      throw refusal(
        `the registry ${registry} refused to answer for ${name} (${err.settled}); a private package installs through npm, with the credentials in its .npmrc`,
      );
    }
    throw refusal(`could not read ${name} from the registry: ${err.message}`);
  }
  const picked = pickRegistryVersion(name, document, source.version);
  if ("fault" in picked) {
    throw refusal(picked.fault, picked.unavailable ? "unavailable" : "other");
  }
  const { version } = picked;
  const label = `${name}@${version}`;
  const manifest = (document.versions?.[version] ?? {}) as PackageManifest;
  admit(label, manifest, false, io);
  const dist = (manifest.dist ?? {}) as { tarball?: unknown; integrity?: unknown };
  const digest = typeof dist.integrity === "string" ? digestOf(dist.integrity) : null;
  if (digest === null) {
    throw refusal(
      `${label}: the registry pins no sha512 integrity for it, so its bytes cannot be verified; it is not installed`,
    );
  }
  if (typeof dist.tarball !== "string" || !fetchableAddress(dist.tarball)) {
    throw refusal(`${label}: the registry names no https tarball for it; it is not installed`);
  }
  let bytes: Uint8Array;
  try {
    bytes = await fetchFirst(
      [dist.tarball, ...pluginProxyMirrors(dist.tarball, mirrors)],
      {
        fetch: io.fetch,
        timeoutMs: io.limits?.timeoutMs ?? TARBALL_TIMEOUT_MS,
        maxBytes: io.limits?.tarballMaxBytes ?? TARBALL_MAX_BYTES,
        onProgress: io.onProgress,
      },
      { take: pinnedTo(digest, "the registry") },
    );
  } catch (err) {
    if (err instanceof WalkError) throw refusal(`could not download ${label}: ${err.message}`);
    throw err;
  }
  const files = unpack(label, bytes, io);
  vetUnpacked(label, files, name, version, io);
  await placePackage(
    root,
    name,
    withExecutableBins(files, manifestOf(files)),
    savedRange(source.version, version),
  );
  return { name, version, withoutNpm: true };
}

/**
 * Installs a version through the published index's release channel without npm: the asset,
 * checked against the entry's sha512 before it is unpacked, over the channel's addresses in
 * order (the URL the index published, then its CDN mirrors). The verified asset is kept in
 * `archives/` and the prefix records `file:archives/<asset>`, as for an uploaded zip: a later
 * npm run then installs those very bytes from disk instead of fetching the release URL again —
 * which may be unreachable by then, and which npm would fetch without the index's sha512.
 */
export async function installChannel(
  root: string,
  channel: IndexChannel,
  io: WithoutNpm,
): Promise<InstalledPackage> {
  const label = `${channel.name}@${channel.version}`;
  const digest = digestOf(channel.integrity);
  if (digest === null) {
    throw refusal(
      `${label}: the index entry's sha512 integrity is not readable; it is not installed`,
    );
  }
  const addresses = [channel.url, ...(channel.mirrors ?? [])];
  let bytes: Uint8Array;
  try {
    bytes = await fetchFirst(
      addresses,
      {
        fetch: io.fetch,
        timeoutMs: io.limits?.timeoutMs ?? TARBALL_TIMEOUT_MS,
        maxBytes: io.limits?.tarballMaxBytes ?? TARBALL_MAX_BYTES,
        onProgress: io.onProgress,
      },
      { take: pinnedTo(digest, "the index entry") },
    );
  } catch (err) {
    if (err instanceof WalkError) {
      throw refusal(
        `could not install the release asset from any of ${addresses.join(", ")}: ${err.message}`,
      );
    }
    throw err;
  }
  const files = unpack(label, bytes, io);
  vetUnpacked(label, files, channel.name, channel.version, io);
  const asset = packFileName(channel.name, channel.version);
  await placePackage(
    root,
    channel.name,
    withExecutableBins(files, manifestOf(files)),
    `file:${ARCHIVES_DIR}/${asset}`,
    {
      beforeSwap: async () => {
        const archives = path.join(pluginsPrefix(root), ARCHIVES_DIR);
        await fs.mkdir(archives, { recursive: true });
        await fs.writeFile(path.join(archives, asset), bytes);
      },
    },
  );
  return { name: channel.name, version: channel.version, withoutNpm: true };
}

/** The file name `npm pack` gives a package's tarball: `@scope/name` → `scope-name-<version>.tgz`. */
function packFileName(name: string, version: string): string {
  return `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

/**
 * Installs an uploaded package's files without npm (relative POSIX path → bytes, checked by the
 * caller: a package.json at the top naming the package and its version, no path leaving the
 * directory). What `files` publishes is placed, and packed into the `archives/` tarball the
 * prefix records it by, as npm records a tarball it installed.
 */
export async function installFiles(
  root: string,
  files: ReadonlyMap<string, Uint8Array>,
  io: WithoutNpm,
): Promise<InstalledPackage> {
  let manifest: PackageManifest = {};
  try {
    const raw = files.get("package.json");
    manifest = (
      raw === undefined ? {} : JSON.parse(Buffer.from(raw).toString("utf8"))
    ) as PackageManifest;
  } catch {
    manifest = {};
  }
  const { name, version } = manifest;
  if (typeof name !== "string" || typeof version !== "string") {
    throw refusal("the package's package.json names no package and version");
  }
  const label = `${name}@${version}`;
  // What `npm pack` would publish from the directory is what npm's install of it would put in
  // the prefix (packlist.ts); the rest of the zip — a git-ignored `.env`, build caches — stays out.
  const published = new Map<string, TarballFile>(
    packedFiles(files).map((rel) => [rel, { data: files.get(rel)!, executable: false }]),
  );
  const collision = collidingPaths(published.keys());
  if (collision !== null) {
    throw refusal(
      `${label}: its files ${JSON.stringify(collision[0])} and ${JSON.stringify(collision[1])} would land on one path on some file systems; it is not installed`,
    );
  }
  admit(label, manifest, published.has("binding.gyp"), io);
  const tarball = packFileName(name, version);
  await placePackage(
    root,
    name,
    withExecutableBins(published, manifest),
    `file:${ARCHIVES_DIR}/${tarball}`,
    {
      beforeSwap: async (staged) => {
        const archives = path.join(pluginsPrefix(root), ARCHIVES_DIR);
        await fs.mkdir(archives, { recursive: true });
        await tar.c(
          {
            gzip: true,
            cwd: path.dirname(staged),
            file: path.join(archives, tarball),
            portable: true,
            mtime: PACK_MTIME,
          },
          [path.basename(staged)],
        );
      },
    },
  );
  return { name, version };
}

/** Takes a package out of the prefix without npm; a name never installed is not an error. */
export async function removeWithoutNpm(root: string, specifier: string): Promise<void> {
  const name = packageName(specifier);
  if (name === null) return;
  await removePackage(root, name);
}
