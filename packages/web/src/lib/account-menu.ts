/**
 * Which account controls the sidebar user menu offers for the current session.
 *
 * The menu's own desktop-mode rules live inline in sidebar.tsx, but this one needs a
 * two-field condition and a regression test, and vitest runs node-only here (no jsdom, so
 * nothing renders). The rule therefore lives here as a pure predicate that the menu
 * consumes — see test/account-menu.test.ts.
 */
import type { MeResponse } from "@prismshadow/penguin-server/api";

/** The two fields of `GET /api/me` that describe who is asking, and from where. */
export interface AccountMenuSession {
  /** Whether the SERVER was spawned by the desktop shell (single-user mode). */
  desktopMode: boolean;
  /** How THIS session was established: the shell's one-shot token, or the login form. */
  sessionVia: MeResponse["sessionVia"];
}

/**
 * Whether to offer a change-password entry at all.
 *
 * The desktop shell's own window is the one session with no password to change: it signs
 * in through the shell's one-shot token instead of a login form, and the seed password of
 * a desktop-created root is fully random and deliberately never printed, so its holder has
 * never seen one and has nothing to type. A root that later needs a usable password — to
 * be served by `penguin server` instead — is handled offline by `penguin server
 * reset-admin-password` from the machine that owns it.
 *
 * BOTH halves are required, mirroring the server's own gate in `routes/me.ts`.
 * `desktopMode` alone would also strip the control from a browser signed in against the
 * same desktop-mode server over loopback: that session typed a real password and can still
 * change it (pinned by server/test/desktop.test.ts, "keeps requiring oldPassword for
 * password-established sessions in desktop mode"). `sessionVia` alone would strip it from a
 * stale desktop cookie replayed against a plain `penguin server` on the same shared data
 * root, where the server requires the old password like any other session.
 */
export function offersChangePassword(session: AccountMenuSession): boolean {
  return !(session.desktopMode && session.sessionVia === "desktop");
}

/**
 * Whether the change-password form omits the current-password field.
 *
 * Two kinds of session set a password without the old one, mirroring the server's gate in
 * `routes/me.ts`: the desktop shell's own window, and a session claimed through a first-login
 * link. In both, the account's current password is a random value that was hashed and
 * discarded unseen — demanding it would dead-end the one flow the session exists for.
 */
export function omitsOldPassword(sessionVia: MeResponse["sessionVia"]): boolean {
  return sessionVia === "desktop" || sessionVia === "setup";
}
