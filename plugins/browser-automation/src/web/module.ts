/**
 * The agent browser's web half: everything it adds to the app arrives through slots — the layer
 * that hosts the built-in pages and follows the agents (browser-layer.tsx), its share of the user
 * event stream, its dock panel (a lead of the empty dock's picker), what it does when the
 * conversation on screen changes or a dock steps into full screen, its two Settings pages, the
 * handover of a draft's pages to the Session it becomes, and its row in a web link's menu. Its
 * copy is its own (strings.ts), and so is its stylesheet (browser.css).
 *
 * It is the browser-automation plugin's, and drawn only while the plugin's server module
 * (`BuiltinBrowserModule` on the server, src/server/module.ts) runs: an administrator can stop
 * it, and a server whose Projects all left it out does not run it (`WebAppModule.serverModules`).
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import "./browser.css";
import { mainPanelDefinition as mainPanelbuiltin_browser } from "./main-dock-panel";
import { BuiltinBrowserLayer } from "./browser-layer";
import { builtinBrowserUserEvents } from "./browser-events";
import { adoptBrowserSession } from "./browser-actions";
import { followDockScope } from "./dock-scope";
import { browserLinkAction } from "./link-row";
import { browserSettingsPage, chromeExtensionSettingsPage } from "./settings-pages";
import { invalidateSlotClips } from "./slot-registry";

@Module({
  contributes: {
    "WebAppModule.serverModules": [{ id: "builtin-browser.server", module: "BuiltinBrowserModule" }],
    "WebAppModule.layers": [{ id: "builtin-browser.layer", order: 30 }],
    "SessionsModule.userEvents": [{ id: "builtin-browser.events", order: 20 }],
    "DockModule.panels": [
      {
        id: "builtin-browser.panel",
        kind: "builtin-browser",
        title: "Browser",
        titleZh: "浏览器",
        icon: "globe",
        order: 70,
      },
    ],
    "DockModule.scopeListeners": [{ id: "builtin-browser.scope", order: 10 }],
    "DockModule.layoutListeners": [{ id: "builtin-browser.layout", order: 10 }],
    "SettingsModule.sections": [
      {
        id: "builtin-browser.settings",
        key: "browser",
        group: "personal",
        visibility: "everyone",
        icon: "appWindow",
        order: 70,
      },
      {
        id: "builtin-browser.chrome-extension",
        key: "chromeExtension",
        group: "server",
        visibility: "admin",
        icon: "plug",
        order: 140,
      },
    ],
    "ChatModule.sessionHandovers": [{ id: "builtin-browser.handover", order: 10 }],
    "ChatModule.linkActions": [{ id: "builtin-browser.link", order: 10 }],
  },
})
export class BuiltinBrowserModule {
  @Bind("builtin-browser.layer") layer = BuiltinBrowserLayer;
  @Bind("builtin-browser.events") events = builtinBrowserUserEvents;
  @Bind("builtin-browser.panel") panel = { mainDefinitions: [mainPanelbuiltin_browser] };
  @Bind("builtin-browser.scope") scope = followDockScope;
  @Bind("builtin-browser.layout") layout = invalidateSlotClips;
  @Bind("builtin-browser.settings") settingsPage = browserSettingsPage;
  @Bind("builtin-browser.chrome-extension") chromeExtensionPage = chromeExtensionSettingsPage;
  @Bind("builtin-browser.handover") handover = adoptBrowserSession;
  @Bind("builtin-browser.link") link = browserLinkAction;
}
