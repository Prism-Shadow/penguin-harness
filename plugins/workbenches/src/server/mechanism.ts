/**
 * Workbenches: code an Agent keeps in its own directory and the server boots as a module
 * tree of its own — the same manifests and the same tree check the platform's plugins go
 * through (`package.json#penguin.modules` + the default export of `index.ts`). Two
 * interfaces cross the boundary:
 *
 * - `WorkbenchHost` is what the server PUBLISHES into every workbench tree (the workbench's
 *   manifest requires it `from: "Host"`): Sessions of the Project's Agents, opened and run
 *   the way the SDK does it, a small state document, a log line.
 * - `WorkbenchMain` is what a workbench PROVIDES: a JSON request handler the server mounts
 *   under `/api/projects/:p/agents/:a/workbenches/:id/api/*`, which the workbench's own UI
 *   (served from its `ui/` folder) calls.
 *
 * `Workbenches` is the platform-side mechanism the routes drive: list, reload, dispatch,
 * serve a UI file, and the version history every successful load appends to — which is
 * what makes an Agent's own edits to its workbench reversible.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type {
  WorkbenchInfo,
  WorkbenchRequest,
  WorkbenchResponse,
  WorkbenchTab,
  WorkbenchTabRenderer,
} from "@prismshadow/penguin-server/api";
export type { WorkbenchInfo, WorkbenchRequest, WorkbenchResponse, WorkbenchTab, WorkbenchTabRenderer } from "@prismshadow/penguin-server/api";

/** A version of a workbench: a commit of the Agent State repository that changed its folder. */
export interface WorkbenchVersion {
  /** The folder's revision at that commit (`WorkbenchInfo.revision` when it was loaded). */
  revision: string;
  /** The commit (12 hex) in `<agentDir>/agent_state.git`. */
  commit: string;
  savedAt: string;
}

/** One file the workbench's `ui/` serves: the one on disk, or what a TSX page compiled to. */
export interface WorkbenchUiFile {
  /** Where the file's bytes live. */
  path: string;
  /** The import map + stylesheet the page is served with, when it is a page. */
  compiled: { imports: Record<string, string>; stylesheet: string } | null;
}

/**
 * What the HTML of a compiled page is served with: the page runtime's import map and its
 * stylesheet, each a file of the runtime (`…/workbenches/:id/sdk/ui/<file>`).
 */
export interface WorkbenchUiRuntime {
  /** Bare specifier → the runtime file it loads. */
  imports: Record<string, string>;
  stylesheet: string;
}

/** A file of this server's page runtime, with a strong validator of its bytes. */
export interface WorkbenchUiRuntimeFile {
  body: Uint8Array;
  etag: string;
}

/**
 * One item of what `WorkbenchHost.run` sends: the SDK builds these with `userText("…")`, but a
 * workbench has no package to import that from — its types come from the harness, and so does
 * nothing at run time. An object, so an image or a file is a new optional member later.
 */
export interface WorkbenchInput {
  text: string;
}

/** The latest task's final answer; idle alone does not mean a task succeeded. */
export interface WorkbenchResult {
  status: "running" | "completed" | "failed";
  text: string;
  error: string | null;
}

/**
 * One AMSP record as `WorkbenchHost.subscribe` hands it over: the envelope every Trace line and
 * every server event rides in (its `payload` names the kind and carries it, `origin` chains a
 * subagent's line to its parent).
 */
export interface WorkbenchRecord {
  /** ISO 8601 UTC. */
  timestamp: string;
  type: string;
  payload: { type?: string; [key: string]: unknown };
  origin?: string[];
}

/** What a workbench provides (its manifest: `provides: { main: "@prismshadow/penguin-server#WorkbenchMain" }`). */
@Interface()
export abstract class WorkbenchMain {
  abstract handle(request: WorkbenchRequest): Promise<WorkbenchResponse>;
}

/** What the server publishes into a workbench tree as module `Host`. */
@Interface()
export abstract class WorkbenchHost {
  /** The Agents of this Project — who `createSession` can be asked to open a Session of. */
  abstract listAgents(): { agentId: string }[];
  /**
   * Opens a Session of an Agent of this Project — the workbench's own Agent when `agentId`
   * is absent. The SDK's `agent.createSession`.
   */
  abstract createSession(opts?: { agentId?: string }): Promise<{ sessionId: string }>;
  /**
   * Runs one turn in a Session of this Project, new or existing — the SDK's `session.run`.
   * `input` is a list of items like the SDK's, each one `{ text }` today; it reaches the
   * Agent as a message from the server, not from a person. A Session that is busy takes it as a queued follow-up
   * (`queued: true`) instead of refusing it. Resolves once the turn has started; watch it
   * with `sessionResult`.
   */
  abstract run(
    sessionId: string,
    input: WorkbenchInput[],
  ): Promise<{ sessionId: string; queued: boolean }>;
  /** `idle` / `running` / … of a Session of this Project. */
  abstract sessionStatus(sessionId: string): string;
  /** The Session's generated or user-edited title; null until one is available. */
  abstract sessionTitle(sessionId: string): string | null;
  /** A snapshot, not a wait: running until the latest task ends, then its final answer or failure. No tool or thinking messages. */
  abstract sessionResult(sessionId: string): Promise<WorkbenchResult>;
  /**
   * Follows a Session of this Project live: `listener` receives each record the Session
   * publishes from now on — exactly the records `GET /api/sessions/:id/amsp` streams, partial
   * deltas and a subagent's (`origin`) included. Nothing is replayed, so subscribe before
   * `run`. Returns the unsubscribe function; calling it again does nothing. A listener runs
   * after the publish, never inside it, records in order; one that throws is logged and the
   * subscription carries on. A main `task_end` (no `origin`) arrives before the Session reads
   * idle, and `sessionResult` answers `running` until it does. Every subscription ends with the
   * workbench's tree (a reload, a removal), and one whose Session has sat idle with nothing
   * published for the channel hub's idle window ends by itself.
   */
  abstract subscribe(sessionId: string, listener: (record: WorkbenchRecord) => void): () => void;
  /** The workbench's own document (`state.json`, kept by the server across reloads and rollbacks). */
  abstract getState(): unknown;
  abstract setState(state: unknown): Promise<void>;
  abstract log(message: string): void;
}

@Interface()
export abstract class Workbenches {
  abstract list(projectId: string, agentId: string): Promise<WorkbenchInfo[]>;
  abstract reload(projectId: string, agentId: string, workbenchId: string): Promise<WorkbenchInfo>;
  abstract dispatch(
    projectId: string,
    agentId: string,
    workbenchId: string,
    request: WorkbenchRequest,
  ): Promise<WorkbenchResponse>;
  /**
   * A file of the workbench's `ui/`: the one on disk, else — for a `.js` a TSX page compiles
   * to — what the serving instance emitted. Null when absent or unsafe.
   */
  abstract uiFile(
    projectId: string,
    agentId: string,
    workbenchId: string,
    rel: string,
  ): Promise<WorkbenchUiFile | null>;
  /**
   * A file of the page runtime this server serves compiled pages with (React and the shared
   * components), under a workbench that exists; null otherwise.
   */
  abstract uiRuntimeFile(
    projectId: string,
    agentId: string,
    workbenchId: string,
    rel: string,
  ): Promise<WorkbenchUiRuntimeFile | null>;
  abstract history(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<WorkbenchVersion[]>;
  abstract rollback(
    projectId: string,
    agentId: string,
    workbenchId: string,
    revision: string,
  ): Promise<WorkbenchInfo>;
  /** Deletes the folder and its recorded versions; the instance goes with them. */
  abstract remove(projectId: string, agentId: string, workbenchId: string): Promise<void>;
  /**
   * Lets go of everything held for one Agent before its folder is deleted or its State is
   * replaced: the folder watcher, pending reloads, loads in flight and the loaded instances. A
   * later listing takes them up again, so an Agent whose deletion is then refused loses nothing.
   */
  abstract releaseAgent(projectId: string, agentId: string): Promise<void>;
  /**
   * Runs `work` (an Agent State import) with the Agent's workbenches released as by
   * `releaseAgent` and kept so until it settles: a request for them meanwhile waits for the end
   * instead of watching or loading the directory being replaced.
   */
  abstract whileReleased<T>(projectId: string, agentId: string, work: () => Promise<T>): Promise<T>;
}
