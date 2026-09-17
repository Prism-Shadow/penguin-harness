/**
 * What the organization runtime needs from the rest of the server, as narrow interfaces:
 * the session manager (run state and task start), session creation, the Agent lifecycle,
 * usage pricing, the file store and the caches. app.ts binds the real services; tests bind
 * doubles — the same shape the schedule scheduler uses.
 */
import type { OmniMessage } from "@prismshadow/penguin-core";
import { Interface } from "@prismshadow/penguin-core/kernel";
import type {
  ApprovalMode,
  MessagingChannel,
  ServerEvent,
  SessionStatus,
} from "../../api/types.js";
import type { OrgCache } from "../../mechanisms/organization.js";
import type { Members, ProjectConfigStore, Projects } from "../../mechanisms/projects.js";
import type { SessionIndex } from "../../mechanisms/sessions.js";
import type { OrgStore } from "../../organization/store.js";
import type { UtilityCompletion } from "../../services/project-config-service.js";
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

/**
 * What company mode needs of the session runtime: the task seam above, plus the runtime
 * eviction a plugin update performs (the same one the plugins route does). Declared here,
 * at the consumer, and satisfied by the wider session manager.
 */
export interface OrgRunsShape extends OrgTaskRunner {
  invalidateAgentRuntimes(projectId: string, agentId: string): void;
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
    /**
     * Always "org" here — the runtime opens no other kind of session, and the marker is
     * what keeps a desk or ticket session out of development mode's list once the
     * organization is gone. Required rather than optional so a new call site cannot
     * forget it.
     */
    client: "org";
  }): Promise<{ sessionId: string; workspace: string }>;
}

/**
 * The library plugins an employee is hired with, and the ones every reconcile pass keeps at
 * the library's version. It lives here rather than beside the hiring code because both the
 * hire and the pass reach it through the `agents` gateway below, and a module of interfaces
 * can be imported from anywhere in the runtime without a cycle.
 */
export const DEFAULT_EMPLOYEE_PLUGINS = ["agent-company", "agent-development"] as const;

/**
 * The plugins a hire is created with: the pair above, then whatever the caller asked for on
 * top, in the order given and without repeats. The extra names add rather than replace —
 * an employee hired without `agent-company` has no `company-employee` skill to follow, which
 * is exactly what the brief written at hire time tells it to do, and the pass that keeps
 * plugins current deliberately installs nothing an employee does not already carry, so
 * nothing would ever repair it.
 */
export function employeePlugins(extra: readonly string[] | undefined): string[] {
  const out: string[] = [...DEFAULT_EMPLOYEE_PLUGINS];
  for (const name of extra ?? []) if (!out.includes(name)) out.push(name);
  return out;
}

/** The Agent lifecycle pieces hiring, creation and keeping an employee's plugins current need. */
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
  /**
   * Where one library plugin stands on this Agent: the version it carries (null when it
   * carries none of the plugin) against the version the library offers (null when the library
   * has no such plugin). What the reconcile pass compares to decide whether an employee's
   * company plugins have fallen behind.
   */
  pluginVersion(
    projectId: string,
    agentId: string,
    plugin: string,
  ): Promise<{ installed: string | null; library: string | null }>;
  /** Reinstalls one library plugin over the Agent's copy — the whole-plugin update the Agents page performs. */
  updatePlugin(projectId: string, agentId: string, plugin: string): Promise<void>;
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
  cache: OrgCache;
  projects: Projects;
  members: Members;
  sessions: SessionIndex;
  runner: OrgTaskRunner;
  sessionCreator: OrgSessionCreator;
  agents: OrgAgentGateway;
  projectConfig: ProjectConfigStore;
  /**
   * One short completion on the Project's default model, for the utility asks that are not a
   * Session's work — today the semantic id a display name is translated into. A failure comes
   * back as `{ ok: false }` with the reason rather than as a bare "no answer", so the caller
   * can both record it and tell the user which way the ask fell through; every caller still
   * carries an answer that works without the model. Optional so a test binds a double or nothing.
   */
  completeOnce?: (projectId: string, prompt: string) => Promise<UtilityCompletion>;
  usage: OrgUsageGateway;
  /**
   * The channel of a Session's ENABLED messaging binding, or null when none is enabled — the
   * same reading behind `SessionInfo.messagingChannel`, so the company sidebar's desk row can
   * carry the development row's mark without the development list holding the desk.
   */
  messagingChannel: (sessionId: string) => MessagingChannel | null;
  errors: ErrorSink;
  /** Company-mode notifications go to the Project's owner and members (app.ts binds the user channels). */
  notifyProject: (projectId: string, event: ServerEvent) => void;
  /** The admin master switch, read per pass so a change applies without a restart. */
  companyModeEnabled: () => boolean;
  now?: () => number;
  log?: (line: string) => void;
}

/** What company mode needs of the session runtime — declared at the consumer (Go style). */
export abstract class OrgRuns extends Interface<OrgRunsShape>() {}
export abstract class OrgSessions extends Interface<OrgSessionCreator>() {}
