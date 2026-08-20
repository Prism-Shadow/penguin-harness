/**
 * settings-sections.ts unit tests: which System settings sub-pages each viewer gets.
 *
 * Two of the three sub-pages write server-global settings through /api/admin/settings; the
 * third is a per-user preference. The rule is pinned by value rather than by shape because
 * both halves of it can fail silently and separately: a sub-nav that shows a forbidden entry
 * leaks that the setting exists, and a `:section` segment that is honoured without the same
 * filter hands a non-admin the form itself. Both go through these functions, so both are
 * covered here.
 *
 * The client filter is convenience, not the boundary — GET and PUT /api/admin/settings answer
 * a non-admin with 403 either way (server/test/admin-settings.test.ts, "non-admin access is
 * always 403").
 *
 * vitest runs node-only here (`environment: "node"`, no jsdom), so this asserts against the
 * exported functions and, for the page's use of them, its source (account-menu.test.ts
 * convention).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SETTINGS_SECTIONS,
  resolveSettingsSection,
  settingsGroups,
  visibleSettingsSections,
} from "../src/lib/settings-sections";

const admin = visibleSettingsSections({ isAdmin: true });
const plain = visibleSettingsSections({ isAdmin: false });

describe("visibleSettingsSections", () => {
  it("gives an admin every section, in sub-nav order", () => {
    expect(admin.map((s) => s.key)).toEqual(["general", "proxy", "uploads"]);
  });

  it("gives a non-admin the personal section and nothing else", () => {
    // Not "fewer sections" — the exact list. Proxy and Upload limits are server-global, and
    // the whole point of dropping them is that a non-admin is never told they exist.
    expect(plain.map((s) => s.key)).toEqual(["general"]);
    expect(plain.some((s) => s.adminOnly)).toBe(false);
  });

  it("keeps the admin-only flag and the Server group in step", () => {
    // The group is a heading, not a gate; but a section that drifts out of step would either
    // sit under "Server" while any user could open it, or hide an admin-only form under
    // "Personal", where the missing heading rule would then leak it to a non-admin.
    for (const section of SETTINGS_SECTIONS) {
      expect(section.adminOnly).toBe(section.group === "server");
    }
  });
});

describe("settingsGroups", () => {
  it("lists an admin's groups once each, in section order", () => {
    expect(settingsGroups(admin)).toEqual(["personal", "server"]);
  });

  it("leaves a non-admin with a single group, which is the page's cue to draw no heading", () => {
    // A lone "Personal" heading announces that some other group exists.
    expect(settingsGroups(plain)).toEqual(["personal"]);
  });
});

describe("resolveSettingsSection", () => {
  it("passes through a section the viewer may open", () => {
    expect(resolveSettingsSection("proxy", admin)).toBe("proxy");
    expect(resolveSettingsSection("general", plain)).toBe("general");
  });

  it("sends a non-admin typing /settings/proxy to their own first section", () => {
    // The deep-link half of the gate. Answering identically to an unknown segment is the
    // point: the address bar cannot be used to find out that "proxy" is a real section.
    expect(resolveSettingsSection("proxy", plain)).toBe("general");
    expect(resolveSettingsSection("uploads", plain)).toBe("general");
    expect(resolveSettingsSection("no-such-section", plain)).toBe("general");
  });

  it("falls back to the first visible section for a missing segment", () => {
    expect(resolveSettingsSection(null, admin)).toBe("general");
    expect(resolveSettingsSection(undefined, admin)).toBe("general");
  });

  it("returns null when nothing is visible, rather than inventing a section", () => {
    expect(resolveSettingsSection("general", [])).toBe(null);
  });
});

describe("the System settings page", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/features/settings/settings-page.tsx"),
    "utf8",
  );

  it("builds its sub-nav from the filtered list rather than the full one", () => {
    // Without this the functions above could pass every test while the page mapped over
    // SETTINGS_SECTIONS and rendered the admin rows to everyone.
    expect(source).toContain("visibleSettingsSections({ isAdmin })");
    expect(source).not.toContain("SETTINGS_SECTIONS");
  });

  it("replaces an address that resolved to a different section", () => {
    // Rendering the resolved section under the requested path would leave a non-admin on a
    // URL reading /settings/proxy — still the leak, minus the form.
    expect(source).toContain("if (active !== section) return <Navigate");
  });
});
