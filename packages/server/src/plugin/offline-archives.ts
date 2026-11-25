import { ensurePluginPlatformPorts } from "./platform-ports.js";

// The plugin domain reads the server's platform facts (a pushed bundle's assets,
// `ifaces.json`) through ports; this import path binds them before anything loads.
ensurePluginPlatformPorts();

export * from "@prismshadow/penguin-library-plugin/offline-archives";
