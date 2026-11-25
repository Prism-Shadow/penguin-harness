/**
 * The API socket's reference moved to the terminals domain package
 * (@prismshadow/penguin-library-terminal/socket-ref, terminals restack S17). Re-exported so
 * the server's existing importers keep their spelling, together with the API socket path the
 * same reference answers on.
 */
export { apiSocketPath } from "../api/types.js";
export * from "@prismshadow/penguin-library-terminal/socket-ref";
