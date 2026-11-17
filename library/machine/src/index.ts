/**
 * The machines domain as a library package: the MachineRow shape and the machines repo
 * (its own contract - it declares no mechanism interface), plus the browser-extension
 * pairing store. One package, no server dependencies - the repos take the Db capability
 * from @prismshadow/penguin-library-db.
 *
 * Subpaths:
 * - `.` - the row shape and the repo classes.
 * - `./machines` / `./browser-extensions` - each module on its own.
 */
export * from "./machine.js";
export * from "./browser-extensions.js";
export * from "./builtin-browser-vocab.js";
