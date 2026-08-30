/**
 * A plugin replaces any node of the tree — a component, a whole group — by name.
 * Nothing about the stand-in is checked when it is put in place; the tree it results in
 * is checked as one before any node runs: a stand-in that offers less than its consumers
 * need is refused by name, and the App does not boot.
 */
import { describe, expect, it, afterEach } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import { PluginHost } from "../src/plugin/host.js";
import type { Settings, UiPrefsStore } from "../src/mechanisms/settings.js";
import { createTestApp, loginAdmin, type TestApp } from "./helpers.js";

const PKG = "@prismshadow/penguin-server";

function replacing(
  name: string,
  provides: Record<string, string>,
  api: Record<string, unknown>,
  extra: Partial<ModuleDef["manifest"]> = {},
): ModuleDef {
  return {
    manifest: parseManifest({
      name,
      requires: {},
      provides,
      contributes: {},
      children: [],
      ...extra,
    }),
    create: () => ({ api }),
  };
}

function hostWith(...replaces: ModuleDef[]): PluginHost {
  const host = new PluginHost();
  host.use({ specifier: "memory-ext", modules: [], replaces });
  return host;
}

function memorySettings(maxMb = 7): Settings {
  const kv = new Map<string, string>();
  return {
    get: (k) => kv.get(k) ?? null,
    set: (k, v) => void kv.set(k, v),
    getProxyForApp: () => false,
    setProxyForApp: () => {},
    getProxyForAgent: () => false,
    setProxyForAgent: () => {},
    getProxyUrl: () => null,
    hasGithubToken: () => false,
    setGithubToken: () => {},
    setProxyUrl: () => {},
    getAttachmentMaxMb: () => maxMb,
    setAttachmentMaxMb: () => {},
    getAttachmentTotalMb: () => maxMb * 10,
    setAttachmentTotalMb: () => {},
    getAttachmentLimitsMb: () => ({ attachmentMaxMb: maxMb, attachmentTotalMb: maxMb * 10 }),
  };
}

describe("hot replacement by a plugin", () => {
  let t: TestApp | null = null;
  afterEach(async () => {
    await t?.cleanup();
    t = null;
  });

  it("a component is replaced by name; its consumers run against the stand-in", async () => {
    const settings = memorySettings(7);
    t = await createTestApp({
      plugins: hostWith(
        replacing("ServerSettingsRepo", { Settings: `${PKG}#Settings` }, { Settings: settings }),
      ),
    });
    // The node and the group's export are the stand-in itself …
    expect(t.deps.tree.api("ServerSettingsRepo", "Settings")).toBe(settings);
    expect(t.deps.tree.api("SettingsModule", "Settings")).toBe(settings);
    // … and a consumer in another group (the admin routes) serves what it says.
    const admin = await loginAdmin(t.app);
    const res = await t.app.request("/api/admin/settings", { headers: { cookie: admin.cookie } });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { settings: { attachmentMaxMb: number } }).settings.attachmentMaxMb,
    ).toBe(7);
  });

  it("a stand-in whose instance lacks a method the interface names is refused, by name", async () => {
    const hollow = { ...memorySettings() } as Record<string, unknown>;
    delete hollow.getAttachmentLimitsMb;
    await expect(
      createTestApp({
        plugins: hostWith(
          replacing("ServerSettingsRepo", { Settings: `${PKG}#Settings` }, { Settings: hollow }),
        ),
      }),
    ).rejects.toThrow(
      /ServerSettingsRepo: api 'Settings' does not satisfy 'Settings': missing \[getAttachmentLimitsMb\]/,
    );
  });

  it("a stand-in that provides nothing its consumers need is refused before anything runs", async () => {
    await expect(
      createTestApp({ plugins: hostWith(replacing("ServerSettingsRepo", {}, {})) }),
    ).rejects.toThrow(/SettingsModule: exports 'Settings' but no child provides it/);
  });

  it("a stand-in naming an interface the table does not carry is refused", async () => {
    await expect(
      createTestApp({
        plugins: hostWith(
          replacing(
            "ServerSettingsRepo",
            { Settings: `${PKG}#Nope` },
            { Settings: memorySettings() },
          ),
        ),
      }),
    ).rejects.toThrow(/Nope/);
  });

  it("a whole group is replaced with a subtree of its own, exporting the same interfaces", async () => {
    const settings = memorySettings(7);
    const prefs = new Map<string, string>();
    const uiPrefs: UiPrefsStore = {
      get: (u) => prefs.get(u) ?? null,
      set: (u, j) => void prefs.set(u, j),
    };
    const group: ModuleDef = {
      manifest: parseManifest({
        name: "SettingsModule",
        requires: {},
        provides: { Settings: `${PKG}#Settings`, UiPrefsStore: `${PKG}#UiPrefsStore` },
        exports: ["Settings", "UiPrefsStore"],
        contributes: {},
        children: ["MemorySettings", "MemoryPrefs"],
      }),
      create: () => ({ api: {} }),
      children: [
        replacing("MemorySettings", { Settings: `${PKG}#Settings` }, { Settings: settings }),
        replacing(
          "MemoryPrefs",
          { UiPrefsStore: `${PKG}#UiPrefsStore` },
          { UiPrefsStore: uiPrefs },
        ),
      ],
    };
    t = await createTestApp({ plugins: hostWith(group) });
    expect(t.deps.tree.api("SettingsModule", "Settings")).toBe(settings);
    // A consumer in another group reached it through the export: the attachment limit
    // the HTTP layer enforces is the stand-in's.
    const admin = await loginAdmin(t.app);
    const res = await t.app.request("/api/admin/settings", { headers: { cookie: admin.cookie } });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { settings: { attachmentMaxMb: number } }).settings.attachmentMaxMb,
    ).toBe(7);
  });

  it("two plugins replacing the same node is a load-time conflict", () => {
    const host = hostWith(
      replacing(
        "ServerSettingsRepo",
        { Settings: `${PKG}#Settings` },
        { Settings: memorySettings() },
      ),
    );
    expect(() =>
      host.use({
        specifier: "other",
        modules: [],
        replaces: [
          replacing(
            "ServerSettingsRepo",
            { Settings: `${PKG}#Settings` },
            { Settings: memorySettings() },
          ),
        ],
      }),
    ).toThrow(/'ServerSettingsRepo' is already replaced by another plugin/);
  });
});
