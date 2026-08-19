/**
 * account-menu.ts unit tests: which sessions the sidebar user menu offers a
 * change-password entry to.
 *
 * The rule is pinned by value in all four combinations rather than by shape, because the
 * tempting simplification — keying on `desktopMode` alone, like the sibling sign-out and
 * Users entries do — is wrong in a way nothing else would catch: it also strips the
 * control from a browser signed in against a desktop-mode server over loopback, whose
 * password session can still change its password (server/test/desktop.test.ts, "keeps
 * requiring oldPassword for password-established sessions in desktop mode").
 *
 * vitest runs node-only here (`environment: "node"`, no jsdom), so this asserts against the
 * exported predicate rather than a rendered menu (title-reveal.test.ts convention).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { offersChangePassword } from "../src/lib/account-menu";

describe("offersChangePassword", () => {
  it("hides it in the desktop shell's own window — no login form, seed password never shown", () => {
    expect(offersChangePassword({ desktopMode: true, sessionVia: "desktop" })).toBe(false);
  });

  it("offers it on an ordinary multi-user server reached from a browser", () => {
    expect(offersChangePassword({ desktopMode: false, sessionVia: "password" })).toBe(true);
  });

  it("offers it to a browser signed into a desktop-mode server over loopback", () => {
    // That session typed a real password at the login form; the server still lets it
    // change one, so hiding the entry would strand it.
    expect(offersChangePassword({ desktopMode: true, sessionVia: "password" })).toBe(true);
  });

  it("offers it to a desktop cookie replayed against a plain server on the same data root", () => {
    // The shared data root makes this reachable, and there the server requires the old
    // password like any other session — so the control is live and must stay visible.
    expect(offersChangePassword({ desktopMode: false, sessionVia: "desktop" })).toBe(true);
  });

  it("is hidden in exactly one of the four states", () => {
    const states = [true, false].flatMap((desktopMode) =>
      (["password", "desktop"] as const).map((sessionVia) => ({ desktopMode, sessionVia })),
    );
    expect(states.filter((s) => !offersChangePassword(s))).toEqual([
      { desktopMode: true, sessionVia: "desktop" },
    ]);
  });
});

describe("the sidebar user menu", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/components/layout/sidebar.tsx"),
    "utf8",
  );

  it("gates its change-password entry on the predicate rather than rendering it always", () => {
    // Without this the predicate could pass every test above while the menu ignored it,
    // which is the exact regression this change guards against.
    expect(source).toContain("offersChangePassword({ desktopMode, sessionVia })");
  });

  it("leaves the sibling entries on their own desktopMode gate", () => {
    // Sign out and Users are hidden for the whole desktop-mode server, not just the
    // shell's window; the narrower rule above must not be copied onto them by accident.
    expect(source).toContain("{!desktopMode && (");
    expect(source).toContain("{user?.isAdmin && !desktopMode && (");
  });
});
