/**
 * Workflows: code an Agent keeps in its own directory and the server boots as a module
 * tree of its own — the same manifests, the same interface check and the same
 * `Plugin` shape (`package.json#penguin.modules` + a default export) the platform's plugins
 * use. Two interfaces cross the boundary:
 *
 * - `WorkflowHost` is what the server PUBLISHES into every workflow tree (the workflow's
 *   manifest requires it `from: "Host"`): a way to run its own Agent, a small state
 *   document, a log line.
 * - `WorkflowMain` is what a workflow PROVIDES: a JSON request handler the server mounts
 *   under `/api/projects/:p/agents/:a/workflows/:id/api/*`, which the workflow's own UI
 *   (served from its `ui/` folder) calls.
 *
 * `Workflows` is the platform-side mechanism the routes drive: list, reload, dispatch,
 * serve a UI file, and the version history every successful load appends to — which is
 * what makes an Agent's own edits to its workflow reversible.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** A JSON request the workflow's handler receives (the HTTP shape, minus the transport). */
export interface WorkflowRequest {
  method: string;
  /** Path below the workflow's `api/` mount, always starting with `/`. */
  path: string;
  query: Record<string, string>;
  body: unknown;
}

export interface WorkflowResponse {
  /** HTTP status; 200 when absent. */
  status?: number;
  /** JSON body; `null` when absent. */
  body?: unknown;
}

/** What a workflow provides (its manifest: `provides: { main: "@prismshadow/penguin-server#WorkflowMain" }`). */
@Interface()
export abstract class WorkflowMain {
  abstract handle(request: WorkflowRequest): Promise<WorkflowResponse>;
}

/** What the server publishes into a workflow tree as module `Host`. */
@Interface()
export abstract class WorkflowHost {
  /** Sends text to this Agent: into `sessionId` when given, else into a new Session. */
  abstract runAgent(input: { text: string; sessionId?: string }): Promise<{ sessionId: string }>;
  /** `idle` / `running` / … of one of this Agent's Sessions. */
  abstract sessionStatus(sessionId: string): string;
  /** The workflow's own document (`state.json`, kept by the server across reloads and rollbacks). */
  abstract getState(): unknown;
  abstract setState(state: unknown): Promise<void>;
  abstract log(message: string): void;
}

export interface WorkflowInfo {
  id: string;
  name: string;
  version: string | null;
  /** Content revision of the whole folder (what history records). */
  revision: string;
  /** Content revision of `ui/`; null when the workflow has no UI. */
  uiRev: string | null;
  loadedAt: string;
  /** The boot error when the current files do not load (the previous instance, if any, keeps serving). */
  error: string | null;
}

export interface WorkflowVersion {
  revision: string;
  savedAt: string;
  name: string;
  version: string | null;
  uiRev: string | null;
  /** The files of that version (relative paths), for display. */
  files: string[];
}

@Interface()
export abstract class Workflows {
  abstract list(projectId: string, agentId: string): Promise<WorkflowInfo[]>;
  abstract reload(projectId: string, agentId: string, workflowId: string): Promise<WorkflowInfo>;
  abstract dispatch(
    projectId: string,
    agentId: string,
    workflowId: string,
    request: WorkflowRequest,
  ): Promise<WorkflowResponse>;
  /** Absolute path of a file under the workflow's `ui/`, or null when absent/unsafe. */
  abstract uiFile(
    projectId: string,
    agentId: string,
    workflowId: string,
    rel: string,
  ): Promise<string | null>;
  abstract history(
    projectId: string,
    agentId: string,
    workflowId: string,
  ): Promise<WorkflowVersion[]>;
  abstract rollback(
    projectId: string,
    agentId: string,
    workflowId: string,
    revision: string,
  ): Promise<WorkflowInfo>;
  /** Deletes the folder and its recorded versions; the instance goes with them. */
  abstract remove(projectId: string, agentId: string, workflowId: string): Promise<void>;
}
