/**
 * Workbenches: code an Agent keeps in its own directory and the server boots as a module
 * tree of its own — the same manifests and the same tree check the platform's plugins go
 * through (`package.json#penguin.modules` + the default export of `index.ts`). Two
 * interfaces cross the boundary:
 *
 * - `WorkbenchHost` is what the server PUBLISHES into every workbench tree (the workbench's
 *   manifest requires it `from: "Host"`): Sessions of the Project's Agents, opened and run
 *   the way the SDK does it and followed live, a small state document, where its own data,
 *   cache and state folders are, a log line.
 * - `WorkbenchMain` is what a workbench PROVIDES: a JSON request handler the server mounts
 *   under `/api/projects/:p/agents/:a/workbenches/:id/api/*`, which the workbench's own UI
 *   (served from its `ui/` folder) calls.
 *
 * `Workbenches` is the platform-side mechanism the routes drive: list, reload, switch on and
 * off, dispatch, serve a UI file (and the page runtime compiled pages import), and the version
 * history every successful load commits to the Agent State repository — which is what makes an
 * Agent's own edits to its workbench reversible. A method that may record a version takes `by`,
 * the member whose request it serves: that version is authored by them
 * (../workbenches/git-identity.ts); without it, by the server's Git identity.
 */
import type { AppCenterUnavailable } from "../api/types.js";
import type { IconImage } from "@prismshadow/penguin-core";
import { Interface } from "@prismshadow/penguin-core/kernel";
import type {
  WorkbenchInfo,
  WorkbenchTab,
  WorkbenchTabIcon,
  WorkbenchTabRenderer,
  WorkbenchAppCenter,
  AppCenterShortcut,
  WorkbenchUiRuntime,
  WorkbenchUiRuntimeFile,
  WorkbenchUiFile,
  WorkbenchVersion,
  WorkbenchRequest,
  WorkbenchResponse,
  WorkbenchInput,
  WorkbenchResult,
  WorkbenchRecord,
  IconRef,
} from "@prismshadow/penguin-library-workbench";
import type { VersionAuthor } from "../workbenches/git-identity.js";

/**
 * The approval modes a workbench may open a Session with: two of a Session's existing modes,
 * the two that decide every tool call by themselves. Nobody watches a workbench Session, so a
 * mode that puts a call to a person (`read-only`, `always-ask`) is not offered.
 */
export type WorkbenchApprovalMode = "allow-all" | "deny-all";

/**
 * Who shares a workbench's folders:
 *
 * - `agent` (the default): this Agent's copy of the app alone. Its `dataDir` travels in the
 *   Agent export with the workbench's data; all three go when the workbench is removed.
 * - `server`: every copy of the same app (the same plugin's workbench) on this data root, across
 *   its Projects and Agents — a model's weights, a tool's binaries. Never exported, never removed
 *   with a workbench.
 * - `machine`: every data root of this OS user on this computer (the installed app, a dev
 *   instance) — a small local server one computer runs once. Never exported, never removed.
 *
 * The shared levels belong to apps installed from a plugin: the plugin's name is what makes two
 * copies one app. Only the handler writes them; the Agent's sandboxed commands may not.
 */
export type WorkbenchDataLevel = "agent" | "server" | "machine";

/**
 * Where a workbench's own folders are on the server's machine. The handler reads and writes them
 * with Node's own `fs` (`node:fs`, `node:path`, `node:net` are typed for it) and serves what its
 * page needs from its own routes; the host offers no file API.
 */
export interface WorkbenchDataPaths {
  /**
   * Files kept for good: at the agent level what the handler and the Agent both write, the Agent
   * with its own file tools (`<agentDir>/app/data/<id>`, exported with the workbench's data); at
   * a shared level what every copy of the app reads, such as a model's weights.
   */
  dataDir: string;
  /** Files that can be made again. Never exported. */
  cacheDir: string;
  /**
   * Runtime-only files — Unix sockets, pipes, locks — at a short path, since a Unix socket path
   * holds at most 103 bytes: name a socket with `socketPath`. Never exported; kept across
   * restarts (unlink a stale socket before listening).
   */
  stateDir: string;
}

/** What a workbench provides (its manifest: `provides: { main: "@prismshadow/penguin-server#WorkbenchMain" }`). */
@Interface()
export abstract class WorkbenchMain {
  abstract handle(request: WorkbenchRequest): Promise<WorkbenchResponse>;
}

/** What the server publishes into a workbench tree as module `Host`. */
@Interface()
export abstract class WorkbenchHost {
  /**
   * The Agents of this Project — who `createSession` can be asked to open a Session of. The
   * system Agent, which runs none, is not one of them.
   */
  abstract listAgents(): { agentId: string }[];
  /**
   * Opens a Session of an Agent of this Project — the workbench's own Agent when `agentId`
   * is absent. The SDK's `agent.createSession`. The Session's approval mode is `approvalMode`,
   * `allow-all` when absent; any other value is refused by name.
   */
  abstract createSession(opts?: {
    agentId?: string;
    /** Choose a project model for this Session. Omit it to use the Project default. */
    model?: { provider: string; modelId: string };
    /**
     * `allow-all` (the default) runs every tool call, as a scheduled run does. `deny-all`
     * denies every tool call in the Session: the mode for a Session that only talks, so
     * nothing the person types and nothing the workbench inlines can run a command.
     */
    approvalMode?: WorkbenchApprovalMode;
  }): Promise<{ sessionId: string }>;
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
  /**
   * Where this workbench's data, cache and state folders are at `level` (`agent` when left
   * out). All three exist once this returns, and a link where one of them belongs is refused.
   * At the agent level the Agent's commands may write them even in a `workspace-write` sandbox,
   * so a path in them can be handed to the Agent. The `server` and `machine` levels are for an
   * app installed from a plugin, and throw for a workbench made in place.
   */
  abstract dataPaths(level?: WorkbenchDataLevel): WorkbenchDataPaths;
  /**
   * What to `listen` on for a local socket called `name` at `level` (`agent` when left out):
   * `<stateDir>/<name>`, or on Windows a named pipe (`\\.\pipe\penguin-…-<name>`), which is no
   * path on disk. Throws, naming the limit, when the path would pass the 103 bytes a Unix socket
   * path holds.
   */
  abstract socketPath(name: string, level?: WorkbenchDataLevel): string;
  /** The workbench's own document (`state.json`, kept by the server across reloads and rollbacks). */
  abstract getState(): unknown;
  abstract setState(state: unknown): Promise<void>;
  abstract log(message: string): void;
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
  /**
   * One workbench as {@link list} gives it, loaded when it runs and is stale; null when the
   * Agent has no such workbench. The Agent's other workbenches are neither read nor loaded, so
   * a page opened on its own waits for its own compile alone.
   */
  abstract one(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<WorkbenchInfo | null>;
  /** The Agent-wide switch: false while `.disabled` sits beside the workbench folders. */
  abstract agentEnabled(projectId: string, agentId: string): Promise<boolean>;
  /**
   * One workbench's registration, read from its folder alone — no migrate, no watcher, no
   * load (a 404 `WorkbenchNotFound` for an unknown id). The auth-less install-manifest gate
   * answers from this: an anonymous request must not be able to run the folder's
   * compile/boot lifecycle, only look at its `package.json`.
   */
  abstract describe(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<WorkbenchInfo>;
  abstract reload(
    projectId: string,
    agentId: string,
    workbenchId: string,
    by?: VersionAuthor,
  ): Promise<WorkbenchInfo>;
  /**
   * After its source was written (an archive import): loads it as `reload` does when it runs,
   * and otherwise answers it as it stands, not loaded.
   */
  abstract reloadIfEnabled(
    projectId: string,
    agentId: string,
    workbenchId: string,
    by?: VersionAuthor,
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
    by?: VersionAuthor,
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
  /**
   * Whether the Agent has this workbench, read from its folder after any import has ended: false
   * when it has none, a 409 `WorkbenchDisabled` when it does not run. Loads nothing, so a route
   * that serves the same files under every workbench never compiles the Agent's others.
   */
  abstract exists(projectId: string, agentId: string, workbenchId: string): Promise<boolean>;
  /**
   * The workbench's plugin icon (`.svg` markup or `.png` bytes base64-encoded), from its
   * `package.json#penguin.icon`; null when it ships none or the read refuses it. The PWA
   * manifest inlines it; the session tabs default to it. A pure read of the current
   * layout — no migration, like `describe`; the auth-less manifest gate calls this.
   */
  abstract iconSvg(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<WorkbenchTabIcon | null>;
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
    by?: VersionAuthor,
  ): Promise<WorkbenchInfo>;
  /**
   * Deletes the folder, state and switch included, and records the removal; its earlier
   * versions are no longer listed. The instance goes with it.
   */
  abstract remove(
    projectId: string,
    agentId: string,
    workbenchId: string,
    by?: VersionAuthor,
  ): Promise<void>;
  /**
   * The App Center of a Project: a shortcut for every workbench of its Agents on this server
   * whose manifest asks to be shown (or explicitly hidden when requested), in Agent list order and by title within an Agent. Read from
   * the manifests, each one's last load status and the loads under way — nothing is loaded or
   * compiled. From then on the Agents' folders are watched, so an edit loads and is announced.
   */
  abstract appCenter(
    projectId: string,
    hidden?: boolean,
    unavailable?: AppCenterUnavailable,
  ): Promise<AppCenterShortcut[]>;
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
   * The rows of one Agent's sidebar list: the App Center's reading with the sidebar's filter, a
   * shortcut for every workbench that runs, has a tab and carries no `.hidden-from-sidebar`
   * marker, by title. Nothing is loaded or compiled; the Agent's folder is watched from then on.
   */
  abstract sidebar(projectId: string, agentId: string): Promise<AppCenterShortcut[]>;
  /**
   * Writes (`show: false`) or removes the installation's `.hidden-from-sidebar` marker. It is no
   * part of the source, so writing it records no version and does not reload the workbench; the
   * workbench as it then stands is answered and announced.
   */
  abstract setSidebar(
    projectId: string,
    agentId: string,
    workbenchId: string,
    show: boolean,
  ): Promise<WorkbenchInfo>;
  /**
   * Rewrites `penguin.appCenter.show` in the workbench's package.json, and nothing else of it,
   * then reloads the workbench — which records the edit as a version like any other.
   */
  abstract setAppCenter(
    projectId: string,
    agentId: string,
    workbenchId: string,
    show: boolean,
    by?: VersionAuthor,
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
