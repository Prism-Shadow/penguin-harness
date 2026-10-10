/**
 * Where the Files panel's operations go. The panel is addressed by a Workspace, and a Workspace
 * is reached one of two ways:
 *
 *   - through a Session (`/api/sessions/:id/files…`): the conversation's own Workspace, routed to
 *     the machine the Session lives on by the path rule (lib/session-machines.ts);
 *   - by the directory itself (`/api/projects/:projectId/workspace-files…?workspace=`): the
 *     new-chat draft's chosen folder and a sidebar Workspace group, where no Session exists yet,
 *     sent to the machine that directory is on — a path names a directory only together with it.
 *
 * The two answer the same operations with the same results, except that previews on the
 * separate preview origin are a Session's alone (the origin's tokens name one): a directory's
 * HTML previews in the same-origin sandbox, which is what the panel shows when isolation is off.
 */
import type {
  FilesCreateRequest,
  FilesMoveRequest,
  WorkspaceFilesResponse,
  WorkspaceSearchResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "./endpoints";
import type { WorkspaceDir } from "./endpoints";

/** What the Files panel browses. */
export type FilesScope =
  { kind: "session"; sessionId: string } | ({ kind: "workspace" } & WorkspaceDir);

/**
 * One string per scope, equal for equal scopes: what the panel starts over on when it changes,
 * and what its unsaved drafts are filed under. A directory's machine is part of its identity.
 */
export function filesScopeKey(scope: FilesScope): string {
  return scope.kind === "session"
    ? `session:${scope.sessionId}`
    : `workspace:${scope.machineId ?? ""}\0${scope.workspace}`;
}

/** The panel's operations over one scope. */
export interface FilesApi {
  list(path: string): Promise<WorkspaceFilesResponse>;
  /** A URL an <img>, an <a> or a fetch can use: inline, or as a download. */
  fileUrl(path: string, download?: boolean): string;
  /** "Open in a new tab" for an HTML file. */
  previewUrl(path: string): string;
  /** Whether the separate preview origin can serve this scope at all (a Session only). */
  isolatablePreviews: boolean;
  /** Writes a file whole; resolves to the version written, or null when the server does not say. */
  write(path: string, dataBase64: string, ifVersion?: string): Promise<string | null>;
  create(body: FilesCreateRequest): Promise<void>;
  move(body: FilesMoveRequest): Promise<void>;
  remove(path: string, ifVersion?: string): Promise<void>;
  search(q: string): Promise<WorkspaceSearchResponse>;
  reveal(path: string): Promise<void>;
}

/** The operations for `scope`. */
export function filesApi(scope: FilesScope): FilesApi {
  if (scope.kind === "session") {
    const id = scope.sessionId;
    return {
      list: (path) => api.listWorkspaceFiles(id, path),
      fileUrl: (path, download) => api.workspaceFileUrl(id, path, download),
      previewUrl: (path) => api.workspaceFilePreviewUrl(id, path),
      isolatablePreviews: true,
      write: (path, data, ifVersion) => api.uploadWorkspaceFile(id, path, data, ifVersion),
      create: (body) => api.createWorkspaceEntry(id, body),
      move: (body) => api.moveWorkspaceFile(id, body),
      remove: (path, ifVersion) => api.deleteWorkspaceFile(id, path, ifVersion),
      search: (q) => api.searchWorkspaceFiles(id, q),
      reveal: (path) => api.revealWorkspaceFile(id, path),
    };
  }
  const dir: WorkspaceDir = {
    projectId: scope.projectId,
    workspace: scope.workspace,
    machineId: scope.machineId,
  };
  return {
    list: (path) => api.listWorkspaceDirFiles(dir, path),
    fileUrl: (path, download) => api.workspaceDirFileUrl(dir, path, download),
    previewUrl: (path) => api.workspaceDirPreviewUrl(dir, path),
    isolatablePreviews: false,
    write: (path, data, ifVersion) => api.writeWorkspaceDirFile(dir, path, data, ifVersion),
    create: (body) => api.createWorkspaceDirEntry(dir, body),
    move: (body) => api.moveWorkspaceDirFile(dir, body),
    remove: (path, ifVersion) => api.deleteWorkspaceDirFile(dir, path, ifVersion),
    search: (q) => api.searchWorkspaceDirFiles(dir, q),
    reveal: (path) => api.revealWorkspaceDirFile(dir, path),
  };
}
