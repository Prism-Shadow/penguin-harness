/**
 * The server package's CLI module: the five resource commands (agent/project/schedule/cost/config)
 * as @Component contributions to the CLI's `CliCommandsModule.commands` slot, and the
 * server-backed command code they share (connection client, stored sign-in, table renderer,
 * approval parsing, agent listing, `--root` resolution, language persistence).
 *
 * The CLI collects the contributions at boot (its generated table carries this package's
 * manifest) and imports the shared code back through this subpath; type-only DTO shapes the
 * CLI commands mention re-export here as well, so the CLI names only this subpath.
 */
export * from "./i18n.js";
export * from "./approval.js";
export * from "./agents.js";
export * from "./auth-session.js";
export {
  type Connection,
  connectionLabel,
  isLoopbackUrl,
  normalizeServerUrl,
  autoStartEntry,
  autoStartServer,
  resolveConnection,
} from "./connection.js";
export * from "./client.js";
export * from "./table.js";
export * from "./zip-folder.js";
export { resolveRootOption } from "./root-option.js";
export * from "./lang-config.js";
export * from "./commands/agent.js";
export * from "./commands/cost.js";
export * from "./commands/project.js";
export * from "./commands/schedule.js";
export * from "./commands/config.js";

// DTO shapes the CLI's own commands mention (type-only; nothing of the server loads at runtime).
export type {
  AgentSummary,
  AgentsResponse,
  BrowserBackend,
  BrowserBackendInfo,
  BuiltinBrowserExecResult,
  BuiltinBrowserHistoryEntry,
  BuiltinBrowserHistoryResponse,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSource,
  BuiltinBrowserImportSourcesResponse,
  BuiltinBrowserScanResult,
  BuiltinBrowserScreenshot,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
  BuiltinBrowserTabsResponse,
  GoalServerEvent,
  InstalledPlugin,
  InstalledPluginsResponse,
  MeResponse,
  MessagesResponse,
  ModelRefDto,
  ModelsResponse,
  OrgCalendarItem,
  OrgCalendarResponse,
  OrgCalendarWriteResponse,
  OrgChannelDetail,
  OrgChannelItem,
  OrgChannelMessage,
  OrgChannelMessagesResponse,
  OrgChannelNoticeKind,
  OrgChannelsResponse,
  OrgChartResponse,
  OrgDeskResponse,
  OrgEmployeeItem,
  OrgFinanceResponse,
  OrgHandbookFileResponse,
  OrgHandbookFilesResponse,
  OrgTicketDetail,
  OrgTicketItem,
  OrgTicketPriority,
  OrgTicketStartResponse,
  OrgTicketStatus,
  OrgTicketsResponse,
  OrganizationDetail,
  OrganizationsResponse,
  PluginCliCommandInfo,
  PluginCliCommandRunRequest,
  PluginCliCommandRunResponse,
  PluginCliCommandsResponse,
  PluginLibraryResponse,
  SessionCreateResponse,
  SessionInfo,
  SessionResponse,
  SessionsResponse,
} from "../api/types.js";
