/**
 * Which account controls a session is offered (lib/account-menu.ts), decided by the pair of
 * the server's desktop mode and how the session signed in — never by either alone.
 *
 * - Only the desktop shell's own window counts as the shell's window.
 * - Change password is hidden in exactly one state, the shell's own window; a browser signed
 *   into a desktop-mode server and a desktop cookie replayed against a plain server keep it.
 * - The initial-password nag stays quiet in any window the shell signed in.
 * - The current-password field is omitted for the shell's own window and first-login
 *   sessions, and kept for a desktop session against a server no shell spawned.
 */
import { describe, expect, it } from "vitest";
import {
  isDesktopShellWindow,
  offersChangePassword,
  nagsAboutInitialPassword,
  omitsOldPassword,
  passwordErrorPlace,
} from "../src/lib/account-menu";

describe("isDesktopShellWindow", () => {
  it("is the shell's own window and nothing else", () => {
    // The rule the shell-only controls share — the client-update row, and Appearance's
    // tray switch, which reaches the chrome the page is drawn in. Both single-field
    // simplifications are wrong: `desktopMode` alone lets a browser on another machine
    // drive this one's GUI app, `sessionVia` alone matches a stale desktop cookie
    // replayed against a plain `penguin server`, where no shell is listening.
    expect(isDesktopShellWindow({ desktopMode: true, sessionVia: "desktop" })).toBe(true);
    expect(isDesktopShellWindow({ desktopMode: true, sessionVia: "password" })).toBe(false);
    expect(isDesktopShellWindow({ desktopMode: false, sessionVia: "desktop" })).toBe(false);
    expect(isDesktopShellWindow({ desktopMode: false, sessionVia: "password" })).toBe(false);
  });
});

describe("offersChangePassword", () => {
  // The shell's own window has no login form and never shows the seed password. A browser
  // that typed a real password into a desktop-mode server over loopback can still change it,
  // and so can a desktop cookie replayed against a plain server on the same data root, where
  // the server requires the old password like any other session.
  it.each([
    [true, "desktop", false],
    [false, "password", true],
    [true, "password", true],
    [false, "desktop", true],
  ] as const)(
    "desktopMode %s, signed in via %s: offered %s",
    (desktopMode, sessionVia, offered) => {
      expect(offersChangePassword({ desktopMode, sessionVia })).toBe(offered);
    },
  );
});

describe("nagsAboutInitialPassword", () => {
  it("keeps quiet in any window the desktop shell signed in", () => {
    // The trail asks its reader to change a password they hold; a shell-minted session holds
    // none, and cannot set one on a server it only attached to. Both desktop cases are
    // therefore silent, while a password session on either kind of server hears it.
    expect(nagsAboutInitialPassword({ desktopMode: true, sessionVia: "desktop" })).toBe(false);
    expect(nagsAboutInitialPassword({ desktopMode: false, sessionVia: "desktop" })).toBe(false);
    expect(nagsAboutInitialPassword({ desktopMode: false, sessionVia: "password" })).toBe(true);
    expect(nagsAboutInitialPassword({ desktopMode: false, sessionVia: "setup" })).toBe(true);
  });
});

describe("omitsOldPassword", () => {
  it("omits the current-password field for the shell's own window and first-login sessions", () => {
    // For both, the account's current password was hashed and discarded unseen — demanding
    // it would dead-end the flow: a first-login claimer would face a field nobody on earth
    // can fill. A password session must still prove the current password, mirroring
    // routes/me.ts.
    expect(omitsOldPassword({ desktopMode: true, sessionVia: "desktop" })).toBe(true);
    expect(omitsOldPassword({ desktopMode: true, sessionVia: "setup" })).toBe(true);
    expect(omitsOldPassword({ desktopMode: false, sessionVia: "setup" })).toBe(true);
    expect(omitsOldPassword({ desktopMode: true, sessionVia: "password" })).toBe(false);
  });

  it("keeps the field for a desktop session against a server no shell spawned", () => {
    // The shell mints one of these for itself when it attaches to a server it did not start
    // (a `penguin web` instance on the same data root). The server's gate is the pair, so it
    // still demands the old password there; a form that dropped the field would submit a
    // request the server refuses. That account's password is recovered with `penguin server
    // reset-admin-password`, not from this form.
    expect(omitsOldPassword({ desktopMode: false, sessionVia: "desktop" })).toBe(false);
  });
});

describe("passwordErrorPlace", () => {
  it("puts a weak new password under the new-password field", () => {
    expect(passwordErrorPlace("invalid_password", true)).toBe("new");
    expect(passwordErrorPlace("invalid_password", false)).toBe("new");
  });

  it("puts a wrong current password under its field, when that field is shown", () => {
    expect(passwordErrorPlace("password_mismatch", true)).toBe("old");
  });

  it("puts it on the dialog's own line when the old-password field is not shown", () => {
    // A first-login session and the shell's own window set a password without the old one:
    // an error under a field that is not rendered would be an error nobody sees.
    expect(passwordErrorPlace("password_mismatch", false)).toBe("form");
  });

  it("puts every other failure on the dialog's own line", () => {
    for (const code of ["bad_request", "unauthorized", "internal_error", undefined]) {
      expect(passwordErrorPlace(code, true)).toBe("form");
      expect(passwordErrorPlace(code, false)).toBe("form");
    }
  });
});
