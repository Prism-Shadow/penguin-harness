/**
 * The workspace-file reads the benchmark domain's case-material routes need. Structural port:
 * the server's `WorkspaceFiles` mechanism satisfies it; the shapes it names are the workspace
 * domain's, carried here as the exact fields this domain reads.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

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

/** A workspace file's content as the reads return it — the workspace domain's own shape. */
export interface WorkspaceFileContent {
  data: Buffer;
  fileName: string;
  contentType: string;
  /**
   * Which kind of scriptable document this is, or false. Both kinds would execute scripts if
   * a browser rendered them as a same-origin document, but they need different inline
   * handling: `"html"` falls back to plain text, while `"svg"` keeps its real type so an
   * `<img>` can render it (an image never runs the SVG's scripts) and is served with a
   * sandbox CSP so a direct navigation to it stays inert.
   */
  scriptable: "html" | "svg" | false;
  /** True when a bounded preview returned only the beginning of the file. */
  truncated?: boolean;
  /** The file's version at the moment it was read. */
  version: string;
}

export interface WorkspaceFileReadOptions {
  /** Return at most this many bytes. Used for bounded text previews. */
  maxBytes?: number;
}

/**
 * The workspace-file face the case-material routes use. The server's `WorkspaceFiles`
 * mechanism satisfies this structurally.
 */
export abstract class WorkspaceFiles extends Interface<{
  list(workspace: string, rel: string): Promise<WorkspaceFilesResponse>;
  read(
    workspace: string,
    rel: string,
    options?: WorkspaceFileReadOptions,
  ): Promise<WorkspaceFileContent>;
}>() {}
