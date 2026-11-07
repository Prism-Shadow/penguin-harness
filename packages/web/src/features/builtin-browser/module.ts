/**
 * The built-in browser: its layer of pages, laid over the dock's browser tab (desktop app only),
 * and the handler that hands this server's browser events to it.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { BuiltinBrowserLayer } from "./browser-layer";
import { builtinBrowserUserEvents } from "./browser-events";

@Module({
  contributes: {
    "WebAppModule.layers": [{ id: "builtin-browser.layer", order: 30 }],
    "SessionsModule.userEvents": [{ id: "builtin-browser.events", order: 20 }],
  },
})
export class BuiltinBrowserModule {
  @Bind("builtin-browser.layer") layer = BuiltinBrowserLayer;
  @Bind("builtin-browser.events") events = builtinBrowserUserEvents;
}
