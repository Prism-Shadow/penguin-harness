/**
 * The builtin browser group's server half: the browser module, its extension
 * WebSocket attach point and the routes, exported for the server's composition root.
 */
export * from "./repos/browser-extensions.js";
export { BuiltinBrowserModule } from "./builtin-browser/module.js";
export { attachExtensionWebSocket } from "./builtin-browser/extension-ws.js";
export type { ExtensionGate } from "./builtin-browser/extension-ws.js";
