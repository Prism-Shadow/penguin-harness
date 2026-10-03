/**
 * Writing the data root's plugin prefix, `<root>/plugins/` (plugin/prefix.ts). A package gets
 * there one way, `placePackage`: unpacked complete under `.staging/`, then renamed into
 * `node_modules/<name>/`, and only then is what it replaced deleted — so a crash at any point
 * leaves a whole copy on disk and recovery (`recoverPrefix`) needs no network. Two things feed
 * it: a download (`downloadPlugin`: `npm pack` of an index row's exact version, checked against
 * its integrity before anything is unpacked) and a package a retained push still holds that
 * nothing else does (`adoptRetained`). Every write runs on one queue. Design: PRFC-0006,
 * 算法与原子性 (D, P, R, H).
 *
 * npm runs with the machine's own configuration — registry, proxy, private scopes — as for any
 * npm consumer.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import * as tar from "tar";
import { unpackedAssetsDir } from "../hmr/asset-archives.js";
import type { PluginAsk } from "../api/plugin-pick.js";
import {
  PACKAGE_NAME,
  packageDir,
  pickLocal,
  pluginBases,
  pluginsPrefix,
  type PluginBase,
} from "./prefix.js";
import { INTEGRITY_FILE, tarballIntegrity } from "../../../../scripts/plugin-entry.mjs";

const execFileAsync = promisify(execFile);

export class PluginInstallError extends Error {}

/** The tarball's hash is not the one its index row names: nothing was unpacked. */
export class PluginIntegrityMismatch extends PluginInstallError {
  constructor(name: string, version: string, expected: string, actual: string) {
    super(
      `${name}@${version}: the tarball hashes to ${actual}, the index names ${expected}; nothing was installed`,
    );
  }
}

/** Work in progress, beside `node_modules/` on the same filesystem so a rename commits it. */
const STAGING_DIR = ".staging";

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

let chain: Promise<unknown> = Promise.resolve();

/** Runs `fn` after every prefix write queued before it; a failure is the caller's. */
function onPrefixQueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** A fresh directory under the prefix's `.staging/`, named `<kind>-<random>`. */
async function stage(root: string, kind: string): Promise<string> {
  const staging = path.join(pluginsPrefix(root), STAGING_DIR);
  await fsp.mkdir(staging, { recursive: true });
  return fsp.mkdtemp(path.join(staging, `${kind}-`));
}

/**
 * P: renames the complete package at `<u>/package` into `node_modules/<name>`. An existing one
 * is renamed aside into `.staging/d-…/package` first and deleted only after the new one is in
 * place; a crash between the two renames leaves it there for `recoverPrefix` to put back.
 */
async function placePackage(root: string, name: string, u: string): Promise<void> {
  const target = packageDir(pluginsPrefix(root), name);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  let aside: string | null = null;
  if (fs.existsSync(target)) {
    aside = await stage(root, "d");
    await fsp.rename(target, path.join(aside, "package"));
  }
  await fsp.rename(path.join(u, "package"), target);
  if (aside !== null) await fsp.rm(aside, { recursive: true, force: true });
}

/** `npm pack <specifier>` into `cwd`; injectable for tests. */
export type RegistryFetch = (specifier: string, cwd: string) => Promise<void>;

/** `npm pack <specifier>`: the registry's tarball, through the machine's npm configuration. */
const npmPack: RegistryFetch = async (specifier, cwd) => {
  try {
    const npm = npmCommand(["pack", "--", specifier]);
    await execFileAsync(npm.command, npm.args, {
      cwd,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
      env: npmEnv(process.env),
      shell: npm.shell,
    });
  } catch (err) {
    if (err instanceof PluginInstallError) throw err;
    throw new PluginInstallError(npmReason((err as { stderr?: string }).stderr, err as Error));
  }
};

/**
 * D: downloads the exact version an index row names, checks the tarball against the row's
 * integrity, unpacks it (its top directory becomes the package; its declared dependencies are
 * not installed), records the integrity, and places it.
 */
export function downloadPlugin(
  root: string,
  row: { name: string; version: string; integrity: string },
  fetch: RegistryFetch = npmPack,
): Promise<void> {
  return onPrefixQueue(async () => {
    const f = await stage(root, "f");
    const u = await stage(root, "u");
    try {
      await fetch(`${row.name}@${row.version}`, f);
      const tarball = (await fsp.readdir(f)).find((n) => n.endsWith(".tgz"));
      if (tarball === undefined) {
        throw new PluginInstallError(`npm pack ${row.name}@${row.version} left no tarball`);
      }
      const actual = await tarballIntegrity(path.join(f, tarball));
      if (actual !== row.integrity) {
        throw new PluginIntegrityMismatch(row.name, row.version, row.integrity, actual);
      }
      const pkg = path.join(u, "package");
      await fsp.mkdir(pkg);
      await tar.x({ file: path.join(f, tarball), cwd: pkg, strip: 1, preservePaths: false });
      await fsp.writeFile(path.join(pkg, INTEGRITY_FILE), `${row.integrity}\n`);
      await placePackage(root, row.name, u);
    } finally {
      await fsp.rm(f, { recursive: true, force: true });
      await fsp.rm(u, { recursive: true, force: true });
    }
  });
}

/**
 * R: what a crash left under `.staging/`. A package renamed aside (`d-…/package`) goes back
 * when nothing took its place, else it is deleted; everything else there is unfinished or
 * already placed, and deleted. No network: the copy that is kept is on disk.
 */
export function recoverPrefix(root: string): Promise<void> {
  return onPrefixQueue(async () => {
    const staging = path.join(pluginsPrefix(root), STAGING_DIR);
    for (const entry of await fsp.readdir(staging).catch(() => [] as string[])) {
      const dir = path.join(staging, entry);
      const pkg = path.join(dir, "package");
      if (entry.startsWith("d-")) {
        try {
          const { name } = JSON.parse(
            await fsp.readFile(path.join(pkg, "package.json"), "utf8"),
          ) as { name?: unknown };
          const target = typeof name === "string" ? packageDir(pluginsPrefix(root), name) : null;
          if (target !== null && !fs.existsSync(target)) {
            await fsp.mkdir(path.dirname(target), { recursive: true });
            await fsp.rename(pkg, target);
            console.warn(
              `[plugins] ${String(name)}: put back the copy an interrupted upgrade left aside`,
            );
          }
        } catch {
          // No readable package left: nothing to put back.
        }
      }
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
}

/** The prefixes of the pushes hmr keeps besides `current`, unpacked: where an adoption looks. */
function retainedBases(root: string, current: string | null): PluginBase[] {
  const assets = path.join(root, "hmr", "store", "assets");
  let names: string[];
  try {
    names = fs.readdirSync(assets);
  } catch {
    return [];
  }
  return names
    .map((n) => path.join(assets, n))
    .filter((dir) => current === null || path.resolve(dir) !== path.resolve(current))
    .flatMap((dir) => {
      try {
        return [{ dir: path.join(unpackedAssetsDir(dir), "plugins"), builtin: true }];
      } catch {
        return [];
      }
    });
}

/**
 * H: a plugin `asks` names that neither the data root's prefix nor the running build can
 * satisfy, but a push hmr still retains can, is copied into the data root's prefix and placed —
 * before hmr's prune takes that push, so it never has to be downloaded again. Best effort:
 * a failure is logged, and the plugin is reported missing as it would have been.
 */
export function adoptRetained(
  root: string,
  asks: ReadonlyMap<string, readonly PluginAsk[]>,
  assetsDir: string | null,
): Promise<void> {
  return onPrefixQueue(async () => {
    const bases = pluginBases(root, assetsDir);
    let retained: PluginBase[] | null = null;
    for (const [name, list] of asks) {
      // A table key is the operator's text: one that is not a package name never becomes a path.
      if (!PACKAGE_NAME.test(name)) continue;
      if (!("refused" in pickLocal(bases, name, list))) continue;
      retained ??= retainedBases(root, assetsDir);
      const pick = pickLocal(retained, name, list);
      if ("refused" in pick) continue;
      const u = await stage(root, "u");
      try {
        await fsp.cp(pick.dir, path.join(u, "package"), { recursive: true });
        await placePackage(root, name, u);
        console.warn(`[plugins] ${name}@${pick.version}: kept from a retained push`);
      } catch (err) {
        console.warn(
          `[plugins] ${name}: could not keep it from a retained push: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        await fsp.rm(u, { recursive: true, force: true });
      }
    }
  });
}
