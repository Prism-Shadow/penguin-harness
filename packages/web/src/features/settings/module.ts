/**
 * Settings: the shortcut runtime, which reconciles the shortcut mirror with the account's prefs,
 * and the Settings dialog, opened on request (settings-layer.tsx).
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { ShortcutRuntime } from "./shortcut-runtime";
import { SettingsLayer } from "./settings-layer";

@Module({
  contributes: {
    "WebAppModule.layers": [
      { id: "settings.shortcuts", order: 20 },
      { id: "settings.dialog", order: 25 },
    ],
  },
})
export class SettingsModule {
  @Bind("settings.shortcuts") shortcuts = ShortcutRuntime;
  @Bind("settings.dialog") dialog = SettingsLayer;
}
