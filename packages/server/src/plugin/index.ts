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
export type { Sandbox, SandboxSlots } from "../sandbox/service.js";
export type { Terminals } from "../terminal/manager.js";
export type { Sessions, SessionServiceIface } from "../runtime/session-manager.js";
export type { HostAssembly, HostAssemblySlots } from "../services/host-assembly.js";
export type { AgentService } from "../services/agent-service.js";
export type { AgentConfigService } from "../services/agent-config-service.js";
export type {
  Messaging,
  MessagingSlots,
  MessagingTaskRunner,
} from "../runtime/messaging/bridge.js";
export type {
  MessagingChannel,
  MessagingChannelConnector,
  MessagingClient,
  MessagingConnection,
  MessagingConnectorHandlers,
  MessagingInboundFile,
  MessagingInboundImage,
  MessagingInboundMessage,
  MessagingSendOptions,
} from "../runtime/messaging/connector.js";
export type { ScheduleSessionCreator } from "../runtime/scheduler.js";
export type { ChannelEvent } from "../runtime/channel.js";
export type { Channels, Clock, Log, Paths } from "../hmr/capabilities.js";
export type { Settings } from "../mechanisms/settings.js";
export type { PluginConfig, PluginConfiguration, PluginConfigField } from "./config.js";
export type { SessionIndex } from "../mechanisms/sessions.js";
export type { AgentIndex, Projects, ProjectConfigStore } from "../mechanisms/projects.js";
export type { Errors } from "../mechanisms/observability.js";
export type { Http, HttpSlots } from "../http/app.js";
export type { WebShell, WebShellSlots } from "../http/routes/contributions.js";
export type { SessionSurfaces, SessionSurfacesSlots } from "../runtime/session-surfaces.js";
