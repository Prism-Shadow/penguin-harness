/**
 * Signing the shell's own window in, for a server the shell did not spawn.
 *
 * The one-shot PENGUIN_DESKTOP_TOKEN means something only to the server this shell started,
 * so a window pointed at any other instance — attach mode, where another server already
 * holds the data root's lock — landed on the App's sign-in page. That page is a dead end
 * here: the desktop seeds its admin with a random password that is hashed and discarded
 * unseen, so there is nothing to type and nothing to look up.
 *
 * The way out is the authorization the shell already holds. Being able to read and write a
 * data root is this product's authorization boundary — that directory holds every credential
 * a session could reach — so the shell mints a session row in the root's own web.db and hands
 * the window the cookie for it, the same move `penguin auth token` makes for a script. A root
 * it cannot mint in says so in one of a few recognizable ways, and each of them is something
 * the person at the keyboard can act on, so the failures come back as text for a dialog
 * rather than as an exception.
 *
 * Pure, and free of Electron: the minter is a parameter, so the tests drive every outcome.
 */
import type { MintedVia, MintTokenResult } from "@prismshadow/penguin-server/auth-token";
import { isAppUrl } from "./util.js";

/**
 * The session cookie's name. Duplicated from the server's SESSION_COOKIE rather than
 * imported: the shell mints through the one server module that deliberately needs no running
 * server, and re-exporting the name from it would drag the HTTP layer the name belongs to
 * into this bundle and the CLI's. A test pins the two values together instead.
 */
export const SESSION_COOKIE = "penguin_session";

/**
 * How long a minted session lives: thirty days, which is both what the server gives an
 * ordinary browser sign-in (config.ts, authSessionTtlMs) and the ceiling the minter enforces
 * (CLI_TOKEN_MAX_TTL_MS). The minter's own default of one hour (CLI_TOKEN_TTL_MS) is right
 * for a token in a file and wrong here, for a reason that is easy to miss: the server slides
 * a session's expiry only when the session's whole span reaches the renewal window
 * (authenticateWithMeta against authSessionRenewMs, a day under the TTL), so a one-hour row
 * expires on the hour however much the window is used. This cookie backs a window someone
 * leaves open for weeks. At thirty days the row renews in place once it is a day old, exactly
 * as a browser session does; at anything shorter the window would drop back to the sign-in
 * page on a timer and be rescued again, leaving a dead row behind each time.
 */
export const ATTACH_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

/** What this module needs of `mintApiToken`, so a test can be the minter. */
export type SessionMinter = (
  root: string,
  opts: { ttlMs: number; via: MintedVia },
) => MintTokenResult;

/**
 * A cookie in the shape Electron's `cookies.set` takes. `expirationDate` (seconds since the
 * epoch) comes from the minted row: the row carries the authoritative expiry, and a cookie
 * outliving it would leave the window holding a credential the server has already dropped.
 */
export interface SessionCookie {
  url: string;
  name: string;
  value: string;
  path: string;
  httpOnly: boolean;
  sameSite: "lax";
  expirationDate?: number;
}

/** Why the shell could not sign itself in. `detail` is prose, ready for a dialog. */
export interface SignInFailure {
  /** `no_server`: the root holds no web.db. `failed`: the mint itself refused, with a reason. */
  reason: "no_server" | "failed";
  detail: string;
}

/** What the shell should do about the window: set this cookie, or show this failure. */
export type SignInPlan =
  { outcome: "cookie"; cookie: SessionCookie } | { outcome: "failed"; failure: SignInFailure };

/**
 * Plans a sign-in on `origin` for the server keeping its data in `root`. The origin decides
 * only where the cookie goes; the authorization comes entirely from the root, which is why
 * this works against a server the shell has no other relationship with.
 */
export function planSignIn(opts: {
  root: string;
  origin: string;
  mint: SessionMinter;
}): SignInPlan {
  // `desktop`, not the minter's default `cli`: the row records what this session actually is,
  // the desktop shell's own window, which is what the App reads back to leave the current
  // password out of its change-password form — an account the shell created has a password
  // nobody has ever seen.
  const minted = opts.mint(opts.root, { ttlMs: ATTACH_SESSION_TTL_MS, via: "desktop" });
  if (minted.outcome === "no_server") {
    return {
      outcome: "failed",
      failure: {
        reason: "no_server",
        detail:
          `There is no web.db in ${opts.root}, so that data root holds no account to sign in ` +
          `as. The server this window is talking to keeps its data elsewhere — PENGUIN_HOME ` +
          `or PENGUIN_WEB_DB points it somewhere this app is not looking.`,
      },
    };
  }
  if (minted.outcome === "failed") {
    // The minter's own explanation: a database owned by another OS account, or one an older
    // release wrote. Passed through whole, because it already names the file and the fix.
    return { outcome: "failed", failure: { reason: "failed", detail: minted.detail } };
  }
  const expiresAt = Date.parse(minted.expiresAt);
  return {
    outcome: "cookie",
    cookie: {
      url: `${opts.origin}/`,
      name: SESSION_COOKIE,
      value: minted.token,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      // An unreadable expiry would be a server bug, and a cookie without one lasts only as
      // long as the window — which fails towards asking again, not towards never expiring.
      ...(Number.isFinite(expiresAt) ? { expirationDate: Math.floor(expiresAt / 1000) } : {}),
    },
  };
}

/** The server holding the data root, as its lock records it. */
export interface OtherServer {
  pid: number;
  port: number;
}

/** A message box, in the parts Electron's dialog takes. */
export interface SignInDialog {
  message: string;
  detail: string;
  buttons: string[];
}

/**
 * The dialog raised when the shell could not sign its own window in. It has to answer three
 * questions at once, because the person seeing it did nothing to provoke it: which data root
 * and which process this is about, why the automatic sign-in did not happen, and what to do
 * about a sign-in page whose password was never shown to anyone. The single button is the
 * honest set of choices — the window is going to the sign-in page either way.
 */
export function signInFailureDialog(opts: {
  dataRoot: string;
  other: OtherServer | null;
  failure: SignInFailure;
}): SignInDialog {
  const lines = [
    `Data root: ${opts.dataRoot}`,
    ...(opts.other !== null
      ? [`Server using it: port ${opts.other.port}, process ${opts.other.pid}`]
      : []),
    "",
    opts.failure.detail,
    "",
    "This app normally signs its own window in by writing a session into that data root, so " +
      "it never asks for a password — the one it created for itself is random and was never " +
      "shown. This window will fall back to the sign-in page, where that password is of no use.",
    "",
    "To get a password you can use, stop the server above and run:",
    "",
    "    penguin server reset-admin-password",
  ];
  return {
    message:
      opts.other !== null
        ? "Another server is using this data root, and the window could not sign itself in."
        : "The window could not sign itself in.",
    detail: lines.join("\n"),
    buttons: ["Continue to the sign-in page"],
  };
}

/**
 * The App's sign-in page. Everything that fails to authenticate arrives here: the App's own
 * route guard replaces the URL with it whenever /api/me says nobody is signed in, and the
 * server redirects a failed claim to it. Watching for the path is therefore a catch-all, and
 * costs one comparison per navigation.
 */
const LOGIN_PATH = "/login";

/**
 * Whether a navigation put the window on the sign-in page. The query string is ignored — the
 * server appends `?claimFailed=…` on its way here, and the App strips it a moment later — but
 * the path is matched whole, so a page merely named after it is not mistaken for it.
 */
export function isLoginPageUrl(url: string, origin: string | null): boolean {
  if (!isAppUrl(url, origin)) return false;
  const { pathname } = new URL(url);
  return pathname === LOGIN_PATH || pathname === `${LOGIN_PATH}/`;
}

/** What to do about the page the window has landed on. */
export type SignInMove = "rescue" | "leave";

/**
 * Decides which arrivals at the sign-in page the shell answers with a session.
 *
 * Two things must not happen, and they pull in opposite directions, which is why this is a
 * state machine and not a condition:
 *
 * - A data root that cannot mint must not loop. One attempt answers a stay on the sign-in
 *   page; it is re-armed only by the window reaching a page the App serves to a signed-in
 *   window, since that is the only evidence the last attempt took. The URL the shell loads
 *   itself after an attempt is not such evidence, so it is excluded by name.
 * - **A sign-out must stick.** It is the one arrival at the sign-in page that is a decision
 *   rather than a failure, and from outside the page it looks exactly like an expired
 *   session — so the shell is told about it separately, by watching the request the App
 *   makes to end the session. Do not delete this branch on the grounds that the rescue
 *   ought to cover every route to the sign-in page: cover this one and Sign out becomes a
 *   no-op, with no way to hand the machine to someone else. The suppression lasts until
 *   something signs in again, or until the next launch, which is where this state begins.
 */
export interface SignInGuard {
  /** Reports where the window has landed, and gets the move for it. */
  arrived(url: string, origin: string | null): SignInMove;
  /**
   * Records an attempt the shell has made, and the URL it is loading next (null when it
   * loads nothing, because the window is already on the page it would land on).
   */
  tried(landingUrl: string | null): void;
  /** Records that the App has ended the session on purpose. */
  signedOut(): void;
}

/** A guard with no history: one launch of the app, one fresh start for all of the above. */
export function createSignInGuard(): SignInGuard {
  /** An attempt has answered the window's current stay on the sign-in page. */
  let attempted = false;
  /** The session was ended on purpose, and nothing has signed in since. */
  let signOutRequested = false;
  /** A URL the shell is loading of its own accord; arriving there is not the App's doing. */
  let shellLoad: string | null = null;
  return {
    arrived(url, origin) {
      if (isLoginPageUrl(url, origin)) {
        if (signOutRequested || attempted) return "leave";
        // Marked here as well as in `tried`, so a caller that never reports back still gets
        // one attempt rather than one per navigation.
        attempted = true;
        return "rescue";
      }
      if (url === shellLoad) {
        shellLoad = null;
        return "leave";
      }
      // Any other page of the App is served to signed-in windows only, so the window is in:
      // the next arrival at the sign-in page is a new situation, and a sign-out that was
      // honored is over.
      attempted = false;
      signOutRequested = false;
      return "leave";
    },
    tried(landingUrl) {
      attempted = true;
      shellLoad = landingUrl;
    },
    signedOut() {
      signOutRequested = true;
    },
  };
}
