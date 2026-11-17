/**
 * `WorkbenchHost`'s files: the folder of files a workbench shares with its Agent.
 *
 *   <agentStateDir>/workbenches/<id>/.files/…
 *
 * `state.json` is one document only the handler writes; this folder holds the files BOTH sides
 * write — the handler through the host, the Agent with its own file tools — so a document the
 * user edits in the workbench's page and asks the Agent to change is one file on disk, and
 * whichever side wrote last is what the other reads next. A dot entry, so it is no part of the
 * workbench's source: writing here loads nothing, enters no version, travels in no archive, and
 * a plugin update or a rollback leaves it where it is. It goes with the workbench when the
 * workbench is removed, as `state.json` does.
 *
 * The Agent can put anything in the folder, so nothing here follows a link: a path whose file,
 * or any directory above it inside the folder, is a symbolic link is refused, and a listing
 * leaves links out. Otherwise the server — which is not confined the way the Agent's commands
 * are — would read and write wherever the Agent pointed it.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { WorkbenchFile } from "../mechanisms/workbenches.js";
import { isSafeRelPath, isTempName, TMP_SUFFIX } from "./store.js";

export const FILES_DIR = ".files";
/** The largest file read or written through the host: the cap on a request body a handler is handed. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Files a listing returns at most; past it the listing throws rather than answer a part. */
export const MAX_FILES = 5000;

export class WorkbenchFileError extends Error {}

/** The folder of files of the workbench whose folder is `dir`. */
export class WorkbenchFiles {
  private readonly root: string;

  constructor(dir: string) {
    this.root = path.join(dir, FILES_DIR);
  }

  /** Where a file is on this machine: what a handler tells the Agent to edit. */
  pathOf(rel?: string): string {
    return rel === undefined ? this.root : path.join(this.root, ...this.segments(rel));
  }

  /** Every regular file below the folder, sorted by path; none when the folder is not there. */
  async list(): Promise<WorkbenchFile[]> {
    const out: WorkbenchFile[] = [];
    const walk = async (abs: string, prefix: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (isTempName(entry.name)) continue;
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(path.join(abs, entry.name), rel);
        } else if (entry.isFile()) {
          // Gone between the listing and the stat: the Agent is rewriting it; the next listing has it.
          const stat = await fs.stat(path.join(abs, entry.name)).catch(() => null);
          if (stat === null) continue;
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
    await fs.mkdir(this.root, { recursive: true });
    await this.plain(rel, "writeFile");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const current = await fs.lstat(file).catch(() => null);
    if (current !== null && !current.isFile()) {
      throw new WorkbenchFileError(`writeFile: ${rel} is not a regular file`);
    }
    const staged = `${file}${TMP_SUFFIX}${randomBytes(6).toString("hex")}`;
    try {
      await fs.writeFile(staged, bytes);
      await fs.rename(staged, file);
    } catch (err) {
      await fs.rm(staged, { force: true }).catch(() => undefined);
      throw err;
    }
    const stat = await fs.stat(file);
    return { path: this.segments(rel).join("/"), size: stat.size, mtimeMs: stat.mtimeMs };
  }

  /** Removes the file; nothing happens when it is not there. */
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
        `${JSON.stringify(rel)} is not a path inside the workbench's files`,
      );
    }
    return rel.split("/");
  }

  /**
   * Whether every directory above `rel` inside the folder is there, refusing one that is a link
   * or a file: false when one is simply missing.
   */
  private async plain(rel: string, call: string): Promise<boolean> {
    const segments = this.segments(rel);
    let at = this.root;
    for (const segment of ["", ...segments.slice(0, -1)]) {
      at = segment === "" ? at : path.join(at, segment);
      const stat = await fs.lstat(at).catch(() => null);
      if (stat === null) return false;
      if (!stat.isDirectory()) {
        throw new WorkbenchFileError(
          `${call}: ${rel} passes through something that is not a directory`,
        );
      }
    }
    return true;
  }
}
