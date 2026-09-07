/**
 * The `harness.json` reader, re-exported so this package's published `./hmr/manifest`
 * subpath keeps working: the CLI's thin loader resolves the committed cli bundle through it
 * with no server in the process, and that entry point is a contract with installed CLIs.
 *
 * The reader itself is the hot-update MECHANISM and lives with the rest of it
 * (@prismshadow/penguin-hmr) — see that package's README for what may go in there.
 */
export * from "@prismshadow/penguin-hmr/manifest";
