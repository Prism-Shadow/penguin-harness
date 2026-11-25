/**
 * The non-admin ceiling on a Session's sandbox — the comparison itself is
 * `@prismshadow/penguin-library-sandbox`; this module re-exports it where the session
 * service has always found it.
 */
export { aboveSandboxCeiling } from "@prismshadow/penguin-library-sandbox/ceiling";
export type { SandboxLevel } from "@prismshadow/penguin-library-sandbox/ceiling";
