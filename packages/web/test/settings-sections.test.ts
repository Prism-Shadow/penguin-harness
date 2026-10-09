/**
 * Which Settings pages each viewer gets (lib/settings-sections.ts), pinned by value: a rail
 * showing a forbidden entry leaks that the setting exists, and a page rendered without the same
 * filter hands a non-admin the form. The admin APIs answer a non-admin with 403 either way; this
 * filter is convenience, not the boundary.
 *
 * - A web admin gets every page in rail order; a non-admin only their own pages (their browser
 *   among them: every user may pair their own Chrome), nothing server-global; the desktop shell's window drops the account page and user management; a
 *   password session against a desktop-mode server keeps the account page.
 * - The rail lists an admin's groups once each, in page order, and a single group when only
 *   one remains (its cue to draw no heading).
 * - A requested page passes through when the viewer may open it; a forbidden or unknown page,
 *   or none, falls back to the first visible page; nothing visible resolves to nothing.
 */
import { describe, expect, it } from "vitest";
import {
  resolveSettingsSection,
  settingsGroups,
  visibleSettingsSections,
} from "../src/lib/settings-sections";

/** Admin signed into a plain `penguin server` through the login form. */
const admin = visibleSettingsSections({
  isAdmin: true,
  desktopMode: false,
  sessionVia: "password",
});
/** Ordinary account on the same server. */
const plain = visibleSettingsSections({
  isAdmin: false,
  desktopMode: false,
  sessionVia: "password",
});
/** The desktop shell's own window: single-user, token session, no password to change. */
const shell = visibleSettingsSections({
  isAdmin: true,
  desktopMode: true,
  sessionVia: "desktop",
});
/** A browser signed into that same desktop-mode server over loopback, with a real password. */
const desktopBrowser = visibleSettingsSections({
  isAdmin: true,
  desktopMode: true,
  sessionVia: "password",
});

describe("visibleSettingsSections", () => {
  it("gives a web admin every page, in rail order", () => {
    expect(admin.map((s) => s.key)).toEqual([
      "profile",
      "general",
      "appearance",
      "shortcuts",
      "account",
      "browser",
      "proxy",
      "uploads",
      "company",
      "chromeExtension",
      "plugins",
      "users",
    ]);
  });

  it("gives a non-admin their own pages and nothing server-global", () => {
    // Not "fewer pages" — the exact list. Proxy, upload limits, the company-mode master
    // switch and user management are admin surfaces, and the whole point of dropping them is that a non-admin is never
    // told they exist. Updating is not among them either way: it lives in the sidebar user
    // menu, outside this dialog, for every account.
    expect(plain.map((s) => s.key)).toEqual([
      "profile",
      "general",
      "appearance",
      "shortcuts",
      "account",
      "browser",
    ]);
  });

  it("strips the desktop shell's window down to what a token session can use", () => {
    // No account page (no password to change — see offersChangePassword), no user
    // management (single-user server). The profile page stays: an avatar and a nickname need
    // no password, and this window is the only session a desktop install has.
    expect(shell.map((s) => s.key)).toEqual([
      "profile",
      "general",
      "appearance",
      "shortcuts",
      "browser",
      "proxy",
      "uploads",
      "company",
      "chromeExtension",
      "plugins",
    ]);
  });

  it("keeps the account page for a password session against a desktop-mode server", () => {
    // Mirrors the old menu row's two-field rule: that session typed a real password and
    // can still change it, while user management stays desktop-hidden.
    expect(desktopBrowser.map((s) => s.key)).toEqual([
      "profile",
      "general",
      "appearance",
      "shortcuts",
      "account",
      "browser",
      "proxy",
      "uploads",
      "company",
      "chromeExtension",
      "plugins",
    ]);
  });
});

describe("settingsGroups", () => {
  it("lists an admin's groups once each, in page order", () => {
    expect(settingsGroups(admin)).toEqual(["personal", "server"]);
  });

  it("collapses to a single group when only one remains, the rail's cue to draw no heading", () => {
    // A lone "Personal" heading announces that some other group exists — which is exactly a
    // non-admin's case, whose every page is personal.
    expect(settingsGroups(plain)).toEqual(["personal"]);
  });
});

describe("resolveSettingsSection", () => {
  it("passes through a page the viewer may open", () => {
    expect(resolveSettingsSection("proxy", admin)).toBe("proxy");
    expect(resolveSettingsSection("appearance", plain)).toBe("appearance");
    expect(resolveSettingsSection("profile", plain)).toBe("profile");
  });

  it("sends a non-admin asking for an admin page to their own first page", () => {
    // Answering identically to an unknown request is the point: a requested key cannot be
    // used to find out that "users" is a real page.
    expect(resolveSettingsSection("users", plain)).toBe("profile");
    expect(resolveSettingsSection("proxy", plain)).toBe("profile");
    expect(resolveSettingsSection("no-such-section", plain)).toBe("profile");
  });

  it("falls back to the first visible page for a missing request", () => {
    expect(resolveSettingsSection(null, admin)).toBe("profile");
    expect(resolveSettingsSection(undefined, admin)).toBe("profile");
  });

  it("returns null when nothing is visible, rather than inventing a page", () => {
    expect(resolveSettingsSection("general", [])).toBe(null);
  });
});
