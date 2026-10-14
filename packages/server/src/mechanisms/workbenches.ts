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

/** A request the workbench's handler receives (the HTTP shape, minus the transport). */
export interface WorkbenchRequest {
  method: string;
  /** Path below the workbench's `api/` mount, always starting with `/`. */
  path: string;
  query: Record<string, string>;
  /** Request headers, names lower-cased. The app's own credentials (`cookie`, `authorization`) are withheld. */
  headers: Record<string, string>;
  /** The parsed body of a JSON request; `null` otherwise (GET/HEAD, no body, another content type). */
  body: unknown;
  /** The body as sent, when there is one and it is not JSON: a form, an upload, plain text. */
  bytes?: Uint8Array;
}

export interface WorkbenchResponse {
  /** HTTP status; 200 when absent. */
  status?: number;
  /**
   * Response headers. Naming a `content-type` is what makes the response something other than
   * JSON; `location` with a 3xx status redirects. `set-cookie` is dropped — a workbench does not
   * write the app's cookies.
   */
  headers?: Record<string, string>;
  /** JSON by default (`null` when absent); with a `content-type` header, a string sent as written. */
  body?: unknown;
  /** A binary body (an image, a font, a download); wins over `body`. */
  bytes?: Uint8Array;
  /**
   * A body sent as it is produced — server-sent events, a model's answer token by token, a
   * large download — each chunk written to the client when the iterator yields it; wins over
   * `bytes` and `body`. A client that goes away ends the iteration: `return()` is called, so
   * a `finally` in the generator is where an upstream request is aborted — but a generator
   * suspended inside an `await` receives it only once that await settles, so a relay whose
   * upstream can hang should carry its own deadline rather than rely on the disconnect.
   */
  stream?: AsyncIterable<Uint8Array | string>;
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
  /** The workbench's own document (`state.json`, kept by the server across reloads and rollbacks). */
  abstract getState(): unknown;
  abstract setState(state: unknown): Promise<void>;
  abstract log(message: string): void;
}

/** How the Web App draws a contributed tab: a page of the workbench, or a renderer it carries. */
export type WorkbenchTabRenderer = { iframe: { src: string } } | { builtin: string };

/**
 * One tab beside Chat, as the workbench contributed it (`WebModule.sessionTabs`). In a
 * manifest `renderer.iframe.src` is a path inside the workbench folder, under `ui/`; in a
 * `WorkbenchInfo` it is the URL that file is served from.
 */
export interface WorkbenchTab {
  id: string;
  /** Unique within the workbench; the tab's stable name (it appears in the full-page URL). */
  key: string;
  title: string;
  titleZh?: string;
  renderer: WorkbenchTabRenderer;
}

export interface WorkbenchInfo {
  id: string;
  name: string;
  version: string | null;
  /** Content revision of the whole folder (what history records). */
  revision: string;
  /** Content revision of `ui/`: the cache key of the workbench's pages. Null when it has no `ui/`. */
  uiRev: string | null;
  /** The tabs of the instance that is SERVING — the previous one's while `error` is set. */
  tabs: WorkbenchTab[];
  loadedAt: string;
  /** The boot error when the current files do not load (the previous instance, if any, keeps serving). */
  error: string | null;
  /**
   * What loaded but is probably not what its author meant, each with the edit that settles it
   * — pages under `ui/` that no tab shows, say. Never a failure: `error` is that.
   */
  hints: string[];
}

export interface WorkbenchVersion {
  revision: string;
  savedAt: string;
  name: string;
  version: string | null;
  uiRev: string | null;
  /** The files of that version (relative paths), for display. */
  files: string[];
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
  /** Absolute path of a file under the workbench's `ui/`, or null when absent/unsafe. */
  abstract uiFile(
    projectId: string,
    agentId: string,
    workbenchId: string,
    rel: string,
  ): Promise<string | null>;
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
}
