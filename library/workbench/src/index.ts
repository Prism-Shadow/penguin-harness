/**
 * The workbenches domain as a library package: the vocabulary the server's workbenches
 * mechanism implements and the Web App reads, plus the reads and writes behind a workbench's
 * source folder — its Git repository, its compile, its migrations and its App Center. One
 * package, no server dependencies.
 *
 * Subpaths:
 * - `.` - the vocabulary.
 * - `./workbench` - the vocabulary module on its own.
 * - one subpath per module: `./app-center`, `./app-center-layout`, `./archive`, `./compile`,
 *   `./compile-ui`, `./data-dirs`, `./git-identity`, `./leftovers`, `./manifest`, `./migrate`,
 *   `./migrate-state`, `./page-html`, `./page-sdk`, `./repo`, `./result`, `./store`,
 *   `./ui-runtime`.
 */
export * from "./workbench.js";
