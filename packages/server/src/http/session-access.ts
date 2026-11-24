/**
 * The one session-reading rule lives in the sessions library (@prismshadow/penguin-library-session,
 * services+http restack); this re-export keeps the server's own import paths stable.
 */
export { readableSession } from "@prismshadow/penguin-library-session/access";
