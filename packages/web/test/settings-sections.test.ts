/**
 * settings-sections.ts unit tests: which System settings pages each viewer gets.
 *
 * The rule is pinned by value rather than by shape because both halves of it can fail
 * silently and separately: a rail that shows a forbidden entry leaks that the setting
 * exists, and an initialSection that is honoured without the same filter hands a
 * non-admin the form itself. Both go through these functions, so both are covered here.
 *
 * The client filter is convenience, not the boundary — the admin APIs answer a non-admin
 * with 403 either way (server/test/admin-settings.test.ts, "non-admin access is always
 * 403").
 *
 * vitest runs node-only here (`environment: "node"`, no jsdom), so this asserts against
 * the exported functions and, for the dialog's use of them, its source
 * (account-menu.test.ts convention).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
      "general",
      "appearance",
      "account",
      "proxy",
      "uploads",
      "updates",
      "users",
    ]);
  });

  it("gives a non-admin their own pages and the update check, nothing server-global", () => {
    // Not "fewer pages" — the exact list. Proxy, upload limits and user management are
    // admin surfaces, and the whole point of dropping them is that a non-admin is never
    // told they exist. The updates page stays: any account may run the check; the
    // self-update inside stays admin-only.
    expect(plain.map((s) => s.key)).toEqual(["general", "appearance", "account", "updates"]);
  });

  it("strips the desktop shell's window down to what a token session can use", () => {
    // No account page (no password to change — see offersChangePassword), no updates
    // (electron-updater owns updating there), no user management (single-user server).
    expect(shell.map((s) => s.key)).toEqual(["general", "appearance", "proxy", "uploads"]);
  });

  it("keeps the account page for a password session against a desktop-mode server", () => {
    // Mirrors the old menu row's two-field rule: that session typed a real password and
    // can still change it, while updates and user management stay desktop-hidden.
    expect(desktopBrowser.map((s) => s.key)).toEqual([
      "general",
      "appearance",
      "account",
      "proxy",
      "uploads",
    ]);
  });
});

describe("settingsGroups", () => {
  it("lists an admin's groups once each, in page order", () => {
    expect(settingsGroups(admin)).toEqual(["personal", "server"]);
  });

  it("keeps both headings for a non-admin, whose updates page sits under Server", () => {
    expect(settingsGroups(plain)).toEqual(["personal", "server"]);
  });

  it("collapses to a single group when only one remains, the rail's cue to draw no heading", () => {
    // A lone "Personal" heading announces that some other group exists.
    expect(settingsGroups(plain.filter((s) => s.group === "personal"))).toEqual(["personal"]);
  });
});

describe("resolveSettingsSection", () => {
  it("passes through a page the viewer may open", () => {
    expect(resolveSettingsSection("proxy", admin)).toBe("proxy");
    expect(resolveSettingsSection("appearance", plain)).toBe("appearance");
  });

  it("sends a non-admin asking for an admin page to their own first page", () => {
    // Answering identically to an unknown request is the point: initialSection cannot be
    // used to find out that "users" is a real page.
    expect(resolveSettingsSection("users", plain)).toBe("general");
    expect(resolveSettingsSection("proxy", plain)).toBe("general");
    expect(resolveSettingsSection("no-such-section", plain)).toBe("general");
  });

  it("falls back to the first visible page for a missing request", () => {
    expect(resolveSettingsSection(null, admin)).toBe("general");
    expect(resolveSettingsSection(undefined, admin)).toBe("general");
  });

  it("returns null when nothing is visible, rather than inventing a page", () => {
    expect(resolveSettingsSection("general", [])).toBe(null);
  });
});

describe("the System settings dialog", () => {
  const source = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../src/features/settings/settings-dialog.tsx",
    ),
    "utf8",
  );

  it("builds its rail from the filtered list rather than the full one", () => {
    // Without this the functions above could pass every test while the dialog mapped over
    // the raw registry and rendered the admin rows to everyone.
    expect(source).toContain("visibleSettingsSections({");
    expect(source).not.toContain("SECTION_RULES");
  });

  it("resolves both the landing page and the rendered page through the same gate", () => {
    // initialSection is a request, not a right: an unknown or forbidden value must land on
    // the viewer's own first page, and the pane renders only what re-resolves.
    expect(source).toContain("resolveSettingsSection(initialSection, sections)");
    expect(source).toContain("resolveSettingsSection(active, sections)");
  });
});
