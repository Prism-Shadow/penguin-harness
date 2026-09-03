/**
 * Workspace file browsing: list directory / read file (preview & download) / write file
 * (upload) / move, delete and search. Security: a relative path, once resolved, must stay
 * inside the Workspace — a logical prefix check plus a realpath check against the nearest
 * existing ancestor (guards against `..` and symlink escapes).
 */
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { constants as fsc } from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import type {
  WorkspaceFileEntry,
  WorkspaceFilesResponse,
  WorkspaceSearchHit,
  WorkspaceSearchResponse,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import { Component } from "@prismshadow/penguin-core/kernel";

/** Per-file read cap (a safety limit since preview/download reads the whole file into memory). */
const MAX_READ_BYTES = 50 * 1024 * 1024;
/** Upload cap (stays within the 20MB request body limit even after base64 encoding). */
export const MAX_UPLOAD_BYTES = 14 * 1024 * 1024;

/**
 * Search caps. Both bound the work, not the relevance: the walk stops at whichever comes
 * first and the response carries `truncated`, so a caller can tell "these are all the
 * matches" from "these are the first matches".
 */
export const SEARCH_MAX_HITS = 200;
export const SEARCH_MAX_ENTRIES = 20000;
/** Longest accepted query: past this it is not a name any entry could carry, so refuse rather than walk the Workspace for it. */
export const SEARCH_MAX_QUERY_LEN = 100;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

export interface WorkspaceFileContent {
  data: Buffer;
  fileName: string;
  contentType: string;
  /**
   * Which kind of scriptable document this is, or false. Both kinds would execute scripts if
   * a browser rendered them as a same-origin document, but they need different inline
   * handling: `"html"` falls back to plain text, while `"svg"` keeps its real type so an
   * `<img>` can render it (an image never runs the SVG's scripts) and is served with a
   * sandbox CSP so a direct navigation to it stays inert. See the file-content routes.
   */
  scriptable: "html" | "svg" | false;
  /** True when a bounded preview returned only the beginning of the file. */
  truncated?: boolean;
  /** The file's version at the moment it was read — see {@link fileVersion}. */
  version: string;
}

/**
 * A file's version marker: the weak size+mtime validator the static asset route already
 * mints (see app.ts) — the classic disk-file shape, and far cheaper than hashing every
 * read. Opaque to clients: they get it from a read and hand it straight back on a write.
 */
function fileVersion(stat: { size: number; mtimeMs: number }): string {
  return `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`;
}

/**
 * A write precondition failed: the file is not the one the caller read. 409 rather than
 * HTTP's 412 — the marker travels in the request body, not as `If-Match`, so this is the
 * app's own conflict and rides the same route error path as the other 409s.
 */
function fileChanged(): HttpError {
  return new HttpError(
    409,
    "file_changed",
    "File changed on disk since it was read; nothing was written.",
  );
}

/**
 * A move's destination is occupied. Unlike the source, the destination has no precondition —
 * the caller never read it, so there is no marker it could have carried — which makes an
 * overwrite here a silent destruction of a file nobody looked at. Refuse instead.
 */
function targetExists(): HttpError {
  return new HttpError(
    409,
    "target_exists",
    "Something already exists at the destination; nothing was moved.",
  );
}

export interface WorkspaceFileReadOptions {
  /** Return at most this many bytes. Used for bounded text previews. */
  maxBytes?: number;
}

/** One existing file from a batch existence check, with the time it was last written. */
export interface WorkspaceFileStat {
  /** The path as it was asked for, not its canonical form. */
  rel: string;
  mtimeMs: number;
}

@Component()
export class WorkspaceFilesService {
  /** Canonical path (realpath) of the Workspace root; 404 if it doesn't exist. */
  private async realBase(workspace: string): Promise<string> {
    try {
      return await fs.realpath(path.resolve(workspace));
    } catch {
      throw new HttpError(404, "workspace_missing", "This Session's Workspace no longer exists.");
    }
  }

  /**
   * Lexical containment check: whether target is inside base (including equal to
   * base). Uses path.relative rather than prefix concatenation, so it works when
   * base is the filesystem root ("/" concatenated with sep would produce a "//"
   * prefix that no subpath could ever match); only a full ".." segment is
   * compared, so a legitimate name like "..foo" isn't mistakenly rejected.
   */
  private isInside(target: string, base: string): boolean {
    const rel = path.relative(base, target);
    return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  }

  /** Lexical prefix check (a relative path, once resolved, must still be inside the Workspace); returns the absolute target path. */
  private lexicalTarget(base: string, rel: string): string {
    if (rel.includes("\0")) throw badRequest("path is invalid.");
    const target = path.resolve(base, rel === "" ? "." : rel);
    if (!this.isInside(target, base)) {
      throw badRequest("path must be inside the Workspace.");
    }
    return target;
  }

  private assertInside(real: string, realBase: string): void {
    if (!this.isInside(real, realBase)) {
      throw badRequest("path must be inside the Workspace.");
    }
  }

  /**
   * Read-path resolution: realpath the entire path (following all symlinks to get
   * a link-free canonical path), then check containment and **perform IO on the
   * canonical path** — since the canonical path contains no symlink segments at
   * all, this eliminates check-then-use TOCTOU escapes (an out-of-bounds symlink
   * is already resolved and rejected at the realpath step).
   */
  private async resolveRead(workspace: string, rel: string): Promise<string> {
    const realBase = await this.realBase(workspace);
    const target = this.lexicalTarget(path.resolve(workspace), rel);
    let canonical: string;
    try {
      canonical = await fs.realpath(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new HttpError(404, "path_not_found", "File does not exist.");
      }
      throw err;
    }
    this.assertInside(canonical, realBase);
    return canonical;
  }

  /**
   * Write-path resolution: realpaths the parent directory (whose canonical path
   * has no symlink segments) and checks containment, then appends the final
   * segment as the file name. When the parent directory is missing, it is safely
   * created (uploading a folder needs to preserve directory structure): first the
   * nearest **existing** ancestor is found and its canonical path checked against
   * the Workspace — this exposes it if a middle segment was preset as a symlink
   * pointing outside; the missing segments are then created recursively beneath it
   * (a brand-new directory can never be a symlink), followed by a second realpath
   * check after creation. The actual write opens with O_NOFOLLOW (refusing to
   * follow a symlink at the final segment), blocking the sandbox-escape pattern of
   * "Agent presets a symlink -> an upload is used as leverage to overwrite a file
   * outside the sandbox". Returns the canonical parent directory + file name.
   */
  private async resolveWriteParent(
    workspace: string,
    rel: string,
  ): Promise<{ dir: string; name: string }> {
    const realBase = await this.realBase(workspace);
    const target = this.lexicalTarget(path.resolve(workspace), rel);
    const name = path.basename(target);
    if (name === "" || name === "." || name === "..") throw badRequest("path must be a file path.");
    const parent = path.dirname(target);
    let canonicalParent: string;
    try {
      canonicalParent = await fs.realpath(parent);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      let probe = parent;
      while (true) {
        try {
          this.assertInside(await fs.realpath(probe), realBase);
          break;
        } catch (probeErr) {
          if ((probeErr as NodeJS.ErrnoException).code !== "ENOENT") throw probeErr;
          const up = path.dirname(probe);
          if (up === probe) throw badRequest("path is invalid.");
          probe = up;
        }
      }
      await fs.mkdir(parent, { recursive: true });
      canonicalParent = await fs.realpath(parent);
    }
    this.assertInside(canonicalParent, realBase);
    return { dir: canonicalParent, name };
  }

  /**
   * Source resolution for an operation that mutates the entry ITSELF (move, delete) rather
   * than its contents: the canonical parent is realpathed and checked — never created, since
   * an operation on a file that must already exist has no business making directories — and
   * the final segment is appended by name so the caller can open it with O_NOFOLLOW.
   *
   * Resolving the whole path the way {@link resolveRead} does would be wrong here: realpath
   * follows a final-segment symlink, so the version marker would describe the link's target
   * while the rename or unlink acted on the link. Returns null when the parent directory is
   * itself missing — the file is gone, and the caller decides whether that is a 404 or a 409.
   */
  private async resolveMutableEntry(
    workspace: string,
    rel: string,
  ): Promise<{ dir: string; name: string } | null> {
    const realBase = await this.realBase(workspace);
    const target = this.lexicalTarget(path.resolve(workspace), rel);
    const name = path.basename(target);
    if (name === "" || name === "." || name === "..") throw badRequest("path must be a file path.");
    let canonicalParent: string;
    try {
      canonicalParent = await fs.realpath(path.dirname(target));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    this.assertInside(canonicalParent, realBase);
    return { dir: canonicalParent, name };
  }

  /**
   * The file an operation named is not there. Without a precondition that is a plain 404;
   * with one it is the same conflict a stale marker raises — a caller that passed a marker
   * read the file and needs to hear that it moved on, which is the rule {@link write} already
   * follows when a conditional write finds the file deleted.
   */
  private vanished(conditional: boolean): HttpError {
    return conditional
      ? fileChanged()
      : new HttpError(404, "path_not_found", "File does not exist.");
  }

  /**
   * Windows has no O_NOFOLLOW (the `?? 0` at every open erases it), so the atomic ELOOP guard
   * never fires there — refuse a final-segment symlink via lstat instead. Best effort (a link
   * created between this check and the open wins the race), but it closes the practical
   * "Agent presets a symlink -> the operation is used as leverage to reach a file outside the
   * sandbox" escape; POSIX keeps the atomic open-time guarantee.
   */
  private async assertNotSymlink(file: string): Promise<void> {
    if (process.platform !== "win32") return;
    const st = await fs.lstat(file).catch(() => null);
    if (st?.isSymbolicLink()) throw badRequest("path must not be a symlink.");
  }

  /**
   * The two things a move and a delete both demand of their subject: that it is a regular
   * file, and that it still carries the caller's version marker. Both are read off an **open
   * handle** — a handle names an inode, so what was inspected is the file the caller is about
   * to move or remove — and the open uses O_NOFOLLOW, refusing a symlink at the final segment
   * so a preset link cannot be used as leverage to rename or unlink a file outside the
   * Workspace.
   *
   * The handle is closed before the operation runs. Holding it across the call would buy no
   * atomicity — neither rename nor unlink has an fd-addressed form, and Node exposes none —
   * so the check-then-act window is inherent here in a way it is not for {@link write}, which
   * truncates the handle it checked. What the window cannot produce is an escape: rename and
   * unlink never follow a final-segment symlink either, so a path swapped underneath acts on
   * the link rather than on whatever it points at.
   */
  private async assertFileAndVersion(file: string, ifVersion: string | undefined): Promise<void> {
    await this.assertNotSymlink(file);
    let handle: FileHandle;
    try {
      handle = await fs.open(file, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ELOOP") throw badRequest("path must not be a symlink.");
      // Opening a directory read-only succeeds on POSIX and fails with EISDIR on Windows;
      // both land on the same refusal (the POSIX one below, on the handle's stat).
      if (code === "EISDIR") throw badRequest("path is a directory.");
      if (code === "ENOENT") throw this.vanished(ifVersion !== undefined);
      throw err;
    }
    try {
      const stat = await handle.stat();
      if (stat.isDirectory()) throw badRequest("path is a directory.");
      if (ifVersion !== undefined && fileVersion(stat) !== ifVersion) throw fileChanged();
    } finally {
      await handle.close();
    }
  }

  /**
   * Batch existence check (a message's file card lists only files that actually
   * exist): each item goes through the same containment resolution as reading
   * (resolveRead); out-of-bounds, resolution failure, missing Workspace, or an
   * irregular file are all treated as non-existent — the card scenario only asks
   * "can this be opened", and throwing a 4xx would only add frontend branches while
   * leaking containment details. Returns the deduplicated existing items in input order.
   */
  async statExisting(workspace: string, rels: string[]): Promise<string[]> {
    return (await this.statExistingWithMtime(workspace, rels)).map((f) => f.rel);
  }

  /**
   * The same check, with each file's modification time — for the caller that has to tell a
   * file this run wrote from one that was already sitting in the Workspace (the messaging
   * bridge sends only the former). Statting is what the check already does, so the time
   * costs nothing extra.
   */
  async statExistingWithMtime(workspace: string, rels: string[]): Promise<WorkspaceFileStat[]> {
    const unique = [...new Set(rels)];
    const stats = await Promise.all(
      unique.map(async (rel): Promise<WorkspaceFileStat | null> => {
        try {
          const stat = await fs.stat(await this.resolveRead(workspace, rel));
          return stat.isFile() ? { rel, mtimeMs: stat.mtimeMs } : null;
        } catch {
          return null;
        }
      }),
    );
    return stats.filter((s): s is WorkspaceFileStat => s !== null);
  }

  /**
   * List a directory: dirs come first, each group sorted by name. Entries whose
   * canonical target leaves the Workspace are omitted, so listing cannot expose
   * metadata for an out-of-bounds symlink.
   */
  async list(workspace: string, rel: string): Promise<WorkspaceFilesResponse> {
    const dir = await this.resolveRead(workspace, rel);
    const realBase = await this.realBase(workspace);
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new HttpError(404, "path_not_found", "Directory does not exist.");
      }
      if ((err as NodeJS.ErrnoException).code === "ENOTDIR") {
        throw badRequest("path is not a directory.");
      }
      throw err;
    }
    const listed = await Promise.all(
      dirents.map(async (d): Promise<WorkspaceFileEntry | null> => {
        try {
          const canonical = await fs.realpath(path.join(dir, d.name));
          this.assertInside(canonical, realBase);
          const stat = await fs.stat(canonical);
          return {
            name: d.name,
            kind: stat.isDirectory() ? "dir" : "file",
            sizeBytes: stat.size,
            mtime: stat.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      }),
    );
    const entries = listed.filter((entry): entry is WorkspaceFileEntry => entry !== null);
    entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
    );
    return { path: rel, entries };
  }

  /**
   * Read a file (preview/download): IO on the canonical path (resolveRead has already
   * eliminated symlink escapes).
   *
   * The stat below runs **before** the bytes are read, and that order is load-bearing now
   * that it also mints the version marker: a rewrite landing in between tags fresh bytes
   * with the older marker, so the worst case is one needless conflict on the next write.
   * Read-then-stat would fail the other way — old bytes carrying the new marker, which is
   * exactly the write the precondition exists to refuse.
   */
  async read(
    workspace: string,
    rel: string,
    options?: WorkspaceFileReadOptions,
  ): Promise<WorkspaceFileContent> {
    const file = await this.resolveRead(workspace, rel);
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      throw new HttpError(404, "path_not_found", "File does not exist.");
    }
    if (stat.isDirectory()) throw badRequest("path is a directory.");
    const maxBytes = options?.maxBytes;
    if (
      maxBytes !== undefined &&
      (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_READ_BYTES)
    ) {
      throw badRequest("maxBytes must be a positive integer within the read limit.");
    }
    if (maxBytes === undefined && stat.size > MAX_READ_BYTES) {
      throw new HttpError(413, "file_too_large", "File exceeds the 50MB read limit.");
    }
    let data: Buffer;
    let truncated = false;
    if (maxBytes !== undefined && stat.size > maxBytes) {
      const handle = await fs.open(file, "r");
      try {
        const buffer = Buffer.alloc(maxBytes);
        const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
        data = buffer.subarray(0, bytesRead);
        truncated = true;
      } finally {
        await handle.close();
      }
    } else {
      data = await fs.readFile(file);
    }
    const ext = path.extname(file).toLowerCase();
    return {
      data,
      fileName: path.basename(file),
      contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
      scriptable: ext === ".html" || ext === ".htm" ? "html" : ext === ".svg" ? "svg" : false,
      ...(truncated ? { truncated: true } : {}),
      version: fileVersion(stat),
    };
  }

  /**
   * Write a file (upload, overwriting a same-named one). If the parent directory
   * is missing, it's automatically created under sandbox checks (preserving
   * directory structure for folder uploads); the final segment is opened with
   * O_NOFOLLOW, refusing to follow a symlink to write outside the Workspace
   * (together with resolveWriteParent's canonical-parent check, this blocks
   * sandbox escapes).
   *
   * `ifVersion` is the write precondition: the marker the caller got from its read, which
   * the file must still carry. It is compared on the **open handle** — a handle names an
   * inode, so what is stat'd is exactly what is about to be truncated, with no window in
   * between. A caller that passes none read no version and gets the unconditional
   * create-or-overwrite an upload wants: the field's absence, not some sentinel value, is
   * what separates "first write of a file that isn't there" from "the file I read has
   * changed". With a marker the file must already exist, so O_CREAT is left out — a
   * missing file is a change like any other (ENOENT → the same 409), and a refused write
   * must not leave an empty file behind.
   */
  async write(workspace: string, rel: string, data: Buffer, ifVersion?: string): Promise<void> {
    if (rel === "" || rel.endsWith("/")) throw badRequest("path must be a file path.");
    if (data.length > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, "file_too_large", "Uploaded file exceeds the 14MB limit.");
    }
    const { dir, name } = await this.resolveWriteParent(workspace, rel);
    const file = path.join(dir, name);
    await this.assertNotSymlink(file);
    // O_NOFOLLOW: open reports ELOOP if the final segment is a symlink, refusing to use it as leverage to overwrite a file outside the sandbox.
    const conditional = ifVersion !== undefined;
    const flags =
      fsc.O_WRONLY | (fsc.O_NOFOLLOW ?? 0) | (conditional ? 0 : fsc.O_CREAT | fsc.O_TRUNC);
    let handle;
    try {
      handle = await fs.open(file, flags, 0o644);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ELOOP") throw badRequest("path must not be a symlink.");
      if (code === "ENOENT") {
        if (conditional) throw fileChanged();
        throw new HttpError(404, "path_not_found", "Parent directory does not exist.");
      }
      if (code === "EISDIR") throw badRequest("path is a directory.");
      throw err;
    }
    try {
      if (conditional) {
        if (fileVersion(await handle.stat()) !== ifVersion) throw fileChanged();
        // O_TRUNC was withheld above so the check could run first; do it now, on the same
        // handle, immediately before the bytes go down.
        await handle.truncate(0);
      }
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
  }

  /**
   * Move or rename one Workspace file.
   *
   * **Files only** — a directory `from` is a 400. A directory has no single version marker, so
   * the precondition that protects this operation cannot be expressed for one, and moving a
   * whole tree with no precondition at all is worse than refusing to move it.
   *
   * The source is resolved as a mutable entry (canonical parent, O_NOFOLLOW on the final
   * segment, version marker read off the open handle); the destination is resolved as a write,
   * so its parent is created when missing under the same checks an upload runs. An occupied
   * destination is a 409 rather than an overwrite — see {@link targetExists} — and a move onto
   * the file's own path is a 400 rather than a success that did nothing.
   */
  async move(workspace: string, from: string, to: string, ifVersion?: string): Promise<void> {
    if (from === "" || from.endsWith("/")) throw badRequest("from must be a file path.");
    if (to === "" || to.endsWith("/")) throw badRequest("to must be a file path.");
    const conditional = ifVersion !== undefined;
    const source = await this.resolveMutableEntry(workspace, from);
    if (source === null) throw this.vanished(conditional);
    const file = path.join(source.dir, source.name);
    await this.assertFileAndVersion(file, ifVersion);

    const { dir, name } = await this.resolveWriteParent(workspace, to);
    const dest = path.join(dir, name);
    // Both parents are canonical, so this compares the two real paths rather than the two
    // spellings the caller happened to send.
    if (dest === file) throw badRequest("to must differ from from.");
    // The destination is never overwritten, and "never" has to hold against the Agent writing
    // that exact path while this runs — the whole point of the precondition on the source.
    // `link` is the primitive that says so in the kernel: it fails EEXIST rather than replacing,
    // and it keeps the inode, so the file that lands is the file that was checked. `rename`
    // would replace silently, and an lstat in front of it only narrows the window instead of
    // closing it.
    try {
      await fs.link(file, dest);
      await fs.unlink(file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") throw targetExists();
      if (code === "EXDEV") {
        // The two canonical parents are on different filesystems (a bind-mounted subdirectory,
        // say), which neither link nor rename can cross. Copy, then drop the original.
        // COPYFILE_EXCL refuses an existing destination in the kernel, so this path keeps the
        // same guarantee.
        try {
          await fs.copyFile(file, dest, fsc.COPYFILE_EXCL);
        } catch (copyErr) {
          if ((copyErr as NodeJS.ErrnoException).code === "EEXIST") throw targetExists();
          throw copyErr;
        }
        await fs.unlink(file);
        return;
      }
      // Filesystems that have no hard links at all (FAT, some network and container mounts,
      // and Windows outside NTFS) report one of these. There is nothing atomic left to reach
      // for, so the check-then-act window comes back — narrowed to a single lstat, and only on
      // the mounts that cannot do better. lstat, not stat: a dangling symlink at the
      // destination is still something rename would replace.
      if (code !== "EPERM" && code !== "ENOSYS" && code !== "EMLINK" && code !== "EOPNOTSUPP") {
        throw err;
      }
    }
    const occupied = await fs.lstat(dest).then(
      () => true,
      () => false,
    );
    if (occupied) throw targetExists();
    await fs.rename(file, dest);
  }

  /**
   * Delete one Workspace file. Files only, for the same reason {@link move} is: a directory
   * carries no version marker, so nothing can protect a recursive delete from removing work
   * the Agent did after the panel last looked.
   *
   * `ifVersion` is optional in the wire shape — the service will delete unconditionally
   * without it — but the Files panel always sends the marker its read returned, so a file the
   * Agent rewrote under the user's cursor is a 409 rather than a lost file.
   */
  async remove(workspace: string, rel: string, ifVersion?: string): Promise<void> {
    if (rel === "" || rel.endsWith("/")) throw badRequest("path must be a file path.");
    const conditional = ifVersion !== undefined;
    const entry = await this.resolveMutableEntry(workspace, rel);
    if (entry === null) throw this.vanished(conditional);
    const file = path.join(entry.dir, entry.name);
    await this.assertFileAndVersion(file, ifVersion);
    try {
      await fs.unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw this.vanished(conditional);
      throw err;
    }
  }

  /**
   * Search the whole Workspace: case-insensitive substring match on an entry's **name**, not
   * on its path, so typing a directory the file happens to sit under does not turn every file
   * under it into a hit.
   *
   * **Breadth-first from the Workspace root**, and that is load-bearing rather than an
   * implementation detail: shallow matches are found first, so hitting a cap degrades the
   * result into "the most relevant hits" instead of "whatever happened to be in the first
   * directory the walk descended into". The sort keeps the same order the walk produced.
   *
   * Entries whose canonical path leaves the Workspace are skipped exactly as {@link list}
   * skips them, and every directory is entered at most once by canonical path, so a symlink
   * pointing back up cannot spin the walk in a cycle.
   */
  async search(workspace: string, q: string): Promise<WorkspaceSearchResponse> {
    if (q.length > SEARCH_MAX_QUERY_LEN) {
      throw badRequest(`q must be at most ${SEARCH_MAX_QUERY_LEN} characters.`);
    }
    const needle = q.trim().toLowerCase();
    if (needle === "") throw badRequest("q must not be empty.");
    const realBase = await this.realBase(workspace);

    const hits: Array<WorkspaceSearchHit & { depth: number; name: string }> = [];
    let truncated = false;
    let visited = 0;
    const seenDirs = new Set<string>([realBase]);
    let level: Array<{ dir: string; rel: string; depth: number }> = [
      { dir: realBase, rel: "", depth: 0 },
    ];
    walk: while (level.length > 0) {
      const next: typeof level = [];
      for (const node of level) {
        let dirents;
        try {
          dirents = await fs.readdir(node.dir, { withFileTypes: true });
        } catch {
          continue; // Unreadable directory: skipped, the way `list` skips an entry it cannot stat.
        }
        for (const d of dirents) {
          if (visited >= SEARCH_MAX_ENTRIES) {
            truncated = true;
            break walk;
          }
          visited += 1;
          const rel = node.rel === "" ? d.name : `${node.rel}/${d.name}`;
          let canonical = path.join(node.dir, d.name);
          let isDir = d.isDirectory();
          // A hit reports the size and mtime of the entry itself, the way `list` does, so a
          // search result renders as the same row a tree entry does. Only a link and a match
          // are statted: `kind` comes from the dirent for everything else, which keeps the
          // per-entry cost of a 20000-entry walk at one readdir slot rather than one syscall.
          let stat: Stats | null = null;
          if (d.isSymbolicLink()) {
            // Only a link needs the realpath round trip: node.dir is canonical, so any other
            // child of it is canonical already and cannot name anything outside the Workspace.
            try {
              canonical = await fs.realpath(canonical);
              this.assertInside(canonical, realBase);
              stat = await fs.stat(canonical);
              isDir = stat.isDirectory();
            } catch {
              continue; // Out of bounds or broken: omitted, the same way `list` omits it.
            }
          }
          const kind = isDir ? "dir" : "file";
          if (d.name.toLowerCase().includes(needle)) {
            if (hits.length >= SEARCH_MAX_HITS) {
              truncated = true;
              break walk;
            }
            const found = stat ?? (await fs.stat(canonical).catch(() => null));
            // Gone between the readdir and the stat: no row can be drawn for it, so it is
            // omitted rather than reported with invented figures. A directory that is still
            // there is descended into below regardless.
            if (found) {
              hits.push({
                path: rel,
                kind,
                sizeBytes: found.size,
                mtime: found.mtime.toISOString(),
                depth: node.depth,
                name: d.name,
              });
            }
          }
          if (isDir && !seenDirs.has(canonical)) {
            seenDirs.add(canonical);
            next.push({ dir: canonical, rel, depth: node.depth + 1 });
          }
        }
      }
      level = next;
    }

    // Shallow-first, then directories, then by name — the order the breadth-first walk
    // produced, made total (the path breaks a tie between same-named entries in two
    // directories) so the same Workspace always answers in the same order.
    hits.sort(
      (a, b) =>
        a.depth - b.depth ||
        (a.kind === b.kind ? 0 : a.kind === "dir" ? -1 : 1) ||
        a.name.localeCompare(b.name) ||
        a.path.localeCompare(b.path),
    );
    return {
      hits: hits.map(({ path: rel, kind, sizeBytes, mtime }) => ({
        path: rel,
        kind,
        sizeBytes,
        mtime,
      })),
      truncated,
    };
  }
}
