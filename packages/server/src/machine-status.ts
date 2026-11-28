/**
 * Moved to the machines domain package (@prismshadow/penguin-library-machine/machine-status,
 * machines restack S16). Re-exported so the server's existing importers — and the
 * `@prismshadow/penguin-server/machine-status` subpath the CLI reads — keep their spelling.
 */
export * from "@prismshadow/penguin-library-machine/machine-status";
