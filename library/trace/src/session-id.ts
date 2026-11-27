/**
 * The session_id timestamp moved to the session domain package
 * (@prismshadow/penguin-library-session/session-id, services+http+cli restack S14). This file
 * re-exports it unchanged for the trace package's own import paths.
 */
export { sessionIdCreatedAt } from "@prismshadow/penguin-library-session/session-id";
