/**
 * The Storage page's web half: its page of the Settings dialog (Personal › Storage, after
 * Archived chats), contributed through the app's slot. Its copy is its own (strings.ts).
 *
 * It is the storage plugin's, and drawn only while the plugin's server module (`StorageModule`
 * on the server, src/server/module.ts) runs: an administrator can stop it, and a server whose
 * Projects all left it out does not run it (`WebAppModule.serverModules`).
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { storageSettingsPage } from "./settings-page";

@Module({
  contributes: {
    "WebAppModule.serverModules": [{ id: "storage.server", module: "StorageModule" }],
    "SettingsModule.sections": [
      {
        id: "storage.settings",
        key: "storage",
        group: "personal",
        visibility: "everyone",
        icon: "hardDrive",
        // After Archived chats (50), before Account (60).
        order: 55,
      },
    ],
  },
})
export class StorageWebModule {
  @Bind("storage.settings") settingsPage = storageSettingsPage;
}
