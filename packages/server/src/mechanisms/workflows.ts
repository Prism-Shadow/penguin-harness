/**
 * Workflows: code an Agent keeps in its own directory and the server boots as a module
 * tree of its own — the same manifests and the same tree check the platform's plugins go
 * through (`package.json#penguin.modules` + the default export of `index.ts`). Two
 * interfaces cross the boundary:
 *
 * - `WorkflowHost` is what the server PUBLISHES into every workflow tree (the workflow's
 *   manifest requires it `from: "Host"`): Sessions of the Project's Agents, opened and run
 *   the way the SDK does it, a small state document, a log line.
 * - `WorkflowMain` is what a workflow PROVIDES: a JSON request handler the server mounts
 *   under `/api/projects/:p/agents/:a/workflows/:id/api/*`, which the workflow's own UI
 *   (served from its `ui/` folder) calls.
 *
 * `Workflows` is the platform-side mechanism the routes drive: list, reload, dispatch,
 * serve a UI file, and the version history every successful load appends to — which is
 * what makes an Agent's own edits to its workflow reversible.
 */
import type { OmniMessage, TextPayload } from "@prismshadow/penguin-core";
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
  /**
   * Opens a Session of an Agent of this Project — the workflow's own Agent when `agentId`
   * is absent. The SDK's `agent.createSession`.
   */
  abstract createSession(opts?: { agentId?: string }): Promise<{ sessionId: string }>;
  /**
   * Runs one turn in a Session of this Project, new or existing: `input` is what the SDK's
   * `session.run` takes (`[userText("…")]`) and reaches the Agent as a message from the
   * server, not from a person. A Session that is busy takes it as a queued follow-up
   * (`queued: true`) instead of refusing it. Resolves once the turn has started; watch it
   * with `sessionStatus`.
   */
  abstract run(
    sessionId: string,
    input: OmniMessage<TextPayload>[],
  ): Promise<{ sessionId: string; queued: boolean }>;
  /** `idle` / `running` / … of a Session of this Project. */
  abstract sessionStatus(sessionId: string): string;
  /** The workflow's own document (`state.json`, kept by the server across reloads and rollbacks). */
  abstract getState(): unknown;
  abstract setState(state: unknown): Promise<void>;
  abstract log(message: string): void;
}

/**
 * The default export of a workflow's `index.ts`: code for the modules its manifest names.
 * The root module is `Workflow`; its manifest requires the host under the alias `host`
 * and provides the handler under the alias `main`. Written as
 * `export default { … } satisfies WorkflowPackage`, which is what gives `use.host` and
 * `handle`'s parameter their types.
 */
export interface WorkflowPackage {
  modules: {
    Workflow: WorkflowRootModule;
    [name: string]: WorkflowRootModule | WorkflowModule;
  };
}

export interface WorkflowRootModule {
  create(ctx: WorkflowModuleCtx<{ host: WorkflowHost }>): {
    api: { main: WorkflowMain } & Record<string, unknown>;
  };
}

/** Any other module of the package: what it uses is whatever its own manifest requires. */
export interface WorkflowModule {
  create(ctx: WorkflowModuleCtx<Record<string, unknown>>): { api?: Record<string, unknown> };
}

export interface WorkflowModuleCtx<Use> {
  use: Use;
  /** Runs when the tree is disposed (a reload, a removal, the platform going away). */
  effect(dispose: () => void): void;
}

/** How the Web App draws a contributed tab: a page of the workflow, or a renderer it carries. */
export type WorkflowTabRenderer = { iframe: { src: string } } | { builtin: string };

/**
 * One tab beside Chat, as the workflow contributed it (`WebModule.sessionTabs`). In a
 * manifest `renderer.iframe.src` is a path inside the workflow folder, under `ui/`; in a
 * `WorkflowInfo` it is the URL that file is served from.
 */
export interface WorkflowTab {
  id: string;
  /** Unique within the workflow; the tab's stable name (it appears in the full-page URL). */
  key: string;
  title: string;
  titleZh?: string;
  renderer: WorkflowTabRenderer;
}

export interface WorkflowInfo {
  id: string;
  name: string;
  version: string | null;
  /** Content revision of the whole folder (what history records). */
  revision: string;
  /** Content revision of `ui/`: the cache key of the workflow's pages. Null when it has no `ui/`. */
  uiRev: string | null;
  /** The tabs of the instance that is SERVING — the previous one's while `error` is set. */
  tabs: WorkflowTab[];
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
