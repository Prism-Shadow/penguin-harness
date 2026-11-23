/**
 * Rewriting the absolute paths a moved Project's own files record, by prefix only: a path under
 * the old folder is given the same place under the new one, and nothing else is touched — a
 * user's path outside the data root stays exactly as written.
 *
 * The files are the ones that name a Workspace or a folder of the Project: `.project_config.toml`
 * (`[default_chat] workspace`), each organization's `org_config.toml`, `desks.toml`,
 * `org_chart.yaml` and calendar files, and each Agent's schedule files. They are rewritten as
 * text, so comments and layout survive: a path is replaced where it stands, as a TOML or YAML
 * string spells it (Windows backslashes doubled inside a double-quoted string, as written
 * elsewhere), and only where the prefix ends at a separator or at the end of the value, so
 * `<root>/acme` never matches inside `<root>/acme2`.
 *
 * Traces are never rewritten here or anywhere: they are immutable, and the links left at the old
 * places (link.ts) keep every path they record reachable.
 *
 * Compatibility owner: core's `state/layout-migration/`, removed with the migration at 1.0.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import type { PathMove } from "./journal.js";

/** Whether the character after a matched prefix ends it: a separator, the end of the value, or the text. */
function endsPrefix(next: string | undefined): boolean {
  return next === undefined || /[/\\"'\s,\]}]/.test(next);
}

/** Whether the character before a match leaves it the start of a value, not the middle of a longer path. */
function startsValue(prev: string | undefined): boolean {
  return prev === undefined || !/[A-Za-z0-9_.~/\\-]/.test(prev);
}

/** `value` moved by the first move whose `from` it lies under, or null when none applies. */
export function movedPath(value: string, moves: readonly PathMove[]): string | null {
  for (const { from, to } of moves) {
    if (process.platform === "win32" && path.win32.isAbsolute(value)) {
      const relative = path.win32.relative(from, value);
      if (relative === "") return to;
      if (relative !== ".." && !relative.startsWith("..\\") && !path.win32.isAbsolute(relative)) {
        return path.win32.join(to, relative);
      }
      continue;
    }
    if (value === from) return to;
    if (value.startsWith(from) && (value[from.length] === "/" || value[from.length] === "\\")) {
      return to + value.slice(from.length);
    }
  }
  return null;
}

/** `text` with every path under a move's `from` given its place under `to`, as each spelling has it. */
export function rewriteTextPaths(text: string, moves: readonly PathMove[]): string {
  let out = text;
  for (const { from, to } of moves) {
    // As written, and as a double-quoted TOML or YAML string spells a backslash (identical on POSIX).
    const spellings = new Map([
      [from, to],
      [from.replaceAll("\\", "\\\\"), to.replaceAll("\\", "\\\\")],
    ]);
    for (const [old, next] of spellings) {
      let at = out.indexOf(old);
      while (at !== -1) {
        if (startsValue(out[at - 1]) && endsPrefix(out[at + old.length])) {
          out = out.slice(0, at) + next + out.slice(at + old.length);
          at = out.indexOf(old, at + next.length);
        } else {
          at = out.indexOf(old, at + old.length);
        }
      }
    }
  }
  return out;
}

/**
 * Rewrites `file` in place when it records a moved path: written beside it and renamed over it,
 * with its own mode (`.project_config.toml` is 0600). Answers whether anything changed.
 */
export async function rewriteFilePaths(file: string, moves: readonly PathMove[]): Promise<boolean> {
  let text: string;
  let mode: number;
  try {
    [text, mode] = await Promise.all([
      fs.readFile(file, "utf8"),
      fs.stat(file).then((s) => s.mode & 0o777),
    ]);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  const next = rewriteTextPaths(text, moves);
  if (next === text) return false;
  const tmp = `${file}.${process.pid}.layout.tmp`;
  await fs.writeFile(tmp, next, { mode });
  await fs.rename(tmp, file);
  return true;
}

async function childDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

async function filesIn(dir: string, ext: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(ext))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/** The files of the Project at `projectDir` that may record an absolute path of it. */
export async function projectPathFiles(projectDir: string): Promise<string[]> {
  const files = [path.join(projectDir, ".project_config.toml")];
  for (const org of await childDirs(path.join(projectDir, "organizations"))) {
    files.push(
      path.join(org, "org_config.toml"),
      path.join(org, "desks.toml"),
      path.join(org, "org_chart.yaml"),
    );
    for (const agent of await childDirs(path.join(org, "calendar"))) {
      files.push(...(await filesIn(agent, ".toml")));
    }
  }
  for (const agent of await childDirs(path.join(projectDir, "agents"))) {
    files.push(...(await filesIn(path.join(agent, "agent_state", "schedule"), ".toml")));
  }
  return files;
}

/** Every string a parsed document holds under a `workspace` key, at any depth. */
function workspaceValues(doc: unknown, into: string[]): void {
  if (Array.isArray(doc)) {
    for (const item of doc) workspaceValues(item, into);
    return;
  }
  if (doc === null || typeof doc !== "object") return;
  for (const [key, value] of Object.entries(doc)) {
    if (key === "workspace" && typeof value === "string" && path.isAbsolute(value)) {
      into.push(value);
    } else {
      workspaceValues(value, into);
    }
  }
}

/**
 * The absolute Workspaces the files record (`workspace` values in the TOML and YAML), so a moved
 * Workspace's Memory can be found under its old key. A file that does not parse names none.
 */
export async function recordedWorkspaces(files: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    try {
      workspaceValues(file.endsWith(".yaml") ? parseYaml(text) : parseToml(text), found);
    } catch {
      // Not parseable: it is rewritten as text all the same, and names no Workspace here.
    }
  }
  return found;
}
