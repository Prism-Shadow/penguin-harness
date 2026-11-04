/**
 * Which Settings pages each viewer gets (lib/settings-sections.ts): a rail showing a forbidden
 * entry leaks that the setting exists, and a page rendered without the same filter hands a
 * non-admin the form. The admin APIs answer a non-admin with 403 either way; this filter is
 * convenience, not the boundary.
 *
 * - A web admin gets every page, each once; a non-admin gets exactly the admin's personal pages
 *   (their browser and their archived chats among them) and nothing server-global; the desktop
 *   shell's window drops the account page and user management; a password session against a
 *   desktop-mode server keeps the account page.
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
import type { SettingsSectionKey } from "../src/lib/settings-sections";

/**
 * Every Settings page there is. Keyed by the union, so a new page does not compile until it is
 * named here, and none can vanish from the web admin's rail unnoticed.
 */
const EVERY_PAGE: Record<SettingsSectionKey, true> = {
  profile: true,
  general: true,
  appearance: true,
  shortcuts: true,
  archived: true,
  account: true,
  browser: true,
  proxy: true,
  uploads: true,
  company: true,
  chromeExtension: true,
  agentApi: true,
  plugins: true,
  users: true,
};

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

/** A viewer's pages by key, in rail order. */
const keys = (sections: readonly { key: string }[]): string[] => sections.map((s) => s.key);

describe("visibleSettingsSections", () => {
  it("gives a web admin every page, each once", () => {
    expect(keys(admin).sort()).toEqual(Object.keys(EVERY_PAGE).sort());
  });

  it("gives a non-admin their own pages and nothing server-global", () => {
    // A non-admin is never told an admin surface exists: every page they get is personal, and
    // it is exactly the admin's personal rail, their browser and their archived chats among it
    // (every user may pair their own Chrome and keep their own archive).
    expect(plain.every((s) => s.group === "personal")).toBe(true);
    expect(keys(plain)).toEqual(keys(admin.filter((s) => s.group === "personal")));
    expect(keys(plain)).toEqual(expect.arrayContaining(["browser", "archived"]));
  });

  it("strips the desktop shell's window of the account page and user management", () => {
    // No account page (no password to change — see offersChangePassword), no user
    // management (single-user server). The profile page stays: an avatar and a nickname need
    // no password, and this window is the only session a desktop install has.
    expect(keys(shell)).toEqual(keys(admin).filter((k) => k !== "account" && k !== "users"));
    expect(keys(shell)).toContain("profile");
  });

  it("keeps the account page for a password session against a desktop-mode server", () => {
    // That session typed a real password and can still change it, while user management stays
    // desktop-hidden.
    expect(keys(desktopBrowser)).toEqual(keys(admin).filter((k) => k !== "users"));
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
