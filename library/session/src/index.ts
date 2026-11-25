/**
 * The sessions domain as a library package: the SessionIndex, SessionDrivers,
 * SessionOrigins and Schedules mechanisms (the storage contracts the sessions and
 * schedules repos implement), the ApprovalMode vocabulary, and the runtime-facing
 * contracts (AgentState, Scheduling) the server's session runtime implements. One
 * package, no server dependencies. The repos take the Db capability from
 * @prismshadow/penguin-library-db.
 *
 * Subpaths:
 * - `.` - the mechanism contracts plus ApprovalMode, MessagingChannel and SessionInfo.
 * - `./session` - the contracts module on its own.
 * - `./ports` - the service-facing ports (the server's assembly binds them structurally).
 * - `./session-service`, `./session-deletion`, `./archived-sessions-service` - the services
 *   (moved from the server's services, services+http+cli restack S14).
 * - `./listing`, `./session-id`, `./trace-file-path`, `./system-agent`, `./sandbox-ceiling`,
 *   (workspace-group vocabulary lives in @prismshadow/penguin-library-workspace — restack S15)
 * - `./repos` (and per-file) - the storing components.
 */
export {
  SessionIndex,
  SessionDrivers,
  SessionOrigins,
  Schedules,
  AgentState,
  Scheduling,
} from "./session.js";
export type { MessagingChannel, ModelRefDto, SessionInfo } from "./session.js";
export type {
  ApprovalMode,
  RunStarter,
  SessionStatus,
  PendingSteeringInfo,
  PendingFollowUpInfo,
  SubagentRuntimeInfo,
  SessionSandbox,
  SessionSandboxMode,
  SessionSandboxNetwork,
  SessionSandboxPreset,
  UnavailableSandboxBackend,
  ApprovalReason,
  Approvals,
  ChannelEvent,
  LiveRun,
  LiveTail,
  PendingApproval,
  PendingSteeringEntry,
  QueuedFollowUp,
  RecallStore,
  RecallableFile,
  RunOpts,
  RunStart,
  RuntimeEntry,
  RuntimeSession,
  SessionBackgroundTasks,
  SwitchModelOpts,
} from "./session.js";
