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
  FilesWriteRequest,
  WorkspaceFilesResponse,
  WorkspaceSearchResponse,
} from "@prismshadow/penguin-server/api";
import { apiUrl } from "../lib/server-context";
import { apiFetch, apiFetchWithMeta } from "./client";
import * as api from "./endpoints";

/** What the Files panel browses. */
export type FilesScope =
  | { kind: "session"; sessionId: string }
  | {
      kind: "workspace";
      /** The Project the caller's access is checked against. */
      projectId: string;
      /** The directory's absolute path. */
      workspace: string;
      /** The machine the directory is on; null for this server. */
      machineId: string | null;
    };

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

function sessionFiles(sessionId: string): FilesApi {
  return {
    list: (path) => api.listWorkspaceFiles(sessionId, path),
    fileUrl: (path, download) => api.workspaceFileUrl(sessionId, path, download),
    previewUrl: (path) => api.workspaceFilePreviewUrl(sessionId, path),
    isolatablePreviews: true,
    write: (path, data, ifVersion) => api.uploadWorkspaceFile(sessionId, path, data, ifVersion),
    create: (body) => api.createWorkspaceEntry(sessionId, body),
    move: (body) => api.moveWorkspaceFile(sessionId, body),
    remove: (path, ifVersion) => api.deleteWorkspaceFile(sessionId, path, ifVersion),
    search: (q) => api.searchWorkspaceFiles(sessionId, q),
    reveal: (path) => api.revealWorkspaceFile(sessionId, path),
  };
}

function directoryFiles(projectId: string, workspace: string, machineId: string | null): FilesApi {
  const base = `/api/projects/${encodeURIComponent(projectId)}/workspace-files`;
  const server = machineId;
  /** A browser-followed URL carries the machine's proxy prefix itself: no fetch wrapper sees it. */
  const url = (suffix: string, query: string): string =>
    apiUrl(`${base}${suffix}?workspace=${encodeURIComponent(workspace)}${query}`, machineId);
  return {
    list: (path) => apiFetch<WorkspaceFilesResponse>(base, { query: { workspace, path }, server }),
    fileUrl: (path, download) =>
      url("/content", `&path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`),
    previewUrl: (path) => url("/content", `&path=${encodeURIComponent(path)}&preview=1`),
    isolatablePreviews: false,
    write: (path, dataBase64, ifVersion) =>
      apiFetchWithMeta<void>(`${base}/content`, {
        method: "PUT",
        body: { dataBase64, ifVersion } satisfies FilesWriteRequest,
        query: { workspace, path },
        server,
      }).then((res) => res.etag),
    create: (body) =>
      apiFetch<void>(`${base}/create`, { method: "POST", body, query: { workspace }, server }),
    move: (body) =>
      apiFetch<void>(`${base}/move`, { method: "POST", body, query: { workspace }, server }),
    remove: (path, ifVersion) =>
      apiFetch<void>(`${base}/content`, {
        method: "DELETE",
        query: { workspace, path, ifVersion },
        server,
      }),
    search: (q) =>
      apiFetch<WorkspaceSearchResponse>(`${base}/search`, { query: { workspace, q }, server }),
    reveal: (path) =>
      apiFetch<void>(`${base}/reveal`, { method: "POST", query: { workspace, path }, server }),
  };
}

/** The operations for `scope`. */
export function filesApi(scope: FilesScope): FilesApi {
  return scope.kind === "session"
    ? sessionFiles(scope.sessionId)
    : directoryFiles(scope.projectId, scope.workspace, scope.machineId);
}
