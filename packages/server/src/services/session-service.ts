/**
 * The session index service moved to the session domain package
 * (@prismshadow/penguin-library-session/session-service, services+http+cli restack S14) — it
 * speaks library vocabulary and the structural ports (SessionRuntimes, SessionDefaultModel);
 * the runtime that constructs it passes the server's own mechanisms, which satisfy the ports
 * structurally (see the SessionManager assembly in packages/server/src/runtime). This file
 * re-exports the moved shapes for the server's own import paths.
 */
export {
  SessionService,
  applySandboxPick,
  compareActivityDesc,
  NO_DEFAULT_MODEL_MESSAGE,
  sessionSandboxOf,
  sessionIdCreatedAt,
} from "@prismshadow/penguin-library-session/session-service";
export type {
  ActivityCursor,
  ArchivedRow,
  SessionListOrder,
  SessionListPaging,
  SessionServiceDeps,
} from "@prismshadow/penguin-library-session/session-service";
