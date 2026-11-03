/**
 * The harness's plugin surface — the `@prismshadow/penguin-server/plugin` subpath.
 *
 * The contract is `@prismshadow/penguin-core/plugin` (a plugin is a set of
 * modules) and this module does not re-export it: a plugin imports the contract from
 * core and this subpath only for what its name promises, so a package's import sites say
 * which of the two it needs — a sandbox backend, written against the sandbox vocabulary
 * and nothing else, names core alone. What the harness adds is the set of INTERFACES an
 * plugin module may require — a component class (`AgentService`, whose public surface
 * is its contract) or an abstract interface class (`extends Interface<…>()`) declared
 * beside its owner — reachable as `<module>#<Export>` in a manifest's `requires`. Types only.
 */
export type { Sandbox, SandboxSlots } from "@prismshadow/penguin-server/internal";
export type { Terminals } from "@penguinharness/plugin-terminal/server";
export type { Sessions, SessionServiceIface } from "@prismshadow/penguin-server/internal";
export type { AgentService } from "@penguinharness/plugin-agents/server";
export type { AgentConfigService } from "@penguinharness/plugin-agents/server";
export type { Messaging, MessagingSlots } from "@prismshadow/penguin-server/internal";
export type {
  PluginConfig,
  PluginConfigField,
  PluginConfiguration,
  PluginConfigSlots,
  SettingsGroupDecl,
} from "./config.js";
export type { Http, HttpSlots } from "@prismshadow/penguin-server/internal";
export type { WebShell, WebShellSlots } from "@prismshadow/penguin-server/internal";
export type { PluginCliCommands, PluginCliCommandsSlots } from "./cli-commands.js";
