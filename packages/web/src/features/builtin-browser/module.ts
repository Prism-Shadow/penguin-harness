import { mainPanelDefinition as mainPanelbuiltin_browser } from "./main-dock-panel";
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { BuiltinBrowserLayer } from "./browser-layer";
import { builtinBrowserUserEvents } from "./browser-events";

@Module({
  contributes: {
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
  },
})
export class BuiltinBrowserModule {
  @Bind("builtin-browser.layer") layer = BuiltinBrowserLayer;
  @Bind("builtin-browser.events") events = builtinBrowserUserEvents;
  @Bind("builtin-browser.panel") panel = { mainDefinitions: [mainPanelbuiltin_browser] };
}
