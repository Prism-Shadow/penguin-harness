/**
 * Workspace file browsing: list directory / read
 * file (preview & download) / write file (upload). Security: a relative path, once
 * resolved, must stay inside the Workspace — a logical prefix check plus a realpath
 * check against the nearest existing ancestor (guards against `..` and symlink escapes).
 */
import fs from "node:fs/promises";
import { constants as fsc } from "node:fs";
import path from "node:path";
import type { WorkspaceFilesResponse } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";

/** Per-file read cap (a safety limit since preview/download reads the whole file into memory). */
const MAX_READ_BYTES = 50 * 1024 * 1024;
/** Upload cap (stays within the 20MB request body limit even after base64 encoding). */
export const MAX_UPLOAD_BYTES = 14 * 1024 * 1024;

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
  /** Types whose same-origin inline rendering would execute scripts (html/svg): inline preview must fall back to plain text. */
  scriptable: boolean;
}

export class WorkspaceFilesService {
  /** Canonical path (realpath) of the Workspace root; 404 if it doesn't exist. */
  private async realBase(workspace: string): Promise<string> {
    try {
      return await fs.realpath(path.resolve(workspace));
    } catch {
      throw new HttpError(404, "workspace_missing", "该 Session 的 Workspace 已不存在。");
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
    if (rel.includes("\0")) throw badRequest("path 非法。");
    const target = path.resolve(base, rel === "" ? "." : rel);
    if (!this.isInside(target, base)) {
      throw badRequest("path 必须位于 Workspace 内。");
    }
    return target;
  }

  private assertInside(real: string, realBase: string): void {
    if (!this.isInside(real, realBase)) {
      throw badRequest("path 必须位于 Workspace 内。");
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
        throw new HttpError(404, "path_not_found", "文件不存在。");
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
    if (name === "" || name === "." || name === "..") throw badRequest("path 必须是文件路径。");
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
          if (up === probe) throw badRequest("path 非法。");
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
   * Batch existence check (a message's file card lists only files that actually
   * exist): each item goes through the same containment resolution as reading
   * (resolveRead); out-of-bounds, resolution failure, missing Workspace, or an
   * irregular file are all treated as non-existent — the card scenario only asks
   * "can this be opened", and throwing a 4xx would only add frontend branches while
   * leaking containment details. Returns the deduplicated existing items in input order.
   */
  async statExisting(workspace: string, rels: string[]): Promise<string[]> {
    const unique = [...new Set(rels)];
    const exists = await Promise.all(
      unique.map(async (rel) => {
        try {
          const stat = await fs.stat(await this.resolveRead(workspace, rel));
          return stat.isFile();
        } catch {
          return false;
        }
      }),
    );
    return unique.filter((_, i) => exists[i]);
  }

  /** List a directory: dirs come first, each group sorted by name; kind follows the symlink target (consistent with read behavior). */
  async list(workspace: string, rel: string): Promise<WorkspaceFilesResponse> {
    const dir = await this.resolveRead(workspace, rel);
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new HttpError(404, "path_not_found", "目录不存在。");
      }
      if ((err as NodeJS.ErrnoException).code === "ENOTDIR") {
        throw badRequest("path 不是目录。");
      }
      throw err;
    }
    const entries = await Promise.all(
      dirents.map(async (d) => {
        let sizeBytes = 0;
        let mtime = "";
        // Dirent doesn't report the target type for a symlink, so stat (following the link) is used to determine dir/file.
        let isDir = d.isDirectory();
        try {
          const stat = await fs.stat(path.join(dir, d.name));
          sizeBytes = stat.size;
          mtime = stat.mtime.toISOString();
          isDir = stat.isDirectory();
        } catch {
          // A dangling symlink or similar: keep the entry, with size/time left at defaults.
        }
        return {
          name: d.name,
          kind: isDir ? ("dir" as const) : ("file" as const),
          sizeBytes,
          mtime,
        };
      }),
    );
    entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
    );
    return { path: rel, entries };
  }

  /** Read a file (preview/download): IO on the canonical path (resolveRead has already eliminated symlink escapes). */
  async read(workspace: string, rel: string): Promise<WorkspaceFileContent> {
    const file = await this.resolveRead(workspace, rel);
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      throw new HttpError(404, "path_not_found", "文件不存在。");
    }
    if (stat.isDirectory()) throw badRequest("path 是目录。");
    if (stat.size > MAX_READ_BYTES) {
      throw new HttpError(413, "file_too_large", "文件超过 50MB 读取上限。");
    }
    const data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    return {
      data,
      fileName: path.basename(file),
      contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
      scriptable: ext === ".html" || ext === ".htm" || ext === ".svg",
    };
  }

  /**
   * Write a file (upload, overwriting a same-named one). If the parent directory
   * is missing, it's automatically created under sandbox checks (preserving
   * directory structure for folder uploads); the final segment is opened with
   * O_NOFOLLOW, refusing to follow a symlink to write outside the Workspace
   * (together with resolveWriteParent's canonical-parent check, this blocks
   * sandbox escapes).
   */
  async write(workspace: string, rel: string, data: Buffer): Promise<void> {
    if (rel === "" || rel.endsWith("/")) throw badRequest("path 必须是文件路径。");
    if (data.length > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, "file_too_large", "上传文件超过 14MB 上限。");
    }
    const { dir, name } = await this.resolveWriteParent(workspace, rel);
    const file = path.join(dir, name);
    // O_NOFOLLOW: open reports ELOOP if the final segment is a symlink, refusing to use it as leverage to overwrite a file outside the sandbox.
    const flags = fsc.O_WRONLY | fsc.O_CREAT | fsc.O_TRUNC | (fsc.O_NOFOLLOW ?? 0);
    let handle;
    try {
      handle = await fs.open(file, flags, 0o644);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ELOOP") throw badRequest("path 不能是符号链接。");
      if (code === "ENOENT") throw new HttpError(404, "path_not_found", "父目录不存在。");
      if (code === "EISDIR") throw badRequest("path 是目录。");
      throw err;
    }
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
  }
}
