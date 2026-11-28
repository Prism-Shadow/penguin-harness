/**
 * The session cookie's name, as every non-browser client spells it (a browser's carries the
 * server's port; `sessionCookieName` in middleware.ts). Its own module so a re-export of the
 * constant pulls no middleware — and no `node:*` import — into a browser bundle.
 */
export const SESSION_COOKIE = "penguin_session";
