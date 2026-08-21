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

describe("the settings section registry", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/settings-sections.ts"),
    "utf8",
  );

  it("gates the account page on the predicate rather than listing it always", () => {
    // The change-password row moved from the sidebar menu into the settings dialog; the
    // predicate now decides whether that page exists at all. Without this the predicate
    // could pass every test above while the registry ignored it.
    expect(source).toContain("offersChangePassword(v)");
  });
});

describe("the sidebar user menu", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/components/layout/sidebar.tsx"),
    "utf8",
  );

  it("keeps sign-out on its own desktopMode gate", () => {
    // Sign out is hidden for the whole desktop-mode server, not just the shell's window.
    expect(source).toContain("{!desktopMode && (");
  });

  it("reaches the settings it no longer holds through one ungated System settings entry", () => {
    // The preference rows, change password and user management all moved into the settings
    // dialog, whose own section registry decides which pages this viewer sees — so the row
    // itself carries no isAdmin test, or a non-admin would lose the personal pages along
    // with the admin ones.
    expect(source).toContain("setSettingsOpen(true)");
    expect(source).not.toContain("offersChangePassword");
    expect(source).not.toContain("S.settings.showCliSessions");
    expect(source).not.toContain("S.settings.theme");
    expect(source).not.toContain('go("/settings")');
    expect(source).not.toContain('go("/admin/users")');
  });

  it("mounts no dialog for a surface the settings dialog owns", () => {
    // A stale mount would be a build failure rather than a silent one, but the menu
    // keeping an opener for a surface reachable elsewhere is the regression worth naming.
    expect(source).not.toContain("ProxySettingsDialog");
    expect(source).not.toContain("UploadLimitsDialog");
    expect(source).not.toContain("ChangePasswordDialog");
  });

  it("keeps both update rows outside the settings dialog, in one slot under its entry", () => {
    // Updating is deliberately not a settings page: the menu carries the check itself, and
    // the two rows are mutually exclusive by their own gates (a desktop-mode server never
    // offers the server check; a browser session against one gets neither).
    expect(source).toContain("<ServerUpdateRow");
    expect(source).toContain("<DesktopUpdateRow");
    expect(source).toContain("<UpdateDialog");
    // The row's install/announce dialogs hang off the Sidebar, which outlives the menu the
    // click closes — mounting them in the rows would unmount them on that same click.
    expect(source).toContain("setUpdateDialogOpen(true)");
    expect(source).toContain("setClientInstallOpen(true)");
  });
});
