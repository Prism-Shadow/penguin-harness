/**
 * Agent tasks a server module starts as a person (PRFC-0036 `AgentTasks`): the plugin builds the
 * request on the server and the task runs as if that person had typed it into a new chat and
 * pressed Send. It takes the same steps as the Web App's Send, `POST …/agents/:a/sessions` then
 * `POST /api/sessions/:id/tasks` (http/routes/sessions.ts):
 *
 * - the person must reach the Project (404 `project_not_found`) and the Agent must exist (404);
 * - the Session is opened through the one creation path every surface takes, so the system Agent
 *   is refused there (409 `system_agent_no_sessions`), and the model is the given pair or the
 *   Project's default (400 `no_default_model` when there is none);
 * - no Workspace is named, so the Session gets a fresh temporary one, as a new chat does;
 * - the Skills are preselected with a `[use_skills]` block in front of the person's text, the
 *   composer's chip row;
 * - the run's driver is the person (SessionDrivers), and the Session's source is `user`: it is
 *   the person's own conversation — in their sidebar, with the approval badge and the completion
 *   notice of any chat they start;
 * - the approval mode is the caller's, one of the four a new chat offers.
 *
 * It knows nothing of what the task is for. A route that starts one checks `requireHuman` first,
 * so an Agent's token cannot start a person's task.
 *
 * `status` reads one back for the person: running (with the approvals it waits on), completed,
 * or failed — the latest task's outcome as a workbench reads it (workbenches/result.ts) — or null
 * for a Session that is gone or that the person cannot read.
 */
import { buildSkillsMessage } from "@prismshadow/amsp/markers";
import { isValidId, THINKING_LEVEL_NAMES, userText } from "@prismshadow/penguin-core";
import type { ThinkingLevelName } from "@prismshadow/penguin-core";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { Access, ProjectEvents } from "@prismshadow/penguin-library-project";
import type {
  ApprovalMode,
  SessionDrivers,
  SessionIndex,
} from "@prismshadow/penguin-library-session";
import type { Traces } from "@prismshadow/penguin-library-trace";
import { badRequest } from "../http/errors.js";
import { APPROVAL_MODES } from "../http/routes/sessions.js";
import { sessionTitle } from "../http/session-title.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import type { Sessions, SessionServiceIface } from "../runtime/session-manager.js";
import { workbenchResult } from "../workbenches/result.js";

/** One task to start, as `userId` would start it from a new chat. */
export interface AgentTaskStart {
  /** The person the task acts for: its driver, and whose conversation it is. */
  userId: string;
  projectId: string;
  agentId: string;
  /** The person's message, sent as it is. */
  prompt: string;
  /** One of the four a new chat offers: `allow-all`, `deny-all`, `read-only`, `always-ask`. */
  approvalMode: ApprovalMode;
  /** Skills preselected for the run (the composer's `[use_skills]` block); none when absent. */
  skills?: string[];
  /** The model as a pair; the Project's default model when absent. */
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevelName;
  /** The conversation's title; absent, it is titled from the first message as any chat is. */
  title?: string;
}

/** Where a started task is: still going, or how its latest run ended. */
export type AgentTaskState = "running" | "completed" | "failed";

export interface AgentTaskStatus {
  status: AgentTaskState;
  /** The Session's title; null until it has one. */
  title: string | null;
  /** Tool calls waiting on the person's approval (a command-policy `ask` step under any mode). */
  pendingApprovals: number;
}

/** AgentTasks: what HostAgentTasks implements, and a server module reaches through the plugin face. */
@Interface()
export abstract class AgentTasks {
  /** Opens the conversation and starts the task in it (see the module header). */
  abstract start(task: AgentTaskStart): Promise<{ sessionId: string }>;
  /** The task's state for `userId`, or null when the Session is gone or theirs to read no longer. */
  abstract status(userId: string, sessionId: string): Promise<AgentTaskStatus | null>;
}

/** A non-empty string, or the 400 naming the field. */
function required(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${field} must be a non-empty string.`);
  }
  return value;
}

/** The task as the steps below take it; every field a caller can get wrong is a 400. */
function checked(task: AgentTaskStart): AgentTaskStart {
  const out: AgentTaskStart = {
    userId: required(task.userId, "userId"),
    projectId: required(task.projectId, "projectId"),
    agentId: required(task.agentId, "agentId"),
    prompt: required(task.prompt, "prompt"),
    approvalMode: task.approvalMode,
  };
  if (!isValidId(out.projectId) || !isValidId(out.agentId)) {
    throw badRequest("projectId and agentId must be letters, digits, '_' and '-' only.");
  }
  if (!APPROVAL_MODES.includes(task.approvalMode)) {
    throw badRequest(`approvalMode must be one of ${APPROVAL_MODES.join(", ")}.`);
  }
  if (task.skills !== undefined) {
    if (
      !Array.isArray(task.skills) ||
      task.skills.some((s) => typeof s !== "string" || !isValidId(s))
    ) {
      throw badRequest("skills must be Skill names: letters, digits, '_' and '-' only.");
    }
    out.skills = [...new Set(task.skills)];
  }
  if (task.model !== undefined) {
    out.model = {
      provider: required(task.model?.provider, "model.provider"),
      modelId: required(task.model?.modelId, "model.modelId"),
    };
  }
  if (task.thinkingLevel !== undefined) {
    if (!THINKING_LEVEL_NAMES.includes(task.thinkingLevel)) {
      throw badRequest(`thinkingLevel must be one of ${THINKING_LEVEL_NAMES.join(", ")}.`);
    }
    out.thinkingLevel = task.thinkingLevel;
  }
  if (task.title !== undefined) out.title = sessionTitle(task.title);
  return out;
}

@Component()
export class HostAgentTasks implements AgentTasks {
  @Use() private readonly access!: Access;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly manager!: Sessions;
  @Use() private readonly drivers!: SessionDrivers;
  @Use() private readonly sessionIndex!: SessionIndex;
  @Use() private readonly projectEvents!: ProjectEvents;
  @Use() private readonly traces!: Traces;

  async start(raw: AgentTaskStart): Promise<{ sessionId: string }> {
    const task = checked(raw);
    this.access.requireProjectAccess(task.userId, task.projectId);
    await this.agentConfig.requireExists(task.projectId, task.agentId);
    const session = await this.sessionService.createSession({
      projectId: task.projectId,
      agentId: task.agentId,
      ...(task.model !== undefined
        ? { provider: task.model.provider, modelId: task.model.modelId }
        : {}),
      ...(task.thinkingLevel !== undefined ? { thinkingLevel: task.thinkingLevel } : {}),
      approvalMode: task.approvalMode,
    });
    if (task.title !== undefined) {
      // As a rename does: the automatic title only ever fills an empty one.
      this.sessionIndex.updateTitle(session.sessionId, task.title);
      this.projectEvents.notifyProjectUsers(task.projectId, {
        type: "session_title",
        sessionId: session.sessionId,
        title: task.title,
      });
    }
    const text = buildSkillsMessage(task.skills ?? [], task.prompt);
    this.drivers.note(session.sessionId, task.userId);
    const { sessionId } = await this.manager.startTask(session.sessionId, [userText(text)]);
    // A Session that healed into a new id on start is the same conversation, driven alike.
    if (sessionId !== session.sessionId) this.drivers.note(sessionId, task.userId);
    return { sessionId };
  }

  async status(userId: string, sessionId: string): Promise<AgentTaskStatus | null> {
    const row = this.sessionIndex.findById(sessionId);
    if (row === null || !this.access.canAccess(userId, row.projectId)) return null;
    const state = this.manager.statusOf(sessionId);
    const pendingApprovals = this.manager.pendingApprovalCount(sessionId);
    if (state !== "idle") return { status: "running", title: row.title, pendingApprovals };
    const messages = await this.traces.readMessages(row.projectId, row.agentId, sessionId);
    // A task that begins while the Trace is read is running, whatever its predecessor said.
    const result = workbenchResult(this.manager.statusOf(sessionId), messages);
    return {
      status: result.status,
      title: this.sessionIndex.findById(sessionId)?.title ?? row.title,
      pendingApprovals,
    };
  }
}
