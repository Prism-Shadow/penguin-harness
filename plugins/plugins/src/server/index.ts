/** The plugins group's server half: the plugin system with the plugin routes and the package archive service. */
export * from "./plugin";
export { PluginsRouteDeps, pluginLibraryRoutes, agentPluginsRoutes, agentMcpServersRoutes, PluginRoutes, PluginRoutesOptions, pluginRegistryRoutes, PluginRegistryRoutes } from "./routes/plugins.js";
export type { PluginsRouteDeps, PluginRoutesOptions } from "./routes/plugins.js";
export { pluginUiRoutes, PluginUiRoutes } from "./routes/plugin-ui.js";
export { installedPluginRoutes, InstalledPluginRoutes } from "./routes/plugins-installed.js";
export { adminPluginConfigRoutes } from "./routes/admin-plugin-config.js";
export { MAX_PLUGIN_ARCHIVE_BYTES, MAX_PLUGIN_ARCHIVE_FILES, MAX_PLUGIN_FILE_BYTES } from "./services/plugin-archive.js";
