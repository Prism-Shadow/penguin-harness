/**
 * The mtime gate moved to the session domain package
 * (@prismshadow/penguin-library-session/mtime-gate, services+http+cli restack S7) — it
 * came here beside the schedule store and its schedule-file scans. Re-exported so the
 * server's existing importers keep their spelling.
 */
export * from "@prismshadow/penguin-library-session/mtime-gate";
