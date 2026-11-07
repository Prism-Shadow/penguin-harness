/** Settings: the shortcut runtime, which reconciles the shortcut mirror with the account's prefs. */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { ShortcutRuntime } from "./shortcut-runtime";

@Module({
  contributes: {
    "WebAppModule.layers": [{ id: "settings.shortcuts", order: 20 }],
  },
})
export class SettingsModule {
  @Bind("settings.shortcuts") shortcuts = ShortcutRuntime;
}
