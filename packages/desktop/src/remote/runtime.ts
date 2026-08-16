/**
 * The Node runtime that travels with the payload.
 *
 * The install image is the universal one — pure JavaScript, no runtime — so a remote that has
 * no Node, or too old a Node, could not run it. Rather than requiring the user to install
 * Node on every machine first (and rather than trusting whatever version happens to be
 * there), the app fetches the official build for the remote's platform and arch and installs
 * it inside the program directory at `lib/runtime`. The launchers prefer it, so the install
 * is self-contained and nothing on that machine is touched outside the program directory.
 *
 * Downloads are verified against nodejs.org's own `SHASUMS256.txt` for the release: we are
 * putting an executable on someone else's machine, so "it downloaded" is not good enough.
 * They are cached locally by file name — the same runtime serves every host of that shape.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RemoteArch, RemotePlatform } from "./detect.js";

/**
 * Pinned to what the release workflow bundles (NODE_RUNTIME_VERSION in release.yml), so a
 * pushed install runs on the same runtime as a downloaded one.
 */
export const NODE_RUNTIME_VERSION = "v24.18.0";

const DIST_BASE = "https://nodejs.org/dist";

export interface RuntimeArtifact {
  /** File name as published, which is also the cache key and the SHASUMS256 entry. */
  fileName: string;
  url: string;
  checksumsUrl: string;
  /** Directory the archive unpacks into (nodejs.org archives carry one top-level dir). */
  rootDirName: string;
}

/**
 * The artifact for a remote's shape. POSIX targets take `.tar.gz` rather than the smaller
 * `.tar.xz` the release workflow uses: every tar can un-gzip, while xz support is a separate
 * binary that minimal images often lack, and the far side has no runtime of ours to fall back
 * on yet. Windows takes the `.zip`, which its bundled bsdtar reads.
 */
export function runtimeArtifact(platform: RemotePlatform, arch: RemoteArch): RuntimeArtifact {
  const osName = platform === "win32" ? "win" : platform;
  const rootDirName = `node-${NODE_RUNTIME_VERSION}-${osName}-${arch}`;
  const fileName = `${rootDirName}.${platform === "win32" ? "zip" : "tar.gz"}`;
  return {
    fileName,
    rootDirName,
    url: `${DIST_BASE}/${NODE_RUNTIME_VERSION}/${fileName}`,
    checksumsUrl: `${DIST_BASE}/${NODE_RUNTIME_VERSION}/SHASUMS256.txt`,
  };
}

/** Path of the node executable inside an unpacked runtime, relative to its root directory. */
export function nodeExecutableRelPath(platform: RemotePlatform): string {
  return platform === "win32" ? "node.exe" : "bin/node";
}

/** The published sha256 for one file out of a `SHASUMS256.txt`, or null when it is not listed. */
export function checksumFor(shasumsText: string, fileName: string): string | null {
  for (const line of shasumsText.split("\n")) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (match && match[2] === fileName) return match[1]!;
  }
  return null;
}

export function sha256Of(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Returns the cached archive for a remote's shape, downloading and verifying it first if
 * needed. `fetchBuffer` is injected so this is testable without a network, and so the caller
 * decides about proxies.
 *
 * A mismatching checksum deletes the download and throws: a runtime we cannot vouch for is
 * not something to install on someone's machine, and a partial cache entry must not survive
 * to be trusted on the next attempt.
 */
export async function ensureRuntimeArchive(opts: {
  platform: RemotePlatform;
  arch: RemoteArch;
  cacheDir: string;
  fetchBuffer: (url: string) => Promise<Buffer>;
  onProgress?: (line: string) => void;
}): Promise<{ archivePath: string; artifact: RuntimeArtifact }> {
  const artifact = runtimeArtifact(opts.platform, opts.arch);
  const archivePath = path.join(opts.cacheDir, artifact.fileName);
  if (fs.existsSync(archivePath)) return { archivePath, artifact };

  opts.onProgress?.(
    `Fetching the Node ${NODE_RUNTIME_VERSION} runtime for ${opts.platform}-${opts.arch}…`,
  );
  const shasums = (await opts.fetchBuffer(artifact.checksumsUrl)).toString("utf8");
  const expected = checksumFor(shasums, artifact.fileName);
  if (expected === null) {
    throw new Error(`nodejs.org does not list ${artifact.fileName} for ${NODE_RUNTIME_VERSION}.`);
  }
  const archive = await opts.fetchBuffer(artifact.url);
  const actual = sha256Of(archive);
  if (actual !== expected) {
    throw new Error(
      `checksum mismatch for ${artifact.fileName}: expected ${expected}, got ${actual}`,
    );
  }
  fs.mkdirSync(opts.cacheDir, { recursive: true });
  // Write beside the target and rename, so an interrupted download never leaves a file that
  // the next run would take for a verified cache hit.
  const partial = `${archivePath}.partial`;
  fs.writeFileSync(partial, archive);
  fs.renameSync(partial, archivePath);
  return { archivePath, artifact };
}
