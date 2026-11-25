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
export {
  TEMP_WORKSPACE_GROUP,
  isTempWorkspace,
  matchesWorkspaceGroup,
} from "./workspace-group.js";
export { assertWorkspaceAllowed } from "./workspace-guard.js";
export { archiveWorkspaceGroup } from "./workspace-archive.js";
export type { WorkspaceArchiveDeps } from "./workspace-archive.js";
export {
  DRAFT_KINDS,
  DRAFT_VALUE_MAX_CHARS,
  DRAFTS_PATCH_MAX_ENTRIES,
} from "./drafts.js";
export type { DraftKind, DraftShortcut } from "./drafts.js";
export {
  DRAFTS_MAX_COUNT,
  DRAFTS_MAX_TOTAL_CHARS,
  draftOwnerOf,
  parseDraftsPatch,
} from "./user-drafts.js";
export type { DraftOwner } from "./user-drafts.js";
export {
  DRAFT_SHORTCUT_MAX_COUNT,
  DRAFT_SHORTCUT_TITLE_MAX,
  DRAFT_SHORTCUT_PROMPT_MAX,
  DRAFT_SHORTCUT_ID_MAX,
  validateDraftShortcuts,
} from "./draft-shortcuts.js";
