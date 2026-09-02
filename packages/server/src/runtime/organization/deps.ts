/**
 * What the organization runtime needs from the rest of the server, as narrow interfaces:
 * the session manager (run state and task start), session creation, the Agent lifecycle,
 * usage pricing, the file store and the caches. app.ts binds the real services; tests bind
 * doubles — the same shape the schedule scheduler uses.
 */
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { ApprovalMode, ServerEvent, SessionStatus } from "../../api/types.js";
import type { OrgCacheRepo } from "../../db/repos/organizations.js";
import type { MembersRepo } from "../../db/repos/members.js";
import type { ProjectsRepo } from "../../db/repos/projects.js";
import type { SessionsRepo } from "../../db/repos/sessions.js";
import type { OrgStore } from "../../organization/store.js";
import type { ProjectConfigService } from "../../services/project-config-service.js";
import type { ErrorSink } from "../error-recorder.js";

/** The session manager as the runtime sees it: is a session busy, and start a Task on it. */
export interface OrgTaskRunner {
  statusOf(sessionId: string): SessionStatus;
  startTask(
    sessionId: string,
    input: OmniMessage[],
    opts?: { queueIfBusy?: boolean },
  ): Promise<{ sessionId: string; queued?: boolean }>;
}

/** Session creation (desk and ticket sessions are ordinary sessions of the employee's Agent). */
export interface OrgSessionCreator {
  createSession(args: {
    projectId: string;
    agentId: string;
    workspace?: string;
    modelId?: string;
    provider?: string;
    approvalMode?: ApprovalMode;
  }): Promise<{ sessionId: string; workspace: string }>;
}

/** The Agent lifecycle pieces hiring and creation need. */
export interface OrgAgentGateway {
  exists(projectId: string, agentId: string): Promise<boolean>;
  create(
    projectId: string,
    agentId: string,
    name: string | undefined,
    description: string | undefined,
    plugins: readonly string[],
  ): Promise<void>;
  /** The Agent's display name (system_config.yaml), falling back to the id. */
  displayName(projectId: string, agentId: string): Promise<string>;
  /** Replaces the Agent's AGENTS.md (the employee brief written at hire time). */
  writeAgentsMd(projectId: string, agentId: string, content: string): Promise<void>;
}

/** Cost attribution by session (UsageService.costBySession / dailyCostForSessions). */
export interface OrgUsageGateway {
  costBySession(
    projectId: string,
    sessionIds: readonly string[],
    fromTs: string,
    toTs: string,
  ): Promise<{ bySession: Map<string, number>; unpriced: boolean }>;
  dailyCostForSessions(
    projectId: string,
    sessionIds: readonly string[],
    fromTs: string,
    toTs: string,
  ): Promise<Array<{ date: string; cost: number }>>;
}

export interface OrgDeps {
  root: string;
  store: OrgStore;
  cache: OrgCacheRepo;
  projects: ProjectsRepo;
  members: MembersRepo;
  sessions: SessionsRepo;
  runner: OrgTaskRunner;
  sessionCreator: OrgSessionCreator;
  agents: OrgAgentGateway;
  projectConfig: ProjectConfigService;
  usage: OrgUsageGateway;
  errors: ErrorSink;
  /** Company-mode notifications go to the Project's owner and members (app.ts binds the user channels). */
  notifyProject: (projectId: string, event: ServerEvent) => void;
  /** The admin master switch, read per pass so a change applies without a restart. */
  companyModeEnabled: () => boolean;
  now?: () => number;
  log?: (line: string) => void;
}
