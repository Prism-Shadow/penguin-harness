/**
 * Deleting a Session moved to the session domain package
 * (@prismshadow/penguin-library-session/session-deletion, services+http+cli restack S14); this
 * file re-exports the moved shapes for the server's own import paths.
 */
export { deleteSessionTree } from "@prismshadow/penguin-library-session/session-deletion";
export type {
  DeletedSession,
  SessionDeletionDeps,
} from "@prismshadow/penguin-library-session/session-deletion";
