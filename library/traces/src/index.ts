/**
 * The traces domain as a library package: the TraceIndexStore mechanism (the storage
 * contract the trace-index repo implements) and the trace reading/writing interfaces the
 * server's trace service implements. One package, no server dependencies. The repo takes
 * the Db capability from @prismshadow/penguin-library-db.
 *
 * Subpaths:
 * - `.` - the contracts.
 * - `./traces` - the contracts module on its own.
 * - `./repos` - the trace-index storing component.
 */
export * from "./traces.js";
