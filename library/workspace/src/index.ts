/**
 * The workspace domain as a library package: the WorkspaceFiles mechanism and its service
 * (the Files panel's list / read / write / create / move / delete / search over a Workspace's
 * directory) and the API vocabulary they speak. One package, no server dependencies — the
 * server imports these; nothing here imports the server.
 */
export { WorkspaceFiles } from "./contract.js";
export {
  MAX_UPLOAD_BYTES,
  SEARCH_MAX_HITS,
  SEARCH_MAX_ENTRIES,
  SEARCH_MAX_QUERY_LEN,
  WorkspaceFilesService,
} from "./workspace-files-service.js";
export type {
  WorkspaceFileContent,
  WorkspaceFileReadOptions,
  WorkspaceFileStat,
} from "./workspace-files-service.js";
export type {
  WorkspaceFileEntry,
  WorkspaceFilesResponse,
  FilesWriteRequest,
  FilesMoveRequest,
  FilesCreateRequest,
  WorkspaceSearchHit,
  WorkspaceSearchResponse,
  FilesStatRequest,
  FilesStatResponse,
} from "./types.js";
