/**
 * The ports the session domain's services need from the server's assembly. The server binds
 * them to its own mechanisms (see the Providers and construction sites in packages/server);
 * the package defines the shapes so it never imports the server.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { ModelRef } from "@prismshadow/penguin-core";
import type { SessionSource } from "@prismshadow/amsp";
import type {
  ModelRefDto,
  RuntimeSession,
  SessionBackgroundTasks,
  SessionStatus,
} from "./session.js";
import type { SessionRow } from "./repos/sessions.js";

/**
 * The session runtime's view the services read and adopt through — the server's SessionManager
 * satisfies this structurally. `adopt` puts a just-created Session's runtime into the active
 * table; the reads back the list DTO's live fields (status, pending counts, the model handoff
 * target) and `noticeModelConfigEdit` tells the runtime the Project's model config moved under
 * a runtime it is about to build.
 */
@Interface()
export abstract class SessionRuntimes {
  abstract adopt(row: SessionRow, session: RuntimeSession): void;
  abstract statusOf(sessionId: string): SessionStatus;
  abstract pendingApprovalCount(sessionId: string): number;
  abstract pendingFollowUpCount(sessionId: string): number;
  abstract backgroundTasksOf(sessionId: string): SessionBackgroundTasks | undefined;
  abstract pendingModel(sessionId: string): ModelRefDto | undefined;
  abstract noticeModelConfigEdit(projectId: string): Promise<void>;
}

/**
 * Where a Project's default model reference lives. The server's `ProjectConfigStore` satisfies
 * this structurally (the trace domain's pricing port is the same shape of port).
 */
@Interface()
export abstract class SessionDefaultModel {
  /** The Project's current default model reference; undefined when it has none (400 `no_default_model`). */
  abstract getDefaultModelRef(projectId: string): Promise<ModelRef | undefined>;
}

/**
 * The Session lifecycle events the services publish: the session domain's members of the
 * server's `ServerEvent` union (the project domain's `ServerEvent` reuses these same members,
 * so the two cannot drift; the notifier the assembly passes accepts the full union, so it
 * satisfies this narrower callback type).
 */
export type SessionServiceEvent =
  | SessionCreatedEvent
  | SessionArchivedEvent
  | SessionDeletedEvent
  | SessionTitleEvent
  | SessionStateEvent
  | SessionBackgroundEvent
  | SessionApprovalsEvent;

/**
 * A Session now exists. On the user channel for every creation — the CLI, another tab,
 * a schedule, an agent spawning a child — so the list learns about rows it did not make;
 * and on the parent Session's channel for a subagent, which no list shows. `source` is what
 * the new Session's meta records, and it tells a client which list, if any, the row joins.
 */
export type SessionCreatedEvent = {
  type: "session_created";
  projectId: string;
  agentId: string;
  sessionId: string;
  source: SessionSource;
};

/**
 * The user's listing decision on one Session changed (PATCH `archived`, the archive page's
 * batch unarchive): an archived row leaves the sidebar, an unarchived one joins it. One per
 * Session, to the Project's users.
 */
export type SessionArchivedEvent = {
  type: "session_archived";
  sessionId: string;
  projectId: string;
  agentId: string;
  archived: boolean;
};

/**
 * A Session was deleted (DELETE, the subagent children deleted with it, the archive page's
 * batch delete): every client drops the row. One per Session, to the Project's users.
 */
export type SessionDeletedEvent = { type: "session_deleted"; sessionId: string; projectId: string };

/** The model-generated title after the first turn has been persisted (for in-place list updates). */
export type SessionTitleEvent = { type: "session_title"; sessionId: string; title: string };

/**
 * The user-channel counterpart of `task_state`: the same run-state flip, named by
 * `sessionId`, delivered on GET /api/events.
 *
 * `task_state` is session-scoped and deliberately carries no id, so it only ever reaches the
 * one conversation a tab has subscribed to — every OTHER row in that tab's Session list would
 * otherwise keep whatever status its last list fetch returned. This event exists so the list
 * can stay live without polling; the per-Session contract is unchanged.
 *
 * `lastActiveAt` and `hasTrace` are the row's own fields as they stand after the flip, both
 * written just before publishing (`markDriven` at run start sets has_trace and stamps
 * last_active_at; `touchLastActive` stamps again at run end). They are what let a list act on
 * the flip without refetching: the stamp separates "this finished while I was looking
 * elsewhere" from "this finished before I last looked", and `hasTrace` separates a Session
 * that has now run from one that never has — a first run would otherwise settle back into the
 * blank "never ran" row the client still believes in.
 *
 * `projectId` names the Session's Project: a list showing one Project ignores another's flips
 * without a request, and a flip for a Session of its own Project that it holds no row for is a
 * row it is missing — one that became active below its activity cursor (see SessionsResponse) —
 * which it fetches by id.
 *
 * Published only to the user channels of the Project's owner and members.
 */
export type SessionStateEvent = {
  type: "session_state";
  sessionId: string;
  projectId: string;
  state: SessionStatus;
  lastActiveAt: string;
  hasTrace: boolean;
};

/**
 * A Session's background-task counts changed: a command promoted to the background, a
 * process that exited or was stopped, a background subagent starting or settling a round,
 * a released session. The counts are the row's `backgroundTasks` as they stand after the
 * change — zeros included, so a list can clear its mark without refetching. Published to
 * the user channels of the Project's owner and members, like `session_state`.
 */
export type SessionBackgroundEvent = {
  type: "session_background";
  sessionId: string;
  processes: number;
  subagents: number;
};

/**
 * A Session's count of tool calls waiting for a person's approval changed: a call was
 * escalated (every call under always-ask, rw/unknown calls under read-only), answered, or
 * denied by an interrupt. The count is the row's `pendingApprovalCount` as it stands after
 * the change, zeros included, so a list moves its mark without refetching; the calls
 * themselves are on the Session's own stream (`approval_request`, replayed on subscribe).
 * Published to the user channels of the Project's owner and members, like `session_state`.
 */
export type SessionApprovalsEvent = { type: "session_approvals"; sessionId: string; count: number };

/** The user's role in a Project (the project domain's ProjectRole, restated — the session domain does not import the project domain). */
export type ProjectRole = "owner" | "member";

/** A Project in the user's reach, as the archive page names it (the server's ProjectSummary). */
export interface ProjectSummary {
  projectId: string;
  /** Display name (the `name` in project_config.toml); the page falls back to projectId when unset. */
  name?: string;
  /** Current user's role in this Project. */
  role: ProjectRole;
  ownerUserId: string;
  createdAt: string;
}
