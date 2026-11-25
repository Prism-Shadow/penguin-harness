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
 * The Session lifecycle events the services publish (members of the server's `ServerEvent`
 * union — the notifier the assembly passes accepts the full union, so it satisfies these
 * narrower callback types).
 */
export type SessionServiceEvent =
  | {
      type: "session_created";
      projectId: string;
      agentId: string;
      sessionId: string;
      source: SessionSource;
    }
  | {
      type: "session_archived";
      sessionId: string;
      projectId: string;
      agentId: string;
      archived: boolean;
    };

/** A Project in the user's reach, as the archive page names it (the server's ProjectSummary, narrowed to what the page reads). */
export interface ArchiveProject {
  projectId: string;
  /** Display name (the `name` in project_config.toml); the page falls back to projectId when unset. */
  name?: string;
}
