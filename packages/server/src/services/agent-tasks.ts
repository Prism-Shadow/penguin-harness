/**
 * The person's-task runner moved to the agent domain package
 * (@prismshadow/penguin-library-agent/agent-tasks, services+http+cli restack S10) — the request
 * vocabulary, the checks and the implementation speak library vocabulary, and the session
 * runtime, the session creation path and the task-outcome reader reach it as structural ports.
 * This file keeps the assembly: the provider binds those ports to the server's own mechanisms
 * and provides the AgentTasks mechanism, and re-exports the moved shapes for the server's own
 * import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Access, ProjectEvents } from "@prismshadow/penguin-library-project";
import type { SessionDrivers, SessionIndex } from "@prismshadow/penguin-library-session";
import type { Traces } from "@prismshadow/penguin-library-trace";
import type { AgentConfig } from "../mechanisms/agents.js";
import type { SessionServiceIface, Sessions } from "../runtime/session-manager.js";
import { workbenchResult } from "../workbenches/result.js";
import { AgentTasks, HostAgentTasks } from "@prismshadow/penguin-library-agent/agent-tasks";

export { AgentTasks, HostAgentTasks } from "@prismshadow/penguin-library-agent/agent-tasks";
export type {
  AgentTaskStart,
  AgentTaskState,
  AgentTaskStatus,
} from "@prismshadow/penguin-library-agent/agent-tasks";

/** The person's-tasks assembly: binds the service's session-runtime ports. */
@Module()
export class HostAgentTasksProvider {
  @Use() private readonly access!: Access;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly sessionIndex!: SessionIndex;
  @Use() private readonly drivers!: SessionDrivers;
  @Use() private readonly projectEvents!: ProjectEvents;
  @Use() private readonly traces!: Traces;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly manager!: Sessions;
  @Provide() agentTasks!: AgentTasks;
  @Provide() service!: HostAgentTasks;

  setup() {
    // The service's ports are decorator-injected fields; the server binds them by hand here.
    const sessionService = this.sessionService;
    const manager = this.manager;
    this.service = Object.assign(new HostAgentTasks(), {
      access: this.access,
      agentConfig: this.agentConfig,
      sessionService: {
        createSession: (
          args: Parameters<SessionServiceIface["createSession"]>[0],
        ): Promise<{ sessionId: string }> => sessionService.createSession(args),
      },
      manager: {
        startTask: (
          sessionId: string,
          input: Parameters<Sessions["startTask"]>[1],
          opts?: { driver?: string },
        ): Promise<{ sessionId: string }> => manager.startTask(sessionId, input, opts),
        statusOf: (sessionId: string) => manager.statusOf(sessionId),
        pendingApprovalCount: (sessionId: string) => manager.pendingApprovalCount(sessionId),
      },
      drivers: this.drivers,
      sessionIndex: this.sessionIndex,
      projectEvents: this.projectEvents,
      traces: this.traces,
      outcome: {
        result: (status: string, messages: Parameters<typeof workbenchResult>[1]) =>
          workbenchResult(status, messages),
      },
    });
    this.agentTasks = this.service;
  }
}
