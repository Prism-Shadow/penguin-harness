/**
 * The one-time preinstalled-module listing moved to the plugin library package; the server's
 * import path binds the own-table listing port (the server file it reads the config through)
 * and re-exports it.
 */
import { bindOwnTableListing } from "@prismshadow/penguin-library-plugin/ports";
import { listInOwnTable, UnparseableConfig } from "./own-table-listing.js";

bindOwnTableListing({ listInOwnTable, UnparseableConfig });

export * from "@prismshadow/penguin-library-plugin/preinstall-once";
