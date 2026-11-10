/**
 * Workbenches: code an Agent keeps in its own directory and the server boots as a module
 * tree of its own — the same manifests and the same tree check the platform's plugins go
 * through (`package.json#penguin.modules` + the default export of `index.ts`). Two
 * interfaces cross the boundary:
 *
 * - `WorkbenchHost` is what the server PUBLISHES into every workbench tree (the workbench's
 *   manifest requires it `from: "Host"`): Sessions of the Project's Agents, opened and run
 *   the way the SDK does it and followed live, a small state document, a log line.
 * - `WorkbenchMain` is what a workbench PROVIDES: a JSON request handler the server mounts
 *   under `/api/projects/:p/agents/:a/workbenches/:id/api/*`, which the workbench's own UI
 *   (served from its `ui/` folder) calls.
 *
 * `Workbenches` is the platform-side mechanism the routes drive: list, reload, switch on and
 * off, dispatch, serve a UI file (and the page runtime compiled pages import), and the version
 * history every successful load commits to the Agent State repository — which is what makes an
 * Agent's own edits to its workbench reversible.
 */
import type { IconImage } from "@prismshadow/penguin-core";
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { IconRef } from "../api/types.js";

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

/**
 * One AMSP record as `WorkbenchHost.subscribe` hands it over: the envelope every Trace line and
 * every unnamed event of a Session's stream is. `type` is `session_meta`, `model_msg` or
 * `event_msg`; `payload.type` names the record (`task_begin`, `partial_text`, `tool_call`,
 * `task_end`, …; a `session_meta` payload has none); `origin` is the chain of child Session ids
 * a subagent's record came through, outer to inner, and is absent on the main Session's own.
 *
 * Typed by its envelope rather than by every payload AMSP defines: a workbench keeps the types
 * it was written against (`.harness/`), and a record type that grew with each new payload would
 * stop fitting them.
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

/**
 * How a workbench asks to appear in its Project's App Center: `penguin.appCenter` in its own
 * package.json, beside `penguin.version` and `penguin.modules`. Absent, or `show: false`, the
 * workbench has no shortcut there.
 */
export interface WorkbenchAppCenter {
  show: boolean;
  /** At most 60 characters; the first tab's title, else the package name, when absent. */
  title?: string;
  /** At most 60 characters; the first tab's `titleZh` when absent. */
  titleZh?: string;
  /**
   * An image file under `ui/`, at most 256 KB: SVG, PNG, JPEG, WebP, GIF or AVIF, its extension
   * naming the format its bytes are, and an SVG holding no script, handler or outside reference.
   * A letter tile when absent.
   */
  icon?: string;
  /** The key of the tab the shortcut opens; the first tab when absent. */
  tab?: string;
}

/** One tile of the App Center: a workbench whose manifest asks to be shown. */
export interface AppCenterShortcut {
  agentId: string;
  agentName: string;
  workbenchId: string;
  title: string;
  titleZh?: string;
  /**
   * The declared icon: `url` is its route under the workbench with the image's content revision
   * (`…/app-center/icon?rev=<hash>`), so a changed icon is a new URL, and `tint` says whether it
   * is a monochrome SVG drawn in the text colour. Absent without a declared icon that reads clean.
   */
  icon?: IconRef;
  /** The full page the tile opens: /app/<projectId>/<agentId>/<workbenchId>[/<tab>]. */
  path: string;
  /** The tab the shortcut opens when the declaration names one; else the workbench's first. */
  tab?: string;
  /**
   * Where its build stands on this server: "building" while a load of its files is under way or
   * queued, "failed" when the last load recorded in `.build/status.json` failed, else "ready"
   * (a workbench this process has not loaded yet is ready: opening it loads it).
   */
  build: "ready" | "building" | "failed";
  /** With build "failed": the load error `.build/status.json` records. */
  error?: string;
}

/**
 * One workbench as the server holds it. One that does not run (its own switch or the Agent-wide
 * one is off) is listed from its folder alone, never loaded for the listing: `revision` and
 * `uiRev` are its source's as it stands on disk (so history still marks the current version),
 * `tabs` and `hints` are empty, `error` is null (nothing was tried) and `loadedAt` is null;
 * `appCenter` and `icon` are read from its package.json as for one that runs.
 */
export interface WorkbenchInfo {
  id: string;
  name: string;
  version: string | null;
  /** git's tree id (12 hex) of the folder's source: what history records. */
  revision: string;
  /** Content revision of `ui/`: the cache key of the workbench's pages. Null when it has no `ui/`. */
  uiRev: string | null;
  /** The tabs of the instance that is SERVING — the previous one's while `error` is set. */
  tabs: WorkbenchTab[];
  /**
   * When the serving instance (or the failed attempt, with none serving) was loaded; null while
   * the workbench does not run.
   */
  loadedAt: string | null;
  /** The boot error when the current files do not load (the previous instance, if any, keeps serving). */
  error: string | null;
  /**
   * What loaded but is probably not what its author meant, each with the edit that settles it
   * — pages under `ui/` that no tab shows, say. Never a failure: `error` is that.
   */
  hints: string[];
  /** What the current package.json declares for the App Center; absent when nothing, or nothing valid (a hint says why). */
  appCenter?: WorkbenchAppCenter;
  /**
   * The icon that declaration names, shown in the App Center or not: the same `IconRef` its
   * shortcut carries (the icon route with the image's revision). Absent without one that reads clean.
   */
  icon?: IconRef;
  /**
   * Its own switch: false while a `.disabled` marker sits in its folder. It runs only while this
   * and the Agent-wide switch (`WorkbenchesResponse.enabled`) are both on; a disabled one is not
   * loaded, serves nothing and shows no tab, but is still listed here. Absent from a server that
   * predates the switches, which the Web reads as "no switch to show".
   */
  enabled?: boolean;
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

/** A file of a workbench's pages, as `uiFile` finds it. */
export interface WorkbenchUiFile {
  /** Absolute path: a file under `ui/`, or the `.js` a TSX page compiled to under `.build/`. */
  path: string;
  /**
   * Set on an HTML page of a workbench whose pages are compiled: the runtime its import map
   * names. Null on every file served exactly as it is on disk.
   */
  compiled: WorkbenchUiRuntime | null;
}

/** A file of this server's page runtime, with a strong validator of its bytes. */
export interface WorkbenchUiRuntimeFile {
  body: Uint8Array;
  etag: string;
}

/** A version of a workbench: a commit of the Agent State repository that changed its folder. */
export interface WorkbenchVersion {
  /** The folder's revision at that commit (`WorkbenchInfo.revision` when it was loaded). */
  revision: string;
  /** The commit (12 hex) in `<agentDir>/agent_state.git`. */
  commit: string;
  savedAt: string;
}

/**
 * Every route that serves a workbench refuses one that does not run — its own switch or the
 * Agent-wide one is off — with 409 `workbench_disabled`: its pages, the page runtime, its API,
 * a reload. Listing, history, rollback (source only), export and removal still work.
 */
@Interface()
export abstract class Workbenches {
  /** Every workbench of the Agent, disabled ones included; the ones that run are loaded when stale. */
  abstract list(projectId: string, agentId: string): Promise<WorkbenchInfo[]>;
  /** The Agent-wide switch: false while `.disabled` sits beside the workbench folders. */
  abstract agentEnabled(projectId: string, agentId: string): Promise<boolean>;
  /** Loads the folder now; one that does not run is refused (409 `workbench_disabled`). */
  abstract reload(projectId: string, agentId: string, workbenchId: string): Promise<WorkbenchInfo>;
  /**
   * After its source was written (an archive import): loads it as `reload` does when it runs,
   * and otherwise answers it as it stands, not loaded.
   */
  abstract reloadIfEnabled(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<WorkbenchInfo>;
  /**
   * Sets one workbench's own switch. Off unloads it at once (its subscriptions end with its
   * tree); on loads it, unless the Agent-wide switch is off. The Project's users hear
   * `workbench_updated`.
   */
  abstract setEnabled(
    projectId: string,
    agentId: string,
    workbenchId: string,
    enabled: boolean,
  ): Promise<WorkbenchInfo>;
  /**
   * Sets the Agent-wide switch, leaving each workbench's own as it is: off unloads every
   * workbench of the Agent at once, on loads the ones whose own switch is on. Answers the
   * listing after the change; each workbench is announced as `workbench_updated`.
   */
  abstract setAgentEnabled(
    projectId: string,
    agentId: string,
    enabled: boolean,
  ): Promise<{ workbenches: WorkbenchInfo[]; enabled: boolean }>;
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
  /** Restores a version's source; it is loaded (and recorded as the newest version) only when it runs. */
  abstract rollback(
    projectId: string,
    agentId: string,
    workbenchId: string,
    revision: string,
  ): Promise<WorkbenchInfo>;
  /**
   * Deletes the folder, state and switch included, and records the removal; its earlier
   * versions are no longer listed. The instance goes with it.
   */
  abstract remove(projectId: string, agentId: string, workbenchId: string): Promise<void>;
  /**
   * The App Center of a Project: a shortcut for every workbench of its Agents on this server
   * whose manifest asks to be shown, in Agent list order and by title within an Agent. Read from
   * the manifests, each one's last load status and the loads under way — nothing is loaded or
   * compiled. From then on the Agents' folders are watched, so an edit loads and is announced.
   */
  abstract appCenter(projectId: string): Promise<AppCenterShortcut[]>;
  /**
   * The icon a workbench's App Center declaration names, read and checked again; null when the
   * workbench is unknown, its declaration does not hold up, or it names no icon.
   */
  abstract appCenterIcon(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<IconImage | null>;
  /**
   * Rewrites `penguin.appCenter.show` in the workbench's package.json, and nothing else of it,
   * then reloads the workbench — which records the edit as a version like any other.
   */
  abstract setAppCenter(
    projectId: string,
    agentId: string,
    workbenchId: string,
    show: boolean,
  ): Promise<WorkbenchInfo>;
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
