/**
 * `WorkbenchHost`'s files: the data folder a workbench shares with its Agent.
 *
 *   <agentDir>/app/data/<workbenchId>/…
 *
 * `state.json` is one document only the handler writes; this folder holds the files BOTH sides
 * write — the handler through the host, the Agent with its own file tools — so a document the
 * user edits in the workbench's page and asks the Agent to change is one file on disk, and
 * whichever side wrote last is what the other reads next. It sits beside the Agent State, not in
 * it (core's `workbenchDataDir`): writing here loads nothing and enters no version, a snapshot
 * stays small, and a `workspace-write` sandbox binds `<agentDir>/app` writable for the Agent's
 * commands. It travels in the Agent export with the workbench's data and goes when the
 * workbench is removed, as `state.json` does.
 *
 * The Agent can write anything below `<agentDir>/app`, so nothing here follows a link: a path
 * through a link — the file itself, a directory above it in the folder, or `app/`, `app/data/`
 * and the folder itself — is refused, and a listing leaves links out. Otherwise the server,
 * which is not confined the way the Agent's commands are, would read and write wherever the
 * Agent pointed it. `<agentDir>` itself is trusted: no confined command writes it.
 */
import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { WorkbenchFile } from "../mechanisms/workbenches.js";
import { isSafeRelPath, isTempName, TMP_SUFFIX } from "./store.js";

/** The largest file read or written through the host: the cap on a request body a handler is handed. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Files a listing returns at most; past it the listing throws rather than answer a part. */
export const MAX_FILES = 5000;

export class WorkbenchFileError extends Error {}

/**
 * Whether every directory from `base` down through `segments` is there, each a real directory:
 * false when one is simply missing; a link or a file on the way throws. `base` itself is trusted.
 */
export async function realDirs(
  base: string,
  segments: readonly string[],
  call: string,
): Promise<boolean> {
  let at = base;
  for (const segment of segments) {
    at = path.join(at, segment);
    const stat = await fs.lstat(at).catch(() => null);
    if (stat === null) return false;
    if (!stat.isDirectory()) {
      throw new WorkbenchFileError(`${call}: ${at} is a link or a file, not a directory`);
    }
  }
  return true;
}

/**
 * Removes `dir` and everything in it, `dir` lying below the trusted `base`. A link on the way
 * to it throws and nothing is removed; `dir` itself as a link goes as a link, and `rm` removes a
 * link inside without following it.
 */
export async function removeBelow(base: string, dir: string): Promise<void> {
  const parents = path.relative(base, dir).split(path.sep).slice(0, -1);
  if (!(await realDirs(base, parents, "remove"))) return;
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** The data folder of one workbench: `root`, below the trusted `base` (the Agent's directory). */
export class WorkbenchFiles {
  private readonly chain: string[];

  constructor(
    private readonly base: string,
    private readonly root: string,
  ) {
    this.chain = path.relative(base, root).split(path.sep);
  }

  /**
   * Makes the folder when it is missing, one level at a time, each a real directory: what
   * `dataPaths` and `filePath` do before they hand the path out, so the Agent can write there.
   */
  ensure(call: string): void {
    let at = this.base;
    for (const segment of this.chain) {
      at = path.join(at, segment);
      try {
        fsSync.mkdirSync(at);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      if (!fsSync.lstatSync(at).isDirectory()) {
        throw new WorkbenchFileError(`${call}: ${at} is a link or a file, not a directory`);
      }
    }
  }

  /** Where a file is on this machine: what a handler tells the Agent to edit. */
  pathOf(rel?: string): string {
    return rel === undefined ? this.root : path.join(this.root, ...this.segments(rel));
  }

  /** Every regular file below the folder, sorted by path; none when the folder is not there. */
  async list(): Promise<WorkbenchFile[]> {
    if (!(await realDirs(this.base, this.chain, "listFiles"))) return [];
    const out: WorkbenchFile[] = [];
    const walk = async (abs: string, prefix: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      // A Dirent is lstat-based: a link is neither a directory nor a file here, so it is skipped.
      for (const entry of entries) {
        if (isTempName(entry.name)) continue;
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(path.join(abs, entry.name), rel);
        } else if (entry.isFile()) {
          // Gone between the listing and the stat: the Agent is rewriting it; the next listing has it.
          const stat = await fs.lstat(path.join(abs, entry.name)).catch(() => null);
          if (stat === null || !stat.isFile()) continue;
          if (out.length >= MAX_FILES) {
            throw new WorkbenchFileError(`listFiles: more than ${MAX_FILES} files`);
          }
          out.push({ path: rel, size: stat.size, mtimeMs: stat.mtimeMs });
        }
      }
    };
    await walk(this.root, "");
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  /** The file's bytes; null when there is no such file. */
  async read(rel: string): Promise<Uint8Array | null> {
    const file = this.pathOf(rel);
    if (!(await this.plain(rel, "readFile"))) return null;
    const stat = await fs.lstat(file).catch(() => null);
    if (stat === null) return null;
    if (!stat.isFile()) throw new WorkbenchFileError(`readFile: ${rel} is not a regular file`);
    if (stat.size > MAX_FILE_BYTES) {
      throw new WorkbenchFileError(`readFile: ${rel} is larger than ${MAX_FILE_BYTES} bytes`);
    }
    return new Uint8Array(await fs.readFile(file));
  }

  /** Writes the file whole (staged beside it, then renamed in), creating its directories. */
  async write(rel: string, data: Uint8Array | string): Promise<WorkbenchFile> {
    const file = this.pathOf(rel);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    if (!(bytes instanceof Uint8Array)) {
      throw new WorkbenchFileError("writeFile: data is a string or a Uint8Array");
    }
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new WorkbenchFileError(`writeFile: ${rel} is larger than ${MAX_FILE_BYTES} bytes`);
    }
    this.ensure("writeFile");
    let at = this.root;
    for (const segment of this.segments(rel).slice(0, -1)) {
      at = path.join(at, segment);
      await fs.mkdir(at).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "EEXIST") throw err;
      });
      if (!(await fs.lstat(at)).isDirectory()) {
        throw new WorkbenchFileError(
          `writeFile: ${rel} passes through something that is not a directory`,
        );
      }
    }
    const current = await fs.lstat(file).catch(() => null);
    if (current !== null && !current.isFile()) {
      throw new WorkbenchFileError(`writeFile: ${rel} is not a regular file`);
    }
    const staged = `${file}${TMP_SUFFIX}${randomBytes(6).toString("hex")}`;
    try {
      await fs.writeFile(staged, bytes, { flag: "wx" });
      await fs.rename(staged, file);
    } catch (err) {
      await fs.rm(staged, { force: true }).catch(() => undefined);
      throw err;
    }
    const stat = await fs.lstat(file);
    return { path: this.segments(rel).join("/"), size: stat.size, mtimeMs: stat.mtimeMs };
  }

  /** Removes the file; nothing happens when it is not there. A link goes, its target stays. */
  async remove(rel: string): Promise<void> {
    const file = this.pathOf(rel);
    if (!(await this.plain(rel, "removeFile"))) return;
    const stat = await fs.lstat(file).catch(() => null);
    if (stat === null) return;
    if (stat.isDirectory()) throw new WorkbenchFileError(`removeFile: ${rel} is a directory`);
    await fs.rm(file, { force: true });
  }

  private segments(rel: string): string[] {
    if (typeof rel !== "string" || !isSafeRelPath(rel) || rel.split("/").some(isTempName)) {
      throw new WorkbenchFileError(
        `${JSON.stringify(rel)} is not a path inside the workbench's data folder`,
      );
    }
    return rel.split("/");
  }

  /**
   * Whether the folder and every directory above `rel` inside it are there, refusing one that
   * is a link or a file: false when one is simply missing.
   */
  private async plain(rel: string, call: string): Promise<boolean> {
    const parents = this.segments(rel).slice(0, -1);
    return realDirs(this.base, [...this.chain, ...parents], call);
  }
}
