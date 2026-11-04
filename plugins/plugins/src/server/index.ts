/** The plugins group's server half: the plugin system with the plugin routes and the package archive service. */
export * from "./plugin/host.js";
export * from "./plugin/loader.js";
export * from "./plugin/registry.js";
export * from "./plugin/install.js";
export * from "./plugin/skills.js";
export * from "./plugin/source.js";
export * from "./plugin/typescript.js";
export * from "./plugin/unsatisfied.js";
export * from "./plugin/config.js";
export * from "./plugin/config-page.js";
export * from "./plugin/cli-commands.js";
export * from "./plugin/iface-check.js";
export type {
  Sandbox,
  SandboxSlots,
} from "@penguinharness/plugin-sandbox/server";
export type {
  Sessions,
  SessionServiceIface,
  Messaging,
  MessagingSlots,
  Http,
  HttpSlots,
  WebShell,
  WebShellSlots,
} from "@prismshadow/penguin-server/internal";
export type { Terminals } from "@penguinharness/plugin-terminal/server";
export type { AgentService, AgentConfigService } from "@penguinharness/plugin-agents/server";
export type {
  PluginConfig,
  PluginConfigField,
  PluginConfiguration,
  PluginConfigSlots,
  SettingsGroupDecl,
} from "./plugin/config.js";
export type { PluginCliCommands, PluginCliCommandsSlots } from "./plugin/cli-commands.js";
export type { PluginsRouteDeps } from "./routes/plugins.js";
export { pluginLibraryRoutes, agentPluginsRoutes, agentMcpServersRoutes, PluginRoutes, pluginRegistryRoutes, PluginRegistryRoutes } from "./routes/plugins.js";
export * from "./mechanism.js";
export type { PluginRoutesOptions } from "./routes/plugins.js";
export { pluginUiRoutes, PluginUiRoutes } from "./routes/plugin-ui.js";
export { installedPluginRoutes, InstalledPluginRoutes } from "./routes/plugins-installed.js";
export { adminPluginConfigRoutes } from "./routes/admin-plugin-config.js";
export { MAX_PLUGIN_ARCHIVE_BYTES, MAX_PLUGIN_ARCHIVE_FILES, MAX_PLUGIN_FILE_BYTES } from "./services/plugin-archive.js";
