/**
 * Moved to the machines domain package (@prismshadow/penguin-library-machine/secret-file,
 * machines restack S16) — its stored ssh passwords are written through it. Re-exported so the
 * server's existing importers, and the `@prismshadow/penguin-server/secret-file` subpath the
 * CLI reads, keep their spelling.
 */
export * from "@prismshadow/penguin-library-machine/secret-file";
