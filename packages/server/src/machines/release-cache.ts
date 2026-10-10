/**
 * Release packages this server fetches for machines that cannot download them themselves.
 *
 * An install normally has the machine download its release from GitHub or the OSS mirror
 * (install-server.ts). A machine that reaches neither — no route out, a network that blocks
 * both — gets the package from here instead, carried over the ssh session it is already
 * reached by. This module is the fetching half: the package for one target and version, from
 * the same two sources the installer uses, verified against the checksum published beside it,
 * and kept under `<root>/machines/releases/v<version>/` so a batch and every later install of
 * that version fetch it once. Only the version in use is kept: fetching another one removes
 * the rest, since a server installs one release at a time.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { RELEASE_SOURCES } from "./diagnose.js";
import type { CarryRelease } from "./install-server.js";

const CHECKSUM_TIMEOUT_MS = 30_000;
/** ~95 MB over a slow line. */
const PACKAGE_TIMEOUT_MS = 20 * 60_000;
const TARGET = /^(?:linux|darwin)-(?:x64|arm64)$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

/**
 * A CarryRelease over the cache directory `dir`. Concurrent asks for one package share one
 * fetch. `fetchImpl` is the network, for a test to script.
 */
export function releaseCache(dir: string, fetchImpl: typeof fetch = fetch): CarryRelease {
  const inFlight = new Map<string, ReturnType<CarryRelease>>();
  return (version, target) => {
    if (!VERSION.test(version) || !TARGET.test(target)) {
      return Promise.resolve({
        ok: false,
        detail: `no release package is published for ${target} at ${version}`,
      });
    }
    const name = `penguin-${target}.tar.gz`;
    const file = path.join(dir, `v${version}`, name);
    let running = inFlight.get(file);
    if (running === undefined) {
      running = fetchPackage(dir, file, `v${version}/${name}`, fetchImpl).finally(() =>
        inFlight.delete(file),
      );
      inFlight.set(file, running);
    }
    return running;
  };
}

async function fetchPackage(
  dir: string,
  file: string,
  rel: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; file: string } | { ok: false; detail: string }> {
  const sumFile = `${file}.sha256`;
  if (await cachedAndWhole(file, sumFile)) return { ok: true, file };
  const failures: string[] = [];
  // The mirror first, as the installer's automatic choice usually lands: it is the source
  // that answers where GitHub is slow, and both carry byte-identical packages.
  for (const [label, base] of [
    ["the mirror", RELEASE_SOURCES.oss],
    ["GitHub", RELEASE_SOURCES.github],
  ] as const) {
    try {
      const sum = (
        await (await get(fetchImpl, `${base}/${rel}.sha256`, CHECKSUM_TIMEOUT_MS)).text()
      )
        .trim()
        .split(/\s+/)[0]
        ?.toLowerCase();
      if (sum === undefined || !/^[0-9a-f]{64}$/.test(sum)) {
        throw new Error("its checksum file holds no checksum");
      }
      const bytes = Buffer.from(
        await (await get(fetchImpl, `${base}/${rel}`, PACKAGE_TIMEOUT_MS)).arrayBuffer(),
      );
      if (sha256(bytes) !== sum)
        throw new Error("the package does not match its published checksum");
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, bytes);
      await fsp.rename(tmp, file);
      await fsp.writeFile(sumFile, `${sum}  ${path.basename(file)}\n`);
      await pruneOthers(dir, path.basename(path.dirname(file)));
      return { ok: true, file };
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ok: false, detail: failures.join("; ") };
}

/** A GET that answered 2xx within `timeoutMs`, or the reason it did not. */
async function get(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<Response> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res;
}

/** A package already fetched, whose bytes still match the checksum fetched with it. */
async function cachedAndWhole(file: string, sumFile: string): Promise<boolean> {
  try {
    const sum = (await fsp.readFile(sumFile, "utf8")).trim().split(/\s+/)[0];
    return sum !== undefined && sha256(await fsp.readFile(file)) === sum;
  } catch {
    return false;
  }
}

/** Removes every version directory but `keep`. */
async function pruneOthers(dir: string, keep: string): Promise<void> {
  for (const name of fs.existsSync(dir) ? await fsp.readdir(dir) : []) {
    if (name !== keep) await fsp.rm(path.join(dir, name), { recursive: true, force: true });
  }
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
