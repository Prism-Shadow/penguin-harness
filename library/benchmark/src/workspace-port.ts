/**
 * The workspace-file reads the benchmark domain's case-material routes need. Structural port:
 * the server's `WorkspaceFiles` mechanism satisfies it; the shapes it names are the workspace
 * domain's, carried here as the exact fields this domain reads.
 */
/** A Workspace file entry (Files tab). Owned by the workspace domain (S4 will home it there). */
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

/** A workspace file's content as the reads return it. */
export interface WorkspaceFileContent {
  /** The file's bytes, as stored. */
  data: Buffer<ArrayBufferLike>;
  /** The `ETag` the stored version answers with; write back on save to fail on a race. */
  etag: string;
  /** When the file last changed (ms epoch). */
  mtime: number;
}

export interface WorkspaceFileReadOptions {
  /** Serve a 304-style short answer when the version still matches this etag. */
  ifVersion?: string;
}

/**
 * The workspace-file face the case-material routes use. The server's `WorkspaceFiles`
 * mechanism satisfies this structurally.
 */
export interface WorkspaceFiles {
  list(workspace: string, rel: string): Promise<WorkspaceFilesResponse>;
  read(
    workspace: string,
    rel: string,
    options?: WorkspaceFileReadOptions,
  ): Promise<WorkspaceFileContent>;
}
