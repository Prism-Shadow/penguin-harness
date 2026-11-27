/**
 * The archive page's service moved to the session domain package
 * (@prismshadow/penguin-library-session/archived-sessions-service, services+http+cli restack
 * S14) with its DTOs; the server keeps the routes, re-exports the shapes through api/types,
 * and this file re-exports the service for the server's own import paths.
 */
export { ArchivedSessionsService } from "@prismshadow/penguin-library-session/archived-sessions-service";
export type {
  ArchiveCaller,
  ArchiveMachine,
  ArchivedSessionsDeps,
} from "@prismshadow/penguin-library-session/archived-sessions-service";
