/**
 * The non-admin ceiling on a Session's sandbox moved to the session domain package
 * (@prismshadow/penguin-library-session/sandbox-ceiling, services+http+cli restack S14); this
 * file re-exports it unchanged for the server's own import paths.
 */
export { aboveSandboxCeiling } from "@prismshadow/penguin-library-session/sandbox-ceiling";
export type { SandboxLevel } from "@prismshadow/penguin-library-session/sandbox-ceiling";
