/**
 * Download and install one npm platform package as a runtime Penguin runs itself: metadata from
 * the registry, the tarball checked against the checksum the registry publishes, unpacked into a
 * temporary folder and renamed into `<runtimesDir>/<version>` in one step, then started once with
 * --version. A failed, cut-off or cancelled download never replaces a working version. Uses the
 * global fetch, which the server routes through its proxy settings (net/proxy.ts).
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { sandboxedAgentEnv, spawnTarget } from "@prismshadow/penguin-coding-agents";
import * as tar from "tar";
import { binaryFromManifest } from "./copilot-package.js";

export interface InstallRequest {
  registry: string;
  packageName: string;
  version: string;
  runtimesDir: string;
  signal?: AbortSignal;
  onProgress?: (received: number, total: number | null) => void;
  /**
   * The environment the --version check runs with; defaults to the sandboxed agent
   * allow-list, never the server's own environment.
   */
  env?: Record<string, string>;
}

export interface InstalledRuntime {
  version: string;
  dir: string;
  program: string;
  reportedVersion: string;
}

export class RuntimeInstallError extends Error {
  constructor(
    readonly kind: "network" | "integrity" | "start" | "cancelled",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RuntimeInstallError";
  }
}

const INCOMING = ".incoming-";

export async function installRuntime(req: InstallRequest): Promise<InstalledRuntime> {
  await fs.mkdir(req.runtimesDir, { recursive: true });
  const incoming = path.join(req.runtimesDir, `${INCOMING}${randomUUID().slice(0, 8)}`);
  try {
    const meta = await fetchJson(`${req.registry}/${req.packageName}/${req.version}`, req.signal);
    const dist = (meta as { dist?: { tarball?: unknown; integrity?: unknown } }).dist;
    if (typeof dist?.tarball !== "string" || typeof dist.integrity !== "string") {
      throw new RuntimeInstallError(
        "network",
        "The registry did not describe the package download.",
      );
    }
    await fs.mkdir(incoming);
    const archive = path.join(incoming, "package.tgz");
    await download(dist.tarball, dist.integrity, archive, req);
    const unpacked = path.join(incoming, "unpacked");
    await fs.mkdir(unpacked);
    await tar.extract({ file: archive, cwd: unpacked, strip: 1 });
    await fs.rm(archive);
    const target = path.join(req.runtimesDir, req.version);
    // Never delete a working install before the replacement has proven itself: move it aside
    // under an `.incoming-` name first (so a crash before cleanup still gets swept up by the
    // next startup's cleanRuntimes), and restore it if the rename or the --version check fails.
    const aside = path.join(req.runtimesDir, `${INCOMING}${randomUUID().slice(0, 8)}-prev`);
    let hadPrevious = false;
    try {
      await fs.rename(target, aside);
      hadPrevious = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await fs.rename(unpacked, target);
    } catch (error) {
      if (hadPrevious) await fs.rename(aside, target).catch(() => undefined);
      throw error;
    }
    const installed = await installedRuntime(req.runtimesDir, req.version);
    // On the two restore paths below, if this `rm` of the bad target fails, the old copy stays
    // stranded under its `.incoming-` name and the next startup's cleanup deletes it. That is only
    // safe because BuiltinAgentsService never reinstalls a working pinned version; any future
    // "force reinstall" must move the bad target aside first instead of relying on this rm.
    if (installed === null) {
      await fs.rm(target, { recursive: true, force: true });
      if (hadPrevious) await fs.rename(aside, target).catch(() => undefined);
      throw new RuntimeInstallError("start", "The package did not unpack a program.");
    }
    const reportedVersion = await versionOf(
      installed.program,
      req.env ?? sandboxedAgentEnv(),
    ).catch(async (error: unknown) => {
      await fs.rm(target, { recursive: true, force: true });
      if (hadPrevious) await fs.rename(aside, target).catch(() => undefined);
      throw new RuntimeInstallError(
        "start",
        `The program did not start: ${(error as Error).message}`,
        {
          cause: error,
        },
      );
    });
    if (hadPrevious) await fs.rm(aside, { recursive: true, force: true }).catch(() => undefined);
    return { ...installed, reportedVersion };
  } catch (error) {
    if (req.signal?.aborted)
      throw new RuntimeInstallError("cancelled", "The download was cancelled.");
    if (error instanceof RuntimeInstallError) throw error;
    throw new RuntimeInstallError("network", (error as Error).message, { cause: error });
  } finally {
    await fs.rm(incoming, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The runtime already unpacked for `version`, or null. Does not start it. */
export async function installedRuntime(
  runtimesDir: string,
  version: string,
): Promise<InstalledRuntime | null> {
  const dir = path.join(runtimesDir, version);
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(dir, "package.json"), "utf8"),
    ) as unknown;
    const program = path.join(dir, binaryFromManifest(manifest));
    await fs.access(program);
    return { version, dir, program, reportedVersion: "" };
  } catch {
    return null;
  }
}

/** Remove leftover incoming folders and every version but `keepVersion`. Best-effort. */
export async function cleanRuntimes(
  runtimesDir: string,
  keepVersion: string | null,
): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(runtimesDir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name !== keepVersion)
      .map((name) =>
        fs
          .rm(path.join(runtimesDir, name), { recursive: true, force: true })
          .catch(() => undefined),
      ),
  );
}

async function fetchJson(url: string, signal: AbortSignal | undefined): Promise<unknown> {
  const res = await fetch(url, {
    ...(signal ? { signal } : {}),
    headers: { accept: "application/json" },
  });
  if (!res.ok)
    throw new RuntimeInstallError("network", `The registry answered ${res.status} for ${url}.`);
  return res.json();
}

/**
 * npm's `dist.integrity` is a Subresource Integrity string: one or more space-separated
 * `<algorithm>-<base64 digest>` entries (a package can publish sha1 alongside sha512). Pick the
 * sha512 entry specifically, never a weaker one the registry happens to list first.
 */
export function parseSha512Integrity(integrity: string): string {
  const entry = integrity
    .trim()
    .split(/\s+/u)
    .find((candidate) => candidate.startsWith("sha512-"));
  if (entry === undefined) {
    throw new RuntimeInstallError("integrity", "The registry did not publish a sha512 checksum.");
  }
  return entry.slice("sha512-".length);
}

async function download(
  url: string,
  integrity: string,
  file: string,
  req: InstallRequest,
): Promise<void> {
  const res = await fetch(url, req.signal ? { signal: req.signal } : {});
  if (!res.ok || res.body === null) {
    throw new RuntimeInstallError("network", `The download answered ${res.status}.`);
  }
  let expected: string;
  try {
    expected = parseSha512Integrity(integrity);
  } catch (error) {
    await res.body.cancel().catch(() => undefined);
    throw error;
  }
  const header = res.headers.get("content-length");
  const total = header !== null ? Number(header) : null;
  const hash = createHash("sha512");
  let received = 0;
  // A hashing pass-through in front of the write stream: `pipeline` wires error listeners on
  // every stream (source, transform, sink) and destroys them all on any failure, so a disk
  // error (or an abort) rejects this call instead of surfacing as an unhandled 'error' event,
  // and the write stream is always closed before pipeline settles.
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      received += chunk.length;
      req.onProgress?.(received, total);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
    hashing,
    createWriteStream(file),
    { signal: req.signal },
  );
  if (total !== null && received !== total) {
    throw new RuntimeInstallError("network", "The download stopped before it finished.");
  }
  if (hash.digest("base64") !== expected) {
    throw new RuntimeInstallError(
      "integrity",
      "The download did not match its published checksum and was discarded.",
    );
  }
}

function versionOf(program: string, env: Record<string, string>): Promise<string> {
  const [file, args] = spawnTarget(program, ["--version"]);
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: 30_000,
        windowsHide: true,
        env,
        ...(file !== program ? { windowsVerbatimArguments: true } : {}),
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim().split(/\r?\n/u)[0] ?? "");
      },
    );
  });
}
