/**
 * The ports the agent domain's services need from the server's assembly. The server binds
 * them to its own mechanisms (see the Provider in packages/server); the package defines the
 * shapes so it never imports the server.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type {
  AmspRecord,
  IconImage,
  LibraryPlugin,
  ThinkingLevelName,
} from "@prismshadow/penguin-core";
import type { ApprovalMode, SessionStatus } from "@prismshadow/penguin-library-session";
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
  abstract seed(picked: readonly string[], defaults: readonly Pick<LibraryPlugin, "name">[]): string[];
}

/** The plugins' server modules, brought along at the end of Agent creation (the server's `PluginModules.ensure`; the assembly binds it). */
@Interface()
export abstract class AgentPluginModules {
  /** Applies the module rule to the named library plugins; may re-assemble the App, so a caller runs it last. */
  abstract ensure(
    projectId: string,
    plugins: readonly string[],
    actor: ModuleActor | null,
    ask: "install",
    agentId?: string,
  ): Promise<unknown>;
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
  abstract resolve(
    dir: string,
    names: readonly string[],
  ): Promise<{ name: string; content: string; icon?: IconImage; files?: Record<string, string> }[]>;
}

/** The runtime's task runner, as starting a person's task needs it (the server's `Sessions` satisfies it structurally; the assembly binds it). */
@Interface()
export abstract class AgentTaskRunner {
  abstract startTask(
    sessionId: string,
    input: AmspRecord[],
    opts?: { driver?: string },
  ): Promise<{ sessionId: string }>;
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
    thinkingLevel?: ThinkingLevelName;
    approvalMode?: ApprovalMode;
  }): Promise<{ sessionId: string }>;
}

/** The latest task's outcome, as a workbench reads it (the server's `workbenchResult`; the assembly binds it). */
@Interface()
export abstract class AgentTaskOutcome {
  abstract result(
    status: string,
    messages: readonly AmspRecord[],
  ): { status: "running" | "completed" | "failed"; text: string; error: string | null };
}
