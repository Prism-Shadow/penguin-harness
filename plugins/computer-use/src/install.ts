/**
 * agent-desktop, installed by this plugin rather than by npm (see pin.ts for why).
 *
 * The install downloads the pinned tarball from the npm registry the server installs plugins from
 * — then, when that fails, from the next address (the npm registry mirror of Plugin Sources) —
 * refuses it unless it matches the pinned sha512, keeps only this machine's program and helper —
 * each checked against its pinned sha256 — and writes them, through a staging directory renamed
 * into place, to `<data root>/cache/computer-use/agent-desktop/<version>/`:
 *
 *   agent-desktop[.exe]                         the program, under its plain name
 *   agent-desktop-linux-clipboard-owner         Linux: the helper the program looks for beside it
 *   agent-desktop-macos-helper                  macOS: the same, passed as AGENT_DESKTOP_MACOS_HELPER_PATH
 *   install.json                                what was installed, and when
 *
 * That is the prepare step upstream's postinstall does, done here so it never depends on install
 * scripts: the helper under its plain name, a regular file with one link, mode 0755, nothing
 * writable by group or others (agent-desktop refuses a helper that is, and a umask of 002 made
 * the clipboard fail). macOS also refuses a helper below a directory other users can write; that
 * is reported, not changed, since the directory is not this plugin's.
 *
 * A slow link is not a failure: an address is given up only when no byte arrives for
 * IDLE_TIMEOUT_MS (or it answers an error), and the whole install only after TOTAL_TIMEOUT_MS.
 * An install can be stopped (`signal`: the module was disposed, the plugin removed); it then ends
 * at once and leaves no staging directory behind.
 *
 * What is installed is checked again before a process first runs it (readInstalled): the digests
 * still match, the modes are still private. A platform outside the six targets is not a failure:
 * it is `UnsupportedPlatformError`, which the card shows as such.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { AGENT_DESKTOP, targetKey } from "./pin.js";
import type { AgentDesktopPin, TargetPin } from "./pin.js";
import { readTar } from "./tar.js";

/** A usable install: absolute paths of the program and its helper. */
export interface Installed {
  version: string;
  target: string;
  dir: string;
  program: string;
  helper?: string;
  /** macOS: a directory above the helper that other users can write, which makes agent-desktop refuse the helper. */
  helperProblem?: string;
}

/** Where an install stands while it runs. */
export type InstallProgress =
  { step: "download"; received: number; total: number } | { step: "verify" } | { step: "extract" };

export interface InstallOptions {
  /** The server's data root. */
  root: string;
  /** The npm registries' base URLs, in the order tried (Plugin Sources, then its mirror). */
  registries: readonly string[];
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  pin?: AgentDesktopPin;
  progress?: (at: InstallProgress) => void;
  /** How long one address may send nothing before the next is tried. */
  idleTimeoutMs?: number;
  /** The whole install's budget, over every address. */
  totalTimeoutMs?: number;
  /** Stops the install: it ends at once with InstallStoppedError, and leaves nothing staged. */
  signal?: AbortSignal;
}

/** No byte for this long gives an address up (a slow link that still sends keeps going). */
export const IDLE_TIMEOUT_MS = 30_000;
/** The whole install's budget: generous, since ~16 MB at a few hundred KB/s takes minutes. */
export const TOTAL_TIMEOUT_MS = 30 * 60_000;

/** The install was stopped (its module disposed, the plugin removed), not failed. */
export class InstallStoppedError extends Error {
  constructor() {
    super("the install was stopped");
  }
}

/** This machine is not one agent-desktop ships a program for. */
export class UnsupportedPlatformError extends Error {
  constructor(readonly target: string) {
    super(`agent-desktop has no program for ${target}`);
  }
}

const INSTALL_FILE = "install.json";

/** The directory one version is installed in. */
export function installDirOf(root: string, pin: AgentDesktopPin = AGENT_DESKTOP): string {
  return path.join(root, "cache", "computer-use", pin.name, pin.version);
}

/** The pin of this machine's target, or the unsupported error. */
export function targetPinOf(
  pin: AgentDesktopPin,
  platform: NodeJS.Platform,
  arch: string,
): { key: string; target: TargetPin } {
  const key = targetKey(platform, arch);
  const target = pin.targets[key];
  if (target === undefined) throw new UnsupportedPlatformError(key);
  return { key, target };
}

/** The tarball's URL under a registry: npm's `<name>/-/<name>-<version>.tgz`. */
export function tarballUrl(registry: string, pin: AgentDesktopPin = AGENT_DESKTOP): string {
  return `${registry.replace(/\/+$/, "")}/${pin.name}/-/${pin.name}-${pin.version}.tgz`;
}

async function sha256Of(file: string): Promise<string | null> {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    return hash.digest("hex");
  } catch {
    return null;
  }
}

/**
 * The first directory above `dir` that would make macOS's agent-desktop refuse a helper in it: one
 * writable by group or others without the sticky bit, or owned by someone other than root or this
 * user. Null when there is none.
 */
export async function unsafeAncestor(dir: string): Promise<string | null> {
  const uid = process.getuid?.();
  let at = path.resolve(dir);
  for (;;) {
    try {
      const st = await fs.lstat(at);
      const writable = (st.mode & 0o022) !== 0 && (st.mode & 0o1000) === 0;
      const owner = st.uid === 0 || uid === undefined || st.uid === uid;
      if (writable || !owner) return at;
    } catch {
      return at;
    }
    const parent = path.dirname(at);
    if (parent === at) return null;
    at = parent;
  }
}

/**
 * Whether one kept file is what the pin says and private: its digest matches, it is a regular
 * file with one link. A mode another user could write through is put right (it is this plugin's
 * own file); anything else is not an install.
 */
async function keptFileOk(file: string, sha256: string, platform: NodeJS.Platform) {
  let st;
  try {
    st = await fs.lstat(file);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  if (platform !== "win32") {
    if (st.nlink !== 1) return false;
    if ((st.mode & 0o022) !== 0 || (st.mode & 0o100) === 0) await fs.chmod(file, 0o755);
  }
  return (await sha256Of(file)) === sha256;
}

/** The install that is on disk and still checks, or null. */
export async function readInstalled(
  root: string,
  opts: { platform?: NodeJS.Platform; arch?: string; pin?: AgentDesktopPin } = {},
): Promise<Installed | null> {
  const pin = opts.pin ?? AGENT_DESKTOP;
  const platform = opts.platform ?? process.platform;
  const { key, target } = targetPinOf(pin, platform, opts.arch ?? process.arch);
  const dir = installDirOf(root, pin);
  let recorded: { version?: unknown; target?: unknown };
  try {
    recorded = JSON.parse(
      await fs.readFile(path.join(dir, INSTALL_FILE), "utf8"),
    ) as typeof recorded;
  } catch {
    return null;
  }
  if (recorded.version !== pin.version || recorded.target !== key) return null;
  const program = path.join(dir, target.program.name);
  if (!(await keptFileOk(program, target.program.sha256, platform))) return null;
  let helper: string | undefined;
  if (target.helper !== undefined) {
    helper = path.join(dir, target.helper.name);
    if (!(await keptFileOk(helper, target.helper.sha256, platform))) return null;
  }
  const installed: Installed = {
    version: pin.version,
    target: key,
    dir,
    program,
    ...(helper !== undefined ? { helper } : {}),
  };
  if (platform === "darwin" && helper !== undefined) {
    const problem = await unsafeAncestor(dir);
    if (problem !== null) installed.helperProblem = problem;
  }
  return installed;
}

/**
 * The tarball's bytes from the first address that sends all of them and matches the pinned
 * integrity, trying `registries` in order; the error names what each address did.
 */
async function download(opts: InstallOptions, pin: AgentDesktopPin): Promise<Buffer> {
  const deadline = AbortSignal.timeout(opts.totalTimeoutMs ?? TOTAL_TIMEOUT_MS);
  const failures: string[] = [];
  for (const registry of opts.registries) {
    if (opts.signal?.aborted) throw new InstallStoppedError();
    try {
      return await downloadFrom(registry, opts, pin, deadline);
    } catch (err) {
      if (err instanceof InstallStoppedError) throw err;
      const host = new URL(tarballUrl(registry, pin)).host;
      failures.push(`${host}: ${err instanceof Error ? err.message : String(err)}`);
      if (deadline.aborted) break;
    }
  }
  throw new Error(
    `${pin.name} ${pin.version} could not be downloaded (${failures.join("; ") || "no npm registry to try"})`,
  );
}

/** A span for a message: seconds under a minute, minutes above. */
function duration(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** One address: given up after `idleTimeoutMs` without a byte, or at the overall deadline. */
async function downloadFrom(
  registry: string,
  opts: InstallOptions,
  pin: AgentDesktopPin,
  deadline: AbortSignal,
): Promise<Buffer> {
  const url = tarballUrl(registry, pin);
  const doFetch = opts.fetch ?? fetch;
  const idleMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const attempt = new AbortController();
  let why: "idle" | "deadline" | "stopped" | null = null;
  const abort = (reason: "idle" | "deadline" | "stopped") => {
    why ??= reason;
    attempt.abort();
  };
  let idle = setTimeout(() => abort("idle"), idleMs);
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => abort("idle"), idleMs);
  };
  const onDeadline = () => abort("deadline");
  const onStop = () => abort("stopped");
  deadline.addEventListener("abort", onDeadline);
  opts.signal?.addEventListener("abort", onStop);
  const explain = (err: unknown): Error =>
    why === "stopped"
      ? new InstallStoppedError()
      : why === "idle"
        ? new Error(`no data arrived for ${duration(idleMs)}`)
        : why === "deadline"
          ? new Error(
              `the install ran out of its ${duration(opts.totalTimeoutMs ?? TOTAL_TIMEOUT_MS)}`,
            )
          : err instanceof Error
            ? err
            : new Error(String(err));
  try {
    let response: Response;
    try {
      response = await doFetch(url, {
        signal: attempt.signal,
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": "penguinharness-computer-use",
        },
      });
    } catch (err) {
      const e = explain(err);
      if (e instanceof InstallStoppedError) throw e;
      throw new Error(`could not be reached: ${e.message}`);
    }
    if (!response.ok || response.body === null) throw new Error(`answered ${response.status}`);
    touch();
    const total = Number(response.headers.get("content-length")) || pin.size;
    const hash = createHash("sha512");
    const chunks: Buffer[] = [];
    let received = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        let chunk: { done: boolean; value?: Uint8Array };
        try {
          chunk = await reader.read();
        } catch (err) {
          throw explain(err);
        }
        if (why !== null) throw explain(null);
        if (chunk.done || chunk.value === undefined) break;
        touch();
        received += chunk.value.byteLength;
        if (received > pin.size * 2) {
          throw new Error(`sent more than twice the ${pin.size} bytes the pin expects`);
        }
        hash.update(chunk.value);
        chunks.push(Buffer.from(chunk.value));
        opts.progress?.({ step: "download", received, total });
      }
    } finally {
      reader.releaseLock();
    }
    opts.progress?.({ step: "verify" });
    const integrity = `sha512-${hash.digest("base64")}`;
    if (integrity !== pin.integrity) {
      throw new Error(
        `sent a tarball that does not match the pinned integrity of ${pin.name} ${pin.version}; it was not used`,
      );
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(idle);
    deadline.removeEventListener("abort", onDeadline);
    opts.signal?.removeEventListener("abort", onStop);
  }
}

/**
 * Removes what an interrupted or locked install left beside `dir`: staging directories and old
 * directories set aside (one still in use on Windows stays until the next install).
 */
export async function sweepLeftovers(dir: string): Promise<void> {
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  let names: string[];
  try {
    names = await fs.readdir(parent);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(`${base}.staging-`) || name.startsWith(`${base}.old-`)) {
      await fs.rm(path.join(parent, name), { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** `mkdir` of each missing level from `base` down to `dir`, each made 0755 whatever the umask. */
async function mkdirOwned(base: string, dir: string): Promise<void> {
  const rel = path.relative(base, dir);
  let at = base;
  for (const part of ["", ...rel.split(path.sep).filter((p) => p !== "")]) {
    at = part === "" ? at : path.join(at, part);
    try {
      await fs.mkdir(at);
      await fs.chmod(at, 0o755);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

/**
 * Downloads, verifies and installs the pinned agent-desktop for this machine, replacing whatever
 * was in its directory. Throws UnsupportedPlatformError for a machine with no program, and an
 * Error saying what went wrong for anything else; a failure leaves the previous directory alone.
 */
export async function installAgentDesktop(opts: InstallOptions): Promise<Installed> {
  const pin = opts.pin ?? AGENT_DESKTOP;
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const { key, target } = targetPinOf(pin, platform, arch);
  const tarball = await download(opts, pin);
  if (opts.signal?.aborted) throw new InstallStoppedError();
  opts.progress?.({ step: "extract" });
  let archive: Buffer;
  try {
    archive = gunzipSync(tarball);
  } catch {
    throw new Error(`the ${pin.name} tarball is not gzip data`);
  }
  const files = [target.program, ...(target.helper !== undefined ? [target.helper] : [])];
  const entries = readTar(archive, (p) => files.some((f) => f.entry === p));
  const dir = installDirOf(opts.root, pin);
  await mkdirOwned(opts.root, path.dirname(dir));
  await sweepLeftovers(dir);
  const staging = `${dir}.staging-${randomUUID().slice(0, 8)}`;
  await fs.mkdir(staging);
  try {
    await fs.chmod(staging, 0o755);
    for (const file of files) {
      const entry = entries.get(file.entry);
      if (entry === undefined) throw new Error(`the ${pin.name} tarball has no ${file.entry}`);
      const digest = createHash("sha256").update(entry.data).digest("hex");
      if (digest !== file.sha256) {
        throw new Error(`${file.entry} does not match its pinned sha256; it was not used`);
      }
      const into = path.join(staging, file.name);
      await fs.writeFile(into, entry.data, { mode: 0o755, flag: "wx" });
      await fs.chmod(into, 0o755);
    }
    await fs.writeFile(
      path.join(staging, INSTALL_FILE),
      `${JSON.stringify(
        {
          name: pin.name,
          version: pin.version,
          target: key,
          integrity: pin.integrity,
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { mode: 0o644 },
    );
    await fs.chmod(path.join(staging, INSTALL_FILE), 0o644);
    // Stopped while writing: the staging directory goes, and the install in place stays.
    if (opts.signal?.aborted) throw new InstallStoppedError();
    // The old directory is renamed aside, never deleted in place: on Windows a running
    // agent-desktop keeps its program open, which a delete half-finishes and a rename survives.
    const aside = `${dir}.old-${randomUUID().slice(0, 8)}`;
    let moved = false;
    try {
      await fs.rename(dir, aside);
      moved = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    try {
      await fs.rename(staging, dir);
    } catch (err) {
      if (moved) await fs.rename(aside, dir).catch(() => {});
      throw err;
    }
    if (moved) await fs.rm(aside, { recursive: true, force: true }).catch(() => {});
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true });
    throw err;
  }
  const installed = await readInstalled(opts.root, { platform, arch, pin });
  if (installed === null) throw new Error(`${dir} did not check after it was written`);
  return installed;
}
