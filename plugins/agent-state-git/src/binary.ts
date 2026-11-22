/**
 * The Git this plugin runs: GitHub Desktop's dugite-native build for this host, as dugite pins it.
 *
 * dugite's `script/embedded-git.json` names, per `<platform>-<arch>`, the archive of that release
 * and its sha256 — the same table dugite's own postinstall downloads from. This plugin reads the
 * table (bundled from the dugite version in its package.json) and fetches the archive itself,
 * when it first runs on a host, because no install step of the harness runs package scripts: the
 * builtin plugins are installed with `--ignore-scripts` into one prefix shared by every platform,
 * and the workspace does not allow dugite's script (pnpm-workspace.yaml).
 *
 * Only the `git` program is kept (on Windows, beside it, the four or six DLLs it loads), under
 * `<cacheDir>/<archive name>/`, laid out as in the archive. It is everything the plumbing this
 * plugin runs needs; the rest of a full build (credential helpers, Git LFS, templates, docs) is
 * 50–150 MiB this plugin has no use for.
 *
 * Where it looks, in order:
 *   1. `LOCAL_GIT_DIRECTORY`, a Git in dugite's layout an operator provides (dugite's own knob);
 *   2. the kept copy in the cache directory;
 *   3. the archive in `DUGITE_CACHE_DIR` (dugite's knob) or the cache directory, verified, and
 *      only then the network.
 * A host with no build in the table (musl, other architectures), a download that fails, or a
 * program that does not start is no Git: the harness keeps its built-in engine.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import pins from "dugite/script/embedded-git.json" with { type: "json" };

/** One row of dugite's table. */
export interface GitPin {
  name: string;
  url: string;
  checksum: string;
}

/** Where a Git is: the program, and the directory its own commands (`git unpack-objects`) are found in. */
export interface GitProgram {
  program: string;
  execPath: string;
}

const TABLE = pins as Record<string, GitPin>;

/** dugite's key for a host: `<platform>-<arch>`, as Node names them. */
export function pinFor(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): GitPin | null {
  return TABLE[`${platform}-${arch}`] ?? null;
}

/** The MSYS2 environment a Windows build lives in, by architecture (dugite's own choice). */
function windowsSubfolder(arch: string): string {
  return arch === "x64" ? "ucrt64" : arch === "arm64" ? "clangarm64" : "mingw32";
}

/** What is kept of an archive, by path inside it. */
export function keptFiles(platform: NodeJS.Platform, arch: string): string[] {
  if (platform !== "win32") return ["bin/git"];
  const bin = `${windowsSubfolder(arch)}/bin`;
  const dlls = ["libiconv-2.dll", "libintl-8.dll", "libpcre2-8-0.dll", "zlib1.dll"];
  if (arch === "ia32") dlls.push("libgcc_s_dw2-1.dll", "libwinpthread-1.dll");
  return [`${bin}/git.exe`, ...dlls.map((dll) => `${bin}/${dll}`)];
}

/** The program in a kept copy (or in dugite's layout, which has the same paths for it). */
function programIn(
  dir: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): GitProgram {
  const program = path.join(dir, ...keptFiles(platform, arch)[0]!.split("/"));
  return { program, execPath: path.dirname(program) };
}

/** A Git in dugite's full layout: `cmd/git.exe` on Windows and `bin/git` elsewhere, its commands in libexec. */
function dugiteLayout(dir: string): GitProgram {
  if (process.platform === "win32") {
    const sub = windowsSubfolder(process.arch);
    return {
      program: path.join(dir, "cmd", "git.exe"),
      execPath: path.join(dir, sub, "libexec", "git-core"),
    };
  }
  return { program: path.join(dir, "bin", "git"), execPath: path.join(dir, "libexec", "git-core") };
}

const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

async function sha256(file: string): Promise<string | null> {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    return hash.digest("hex");
  } catch {
    return null;
  }
}

/** The pinned archive, from a cache when one holds it verified, else downloaded and verified. */
async function archive(pin: GitPin, dirs: string[], log: (line: string) => void): Promise<string> {
  for (const dir of dirs) {
    const file = path.join(dir, pin.name);
    if ((await sha256(file)) === pin.checksum) return file;
  }
  const dir = dirs[dirs.length - 1]!;
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, pin.name);
  const temp = `${file}.${randomUUID()}.download`;
  log(`[agent-state-git] downloading ${pin.url}`);
  try {
    const response = await fetch(pin.url, {
      headers: { Accept: "application/octet-stream", "User-Agent": "dugite" },
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!response.ok || response.body === null) {
      throw new Error(`HTTP ${response.status} from ${pin.url}`);
    }
    const handle = await fs.open(temp, "wx");
    try {
      await pipeline(response.body, handle.createWriteStream());
    } finally {
      await handle.close().catch(() => undefined);
    }
    const got = await sha256(temp);
    if (got !== pin.checksum) {
      throw new Error(`${pin.name}: sha256 is ${got}, and dugite pins ${pin.checksum}`);
    }
    await fs.rename(temp, file);
    return file;
  } finally {
    await fs.rm(temp, { force: true });
  }
}

/** Unpacks only the kept files of `file` into a fresh directory beside `dest`, then renames it in. */
async function unpack(file: string, dest: string, kept: string[]): Promise<void> {
  const stage = `${dest}.${randomUUID()}.stage`;
  await fs.mkdir(stage, { recursive: true });
  try {
    const wanted = new Set(kept);
    await tar.x({
      file,
      cwd: stage,
      strict: true,
      filter: (name, entry) =>
        "type" in entry && entry.type === "File" && wanted.has(name.replace(/^\.\//, "")),
    });
    for (const rel of kept) {
      if (!(await exists(path.join(stage, rel)))) {
        throw new Error(`${path.basename(file)} holds no ${rel}`);
      }
    }
    await fs.chmod(path.join(stage, kept[0]!), 0o755);
    try {
      await fs.rename(stage, dest);
    } catch (err) {
      // Another process of this server finished first; its copy is the same.
      if (!(await exists(path.join(dest, kept[0]!)))) throw err;
    }
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

/**
 * The Git to run here, fetching the pinned build into `cacheDir` when no copy is kept yet; null
 * when this host has no build in dugite's table. A failed download rejects.
 */
export async function locateGit(opts: {
  cacheDir: string;
  env?: Readonly<Record<string, string | undefined>>;
  log?: (line: string) => void;
}): Promise<{ git: GitProgram; source: string } | null> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => {});
  const local = env.LOCAL_GIT_DIRECTORY;
  if (local) return { git: dugiteLayout(path.resolve(local)), source: "LOCAL_GIT_DIRECTORY" };
  const pin = pinFor();
  if (pin === null) return null;
  const dest = path.join(opts.cacheDir, pin.name.replace(/\.tar\.gz$/, ""));
  const git = programIn(dest);
  if (await exists(git.program)) return { git, source: dest };
  const caches = [
    ...(env.DUGITE_CACHE_DIR ? [path.resolve(env.DUGITE_CACHE_DIR)] : []),
    opts.cacheDir,
  ];
  const file = await archive(pin, caches, log);
  await unpack(file, dest, keptFiles(process.platform, process.arch));
  // The archive is only the way here: once unpacked it is 24–65 MiB of nothing.
  if (path.dirname(file) === opts.cacheDir) await fs.rm(file, { force: true });
  return { git, source: dest };
}
