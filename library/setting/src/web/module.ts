/**
 * Settings: the shortcut runtime, which reconciles the shortcut mirror with the account's prefs,
 * the Settings dialog, opened on request (settings-layer.tsx), and the dialog's `sections` slot,
 * through which other modules add pages of their own (iface.ts).
 */
import { Bind, Module, Provide, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { SettingsSectionCode, SettingsSectionData } from "@prismshadow/penguin-web-plugin";
import { ShortcutRuntime } from "./shortcut-runtime";
import { SettingsLayer } from "./settings-layer";
import { setContributedSections } from "./contributed-sections";
import type { SettingsPages } from "./iface";

@Module({
  contributes: {
    "WebAppModule.layers": [
      { id: "settings.shortcuts", order: 20 },
      { id: "settings.dialog", order: 25 },
    ],
  },
})
export class SettingsModule {
  @Provide() pages!: SettingsPages;
  @Bind("settings.shortcuts") shortcuts = ShortcutRuntime;
  @Bind("settings.dialog") dialog = SettingsLayer;
  setup({ contributions }: ClassCtx) {
    setContributedSections(
      (contributions.sections ?? []).map((c) => ({
        data: c.data as unknown as SettingsSectionData,
        code: c.code as SettingsSectionCode,
        from: c.from,
      })),
    );
    this.pages = {};
  }
}
