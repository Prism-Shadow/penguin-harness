/**
 * The ports the agent domain's services need from the server's assembly. The server binds
 * them to its own mechanisms (see the Provider in packages/server); the package defines the
 * shapes so it never imports the server.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { WorkbenchResult } from "@prismshadow/penguin-library-workbench";
import type {
  AmspRecord,
  LibraryPlugin,
  SessionSource,
  ThinkingLevelName,
} from "@prismshadow/penguin-core";
import type { DirectorySkill } from "@prismshadow/penguin-library-workspace/directory-skills";
import type {
  ApprovalMode,
  RecallStore,
  SessionInfo,
  SessionSandbox,
  SessionStatus,
} from "@prismshadow/penguin-library-session";
import type { ModuleActor } from "./types.js";

/** Where the harness root is. The server's `Paths` capability satisfies this structurally. */
@Interface()
export abstract class AgentPaths {
  abstract root: string;
}

/** The snapshots service's log surface: one line at a time (the server's `Log` satisfies it). */
@Interface()
export abstract class SnapshotLog {
  abstract line(text: string): void;
}

/** The snapshots service's clock (the server's `Clock` satisfies it). */
@Interface()
export abstract class SnapshotClock {
  abstract now(): Date;
}

/** Where the harness root is, for the snapshots service (the server's `Paths` satisfies it). */
@Interface()
export abstract class SnapshotPaths {
  abstract root: string;
}

/** The built-in plugin library, as AgentService reads it: the seed list, a lookup and the default-install plugins (the server's `PluginLibrary` satisfies it structurally; the assembly binds it). */
@Interface()
export abstract class AgentPluginLibrary {
  abstract list(): LibraryPlugin[];
  abstract get(name: string): LibraryPlugin | undefined;
  abstract defaultInstalled(): LibraryPlugin[];
  /** Resolves plugin names to their entries, in the order given; 404 `unknown_plugin` on the first name the library does not carry (the server's `resolveLibraryPlugins`). */
  abstract resolve(names: readonly string[]): LibraryPlugin[];
  /** The picked names in pick order, then each default-install plugin's name not among them (the server's `seedPluginNames`). */
  abstract seed(
    picked: readonly string[],
    defaults: readonly Pick<LibraryPlugin, "name">[],
  ): string[];
}

/** Writes a library plugin onto an Agent's Agent State — its skills, hook package, workbenches and MCP servers, whole or refused (the server binds core's installPlugin: it reads the plugin library through the host the server names, so the write runs on the server's own core copy). */
@Interface()
export abstract class AgentPluginInstaller {
  /** The write with a taken MCP server name translated: creating an Agent answers the creator's choice with 409 `mcp_server_name_taken`. */
  abstract install(
    root: string,
    projectId: string,
    agentId: string,
    plugin: LibraryPlugin,
  ): Promise<void>;
  /** The same write with core's own error left bare: a plugin update's caller reads the `McpServerNameTakenError` (the holder's server, agent and ownership on it), as the whole-plugin update's contract spells. */
  abstract installBare(
    root: string,
    projectId: string,
    agentId: string,
    plugin: LibraryPlugin,
  ): Promise<void>;
}

/** What one install, or one explicit ask, did about a plugin's server module (the server's `PluginModuleAction`, api/types.ts). */
export interface AgentPluginModuleAction {
  plugin: string;
  /**
   * `enabled`: listed for this Project on this server, and running (or waiting for a restart);
   * `requested`: an administrator is asked; `blocked`: the administrator stopped this module;
   * `failed`: listed, and the module did not start (`reason`) — when the App would not boot with
   * it, the listing was undone.
   */
  action: "enabled" | "requested" | "blocked" | "failed";
  reason?: string;
}

/** The plugins' server modules, brought along at the end of Agent creation (the server's `PluginModules.ensure`; the assembly binds it). */
@Interface()
export abstract class AgentPluginModules {
  /** Applies the module rule to the named library plugins; may re-assemble the App, so a caller runs it last. Never throws for one plugin: what went wrong is that plugin's `failed` action. */
  abstract ensure(
    projectId: string,
    plugins: readonly string[],
    actor: ModuleActor | null,
    ask: "install" | "explicit",
    agentId?: string,
  ): Promise<AgentPluginModuleAction[]>;
}

/** The one-time steps an Agent's workbenches need before what they hold is counted, listed or installed (the server's workbenches migration; the assembly binds it). */
@Interface()
export abstract class AgentWorkbenches {
  abstract migrate(agentDir: string): Promise<void>;
}

/** The Skills a creator picked from a directory, resolved to what `installSkill` writes (the server's directory-skills resolver; the assembly binds it). */
@Interface()
export abstract class AgentDirectorySkills {
  /** 404 `unknown_skill` on a name the directory does not carry. */
  abstract resolve(dir: string, names: readonly string[]): Promise<DirectorySkill[]>;
}

/** The runtime's task runner, as starting a person's task needs it (the server's `Sessions` satisfies it structurally; the assembly binds it). */
@Interface()
export abstract class AgentTaskRunner {
  abstract startTask(
    sessionId: string,
    input: AmspRecord[],
    opts?: {
      queueIfBusy?: boolean;
      interrupt?: boolean;
      steerIfBusy?: boolean;
      recall?: RecallStore;
      promptHooks?: readonly string[];
      /**
       * The signed-in person sending it: the driver of the run it starts — now, or when it leaves
       * the queue (RuntimeEntry.runDriver). Absent for everything nobody signed in sent: the local
       * API token, schedules without a creator, the Agent API, company mode, the bridge.
       */
      driver?: string;
    },
  ): Promise<{ sessionId: string; queued: boolean; steered?: boolean }>;
  abstract statusOf(sessionId: string): SessionStatus;
  abstract pendingApprovalCount(sessionId: string): number;
}

/** Opens the conversation a task runs in (the server's `SessionServiceIface.createSession` subset; the assembly binds it). */
@Interface()
export abstract class AgentTaskSessions {
  abstract createSession(args: {
    projectId: string;
    agentId: string;
    modelId?: string;
    provider?: string;
    workspace?: string;
    thinkingLevel?: ThinkingLevelName;
    approvalMode?: ApprovalMode;
    /** The composer's sandbox picks; omitted halves take the server's settings. */
    sandbox?: Partial<SessionSandbox>;
    /** Whether the creator is an administrator (may loosen past the settings). Default false. */
    isAdmin?: boolean;
    /** What kind of conversation this is, recorded in the Session's session_meta; absent means `user`, a person's conversation. */
    source?: SessionSource;
    /** Creating-client hint stored on the index row; the organization runtime and the Agent API are the only callers that pass "org" and "api". */
    client?: "web" | "cli" | "org" | "api" | "workbench";
  }): Promise<SessionInfo>;
}

/** The latest task's outcome, as a workbench reads it (the server's `workbenchResult`; the assembly binds it). */
@Interface()
export abstract class AgentTaskOutcome {
  abstract result(status: string, messages: readonly AmspRecord[]): WorkbenchResult;
}
