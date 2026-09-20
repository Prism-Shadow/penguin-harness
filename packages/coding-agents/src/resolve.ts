/**
 * Filesystem command resolution: find an executable on PATH without spawning a shell.
 * A server process (a GUI-launched Electron app, a Windows service, an npm-shim-only
 * install) often has CLIs that `spawn` cannot find by bare name, so both discovery and
 * the manager resolve through here first. Pure `node:fs` — the same reason no `which`:
 * every spawn is gated and slow under privilege managers, and existence checks need none.
 */
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];

function pathDirs(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? "").split(path.delimiter).filter((dir) => dir.trim() !== "");
}

/** Candidate extensions for a bare command name; `""` first so a spelled extension wins. */
function candidateExtensions(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") return [""];
  const exts = (env.PATHEXT ?? "")
    .split(";")
    .map((e) => e.trim())
    .filter((e) => e !== "")
    .map((e) => (e.startsWith(".") ? e : `.${e}`));
  return ["", ...(exts.length > 0 ? exts : DEFAULT_PATHEXT)];
}

async function isExecutable(file: string): Promise<boolean> {
  const stat = await fs.stat(file).catch(() => undefined);
  if (stat === undefined || !stat.isFile()) return false;
  if (process.platform === "win32") return true;
  return (stat.mode & 0o111) !== 0;
}

async function firstMatch(dirs: string[], basename: string): Promise<string | undefined> {
  for (const dir of dirs) {
    const file = path.join(dir, basename);
    if (await isExecutable(file)) return file;
  }
  return undefined;
}

/**
 * Resolve a command to an absolute path by walking PATH (plus `extraDirs`, discovery's
 * version-manager install homes). A command carrying a directory separator is returned
 * unchanged — an explicit path means the caller (or the eventual spawn error) already
 * knows best, and the cwd is deliberately never searched.
 */
export async function resolveCommandPath(
  command: string,
  options: { env?: NodeJS.ProcessEnv; extraDirs?: string[] } = {},
): Promise<string> {
  const env = options.env ?? process.env;
  if (command.includes("/") || command.includes("\\")) return command;
  const dirs = [...pathDirs(env), ...(options.extraDirs ?? [])];
  for (const ext of candidateExtensions(env)) {
    const found = await firstMatch(dirs, `${command}${ext}`);
    if (found !== undefined) return found;
  }
  return command;
}
