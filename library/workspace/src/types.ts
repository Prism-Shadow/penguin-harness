/**
 * The workspace domain's API vocabulary: the Files panel's list/search/write/move/create/stat
 * shapes and the file-content read the preview and download serve. Moved from the server's
 * api/types.ts and workspace-files-service.ts so the contract lives beside its implementation
 * (services+http+cli restack S4). One package, no server dependencies — packages/server
 * imports these; nothing here imports the server.
 */

/** Workspace file entry (Files tab). */
export interface WorkspaceFileEntry {
  name: string;
  kind: "dir" | "file";
  sizeBytes: number;
  mtime: string;
}

export interface WorkspaceFilesResponse {
  /** Requested relative path ("" = Workspace root). */
  path: string;
  entries: WorkspaceFileEntry[];
}

/**
 * Write one Workspace file whole (the Upload button, a drop, and the Files panel's editor). A
 * write answers 204 with the written file's version in `ETag` — the marker the next conditional
 * write of the same file carries, so an editor can keep editing after a save.
 */
export interface FilesWriteRequest {
  /** The entire file, base64-encoded (≤14MB decoded). */
  dataBase64: string;
  /**
   * Write precondition: the version marker the caller read off this file's `ETag` on
   * `GET files/content`. The server compares it against the file's state immediately
   * before writing and answers 409 `file_changed` — having written nothing — when they
   * differ, which is what stops the editor's save from quietly dropping what the Agent
   * wrote during the turn. Omitted by a caller that read no version (an upload creates or
   * replaces unconditionally); that absence, not a sentinel value, is what says there was
   * no prior version to match.
   */
  ifVersion?: string;
}

/** Move or rename one Workspace file or folder (the Files panel's context menu). */
export interface FilesMoveRequest {
  /** Source path, relative to the Workspace root. */
  from: string;
  /** Destination path, relative to the Workspace root. Its parent directory is created when missing. */
  to: string;
  /**
   * Move precondition, read exactly like {@link FilesWriteRequest.ifVersion}: the marker the
   * caller got from this file's `ETag` on `GET files/content`, which the file must still
   * carry. It differs on only one point — the marker guards the **source**. The destination
   * has none, because the caller never read it, which is why an occupied destination is
   * refused with 409 `target_exists` rather than overwritten.
   *
   * A directory `from` takes none, and one sent with it is a 400: a directory carries no
   * single version marker, so no precondition can be stated for it. A folder moves whole and
   * unconditionally — nothing is lost that way, since whatever the Agent wrote into it meanwhile
   * moves with it — and is refused only when the destination is occupied or lies inside it.
   */
  ifVersion?: string;
}

/**
 * Create one empty text file or one folder in a Workspace (the Files panel's New menu). Missing
 * parent directories are created as a write creates them. Anything already at `path` — a file,
 * a folder or a link — is refused with 409 `target_exists` and nothing is written.
 */
export interface FilesCreateRequest {
  /** The new entry's path, relative to the Workspace root. */
  path: string;
  kind: "file" | "dir";
}

/**
 * One Workspace search match. `kind`, `sizeBytes` and `mtime` are named and typed exactly as
 * {@link WorkspaceFileEntry} names them: a hit is drawn by the same row renderer as a tree
 * entry, and it can only render identically if it carries the same fields.
 */
export interface WorkspaceSearchHit {
  /** Workspace-relative, "/"-separated, with no leading "./" (a tree entry's `name` is only its last segment). */
  path: string;
  kind: "dir" | "file";
  sizeBytes: number;
  mtime: string;
}

export interface WorkspaceSearchResponse {
  /** Shallowest first, then directories before files, then by name — the order the breadth-first walk produced. */
  hits: WorkspaceSearchHit[];
  /**
   * A cap stopped the walk (200 hits, or 20000 directory entries visited), so this is a
   * partial list. Breadth-first is what makes that degrade well: the hits that survive
   * truncation are the shallowest ones, not the ones that happened to be enumerated first.
   */
  truncated: boolean;
}

/** Batch file existence check (message file cards only list files that actually exist). */
export interface FilesStatRequest {
  /** Paths relative to the Workspace root (≤100 items, each ≤512 characters). */
  paths: string[];
}

export interface FilesStatResponse {
  /** Confirmed existing paths (regular files within bounds), preserving request order and deduplicated; out-of-bounds and resolution failures count as non-existent. */
  existing: string[];
}

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
  /** The file's version at the moment it was read — the service module's `fileVersion` computes it. */
  version: string;
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
