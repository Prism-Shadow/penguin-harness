/**
 * WorkflowService: boots every workflow folder of an Agent as a module tree of its own.
 *
 * What a load does — compile, check both ways, boot, record the version — is the shared
 * loader's (./loader.ts); this service is what makes it an Agent's: the root module must
 * provide `WorkflowMain`, the server publishes `WorkflowHost` to the tree as module `Host`,
 * and the slots it opens to workflows under the platform's own module names (today
 * `WebModule.sessionTabs`), so a workflow contributes a tab the way a plugin does and the host
 * scopes it to the Agent. A load that fails keeps the previous instance serving with the
 * problem named.
 *
 * A watcher on the `workflows/` folder reloads on change, debounced, and the users of the
 * Project hear `workflow_updated` on their event stream.
 */
import fs from "node:fs";
import path from "node:path";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ModuleTree } from "@prismshadow/penguin-core/kernel";
import type { ServerEvent } from "../api/types.js";
import type { Channels, Clock, Log, Paths } from "../hmr/capabilities.js";
import { userChannelKey } from "../http/routes/events.js";
import type { AgentIndex, Members, Projects } from "../mechanisms/projects.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type {
  WorkflowInfo,
  WorkflowLoader,
  WorkflowRequest,
  WorkflowResponse,
  WorkflowTab,
  WorkflowVersion,
  Workflows,
} from "../mechanisms/workflows.js";
import { ScheduleSessionCreator, ScheduleTaskRunner } from "../runtime/scheduler.js";
import { writeLoadStatus } from "./compile.js";
import { AGENT_PACKAGE_TYPES, AGENT_README } from "./harness-types.js";
import { ROOT_MODULE } from "./loader.js";
import { watchFolder, watchForFolder } from "./watch.js";
import {
  contributedTabs,
  HOST_IFACE,
  HOST_MODULE,
  hostDecl,
  agentHost,
  loadHints,
  MAIN_IFACE,
  uiBase,
  WEB_MODULE,
  webSlotsDecl,
} from "./agent-kind.js";
import {
  historyDir,
  isSafeRelPath,
  isWorkflowId,
  listFolders,
  readFolder,
  UI_DIR,
  workflowsDir,
  type WorkflowFolder,
} from "./store.js";

/** A burst of file writes (an editor, a git checkout, a rollback) becomes one reload. */
const WATCH_SETTLE_MS = 300;

interface Loaded {
  folder: WorkflowFolder;
  tree: ModuleTree | null;
  main: { handle(request: WorkflowRequest): Promise<WorkflowResponse> } | null;
  tabs: WorkflowTab[];
  loadedAt: string;
  error: string | null;
}

function key(projectId: string, agentId: string, workflowId: string): string {
  return `${projectId}/${agentId}/${workflowId}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Component()
export class WorkflowService implements Workflows {
  @Use() private readonly paths!: Paths;
  @Use() private readonly clock!: Clock;
  @Use() private readonly log!: Log;
  @Use() private readonly channels!: Channels;
  @Use() private readonly members!: Members;
  @Use() private readonly projects!: Projects;
  @Use() private readonly loader!: WorkflowLoader;
  @Use() private readonly agents!: AgentIndex;
  @Use() private readonly sessionIndex!: SessionIndex;
  @Use() private readonly runner!: ScheduleTaskRunner;
  @Use() private readonly sessions!: ScheduleSessionCreator;

  private readonly loaded = new Map<string, Loaded>();
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly pending = new Map<string, NodeJS.Timeout>();
  /** The load in flight per workflow: a load takes a compiler run, so two can overlap. */
  private readonly loading = new Map<string, Promise<Loaded>>();
  /** The revision the newest queued load will load, while one is queued (see reloadIfChanged). */
  private readonly loadingRevision = new Map<string, string>();
  /** Workflows whose folder is being deleted: the watcher schedules no reload for them. */
  private readonly removing = new Set<string>();
  private disposed = false;

  setup(ctx: { effect(dispose: () => void): void }) {
    ctx.effect(() => {
      this.disposed = true;
      for (const t of this.pending.values()) clearTimeout(t);
      for (const w of this.watchers.values()) w.close();
      for (const l of this.loaded.values()) l.tree?.dispose();
      this.loaded.clear();
    });
  }

  async list(projectId: string, agentId: string): Promise<WorkflowInfo[]> {
    this.watch(projectId, agentId);
    const folders = await listFolders(workflowsDir(this.paths.root, projectId, agentId));
    const out: WorkflowInfo[] = [];
    for (const folder of folders) {
      const current = this.loaded.get(key(projectId, agentId, folder.id));
      const fresh =
        current && current.folder.revision === folder.revision
          ? current
          : await this.load(projectId, agentId, folder);
      out.push(this.info(folder.id, fresh));
    }
    // Folders that went away drop their instances.
    const alive = new Set(folders.map((f) => key(projectId, agentId, f.id)));
    for (const [k, l] of this.loaded) {
      if (k.startsWith(`${projectId}/${agentId}/`) && !alive.has(k)) {
        this.forget(projectId, agentId, l.folder.id);
      }
    }
    return out;
  }

  async reload(projectId: string, agentId: string, workflowId: string): Promise<WorkflowInfo> {
    const folder = await this.folder(projectId, agentId, workflowId);
    return this.info(workflowId, await this.load(projectId, agentId, folder));
  }

  /**
   * The watcher's reload: only when the content differs from what is loaded, or from what the
   * load in flight is loading. An event is a hint, not an edit — Windows reports a `change` on
   * a directory when a file in it is read or written (the workflow's own state, `.build/`, and
   * a load's own reads of the folder), and reloading on those tore the tree down under the
   * request that had just written its state, or loaded the same folder twice over. The
   * revision is the content hash, so an edit always differs.
   */
  private async reloadIfChanged(
    projectId: string,
    agentId: string,
    workflowId: string,
  ): Promise<void> {
    const folder = await this.folder(projectId, agentId, workflowId);
    const k = key(projectId, agentId, workflowId);
    const current = this.loading.has(k)
      ? this.loadingRevision.get(k)
      : this.loaded.get(k)?.folder.revision;
    if (current === folder.revision) return;
    await this.load(projectId, agentId, folder);
  }

  async dispatch(
    projectId: string,
    agentId: string,
    workflowId: string,
    request: WorkflowRequest,
  ): Promise<WorkflowResponse> {
    const loaded = await this.current(projectId, agentId, workflowId);
    if (loaded.main === null) {
      return { status: 503, body: { error: loaded.error ?? "workflow is not loaded" } };
    }
    return loaded.main.handle(request);
  }

  async uiFile(
    projectId: string,
    agentId: string,
    workflowId: string,
    rel: string,
  ): Promise<string | null> {
    if (!isWorkflowId(workflowId)) return null;
    // No default document: which page a tab shows is what its contribution says.
    const file = rel;
    if (!isSafeRelPath(file)) return null;
    const abs = path.join(
      workflowsDir(this.paths.root, projectId, agentId),
      workflowId,
      UI_DIR,
      file,
    );
    try {
      return (await fs.promises.stat(abs)).isFile() ? abs : null;
    } catch {
      return null;
    }
  }

  history(projectId: string, agentId: string, workflowId: string): Promise<WorkflowVersion[]> {
    if (!isWorkflowId(workflowId)) return Promise.resolve([]);
    return this.loader.history(historyDir(this.paths.root, projectId, agentId), workflowId);
  }

  async rollback(
    projectId: string,
    agentId: string,
    workflowId: string,
    revision: string,
  ): Promise<WorkflowInfo> {
    const folder = await this.folder(projectId, agentId, workflowId);
    if (!/^[0-9a-f]{12}$/.test(revision)) throw new WorkflowNotFound("no such version");
    const restored = await this.loader.restore(
      historyDir(this.paths.root, projectId, agentId),
      folder.dir,
      workflowId,
      revision,
    );
    if (!restored) throw new WorkflowNotFound("no such version");
    return this.reload(projectId, agentId, workflowId);
  }

  async remove(projectId: string, agentId: string, workflowId: string): Promise<void> {
    const folder = await this.folder(projectId, agentId, workflowId);
    const k = key(projectId, agentId, workflowId);
    // Nothing may write into the folder while it is deleted: a load writes `.build/`, and a
    // file recreated there mid-delete fails the rm on Windows (ENOTEMPTY). Pending reloads are
    // dropped, none is scheduled until the folder is gone, and one already running finishes.
    this.removing.add(k);
    try {
      const t = this.pending.get(k);
      if (t) clearTimeout(t);
      this.pending.delete(k);
      await this.loading.get(k)?.catch(() => undefined);
      await fs.promises.rm(folder.dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } finally {
      this.removing.delete(k);
    }
    await fs.promises.rm(path.join(historyDir(this.paths.root, projectId, agentId), workflowId), {
      recursive: true,
      force: true,
    });
    this.forget(projectId, agentId, workflowId);
  }

  // ---- internals ------------------------------------------------------------------

  private async folder(
    projectId: string,
    agentId: string,
    workflowId: string,
  ): Promise<WorkflowFolder> {
    if (!isWorkflowId(workflowId)) throw new WorkflowNotFound("no such workflow");
    const dir = path.join(workflowsDir(this.paths.root, projectId, agentId), workflowId);
    const folder = await readFolder(dir, workflowId);
    if (!folder) throw new WorkflowNotFound("no such workflow");
    return folder;
  }

  private async current(projectId: string, agentId: string, workflowId: string): Promise<Loaded> {
    const folder = await this.folder(projectId, agentId, workflowId);
    const k = key(projectId, agentId, workflowId);
    const existing = this.loaded.get(k);
    if (existing && existing.folder.revision === folder.revision) return existing;
    return this.load(projectId, agentId, folder);
  }

  private info(id: string, l: Loaded): WorkflowInfo {
    return {
      id,
      name: l.folder.pkg.name,
      version: l.folder.pkg.version,
      revision: l.folder.revision,
      uiRev: l.folder.uiRev,
      tabs: l.tabs,
      loadedAt: l.loadedAt,
      error: l.error,
      hints: loadHints(l.folder.uiRev, l.tabs, l.error),
    };
  }

  /**
   * One load at a time per workflow. The watcher and a request can both ask while the
   * compiler is still running for the last edit; the later one waits and then loads what
   * is on disk by then, so versions are recorded in order and never concurrently.
   */
  private load(projectId: string, agentId: string, folder: WorkflowFolder): Promise<Loaded> {
    const k = key(projectId, agentId, folder.id);
    const after = this.loading.get(k) ?? Promise.resolve();
    const run = after
      .catch(() => undefined)
      .then(async () => {
        const current = (await readFolder(folder.dir, folder.id)) ?? folder;
        if (this.loading.get(k) === run) this.loadingRevision.set(k, current.revision);
        return this.loadNow(projectId, agentId, current);
      });
    this.loading.set(k, run);
    this.loadingRevision.set(k, folder.revision);
    void run
      .finally(() => {
        if (this.loading.get(k) === run) {
          this.loading.delete(k);
          this.loadingRevision.delete(k);
        }
      })
      .catch(() => undefined);
    return run;
  }

  /** Boots the folder; on failure keeps the previous instance and reports the error. */
  private async loadNow(
    projectId: string,
    agentId: string,
    folder: WorkflowFolder,
  ): Promise<Loaded> {
    const k = key(projectId, agentId, folder.id);
    const previous = this.loaded.get(k);
    const loadedAt = this.clock.now().toISOString();
    let tabs: WorkflowTab[] = [];
    const outcome = await this.loader.load({
      folder,
      label: k,
      historyDir: historyDir(this.paths.root, projectId, agentId),
      harness: {
        keys: [HOST_IFACE, MAIN_IFACE],
        packageTypes: AGENT_PACKAGE_TYPES,
        readme: AGENT_README,
      },
      main: MAIN_IFACE,
      inspect: (manifests) => {
        tabs = contributedTabs(manifests, uiBase(projectId, agentId, folder.id));
      },
      published: (ifaces) => ({
        ifaces: {
          [HOST_MODULE]: { host: hostDecl(ifaces) },
          [WEB_MODULE]: { web: webSlotsDecl(ifaces) },
        },
        values: {
          [HOST_MODULE]: {
            host: agentHost(
              {
                agents: this.agents,
                sessions: this.sessions,
                runner: this.runner,
                sessionIndex: this.sessionIndex,
                log: this.log,
              },
              projectId,
              agentId,
              folder.dir,
              folder.id,
            ),
          },
          [WEB_MODULE]: { web: {} },
        },
      }),
    });
    let next: Loaded;
    if (outcome.ok) {
      const root = outcome.manifests.find((m) => m.name === ROOT_MODULE)!;
      const alias = Object.entries(root.provides).find(([, ref]) => ref === MAIN_IFACE)![0];
      const main = outcome.tree.api<Loaded["main"]>(ROOT_MODULE, alias);
      next = { folder, tree: outcome.tree, main, tabs, loadedAt, error: null };
      previous?.tree?.dispose();
    } else {
      // The previous instance keeps answering — it is disposed only once a new one is in place.
      next = {
        folder,
        tree: previous?.tree ?? null,
        main: previous?.main ?? null,
        tabs: previous?.tabs ?? [],
        loadedAt: previous?.loadedAt ?? loadedAt,
        error: outcome.error,
      };
    }
    if (this.disposed) {
      next.tree?.dispose();
      return next;
    }
    writeLoadStatus(folder.dir, {
      revision: folder.revision,
      checkedAt: loadedAt,
      error: next.error,
      tabs: next.tabs.map((tab) => tab.key),
      hints: loadHints(folder.uiRev, next.tabs, next.error),
    });
    this.loaded.set(k, next);
    this.notify(projectId, agentId, this.info(folder.id, next));
    return next;
  }

  /** Drops a workflow's instance and tells the Project's users it is gone. */
  private forget(projectId: string, agentId: string, workflowId: string): void {
    const k = key(projectId, agentId, workflowId);
    const t = this.pending.get(k);
    if (t) clearTimeout(t);
    this.pending.delete(k);
    this.loaded.get(k)?.tree?.dispose();
    this.loaded.delete(k);
    this.publish(projectId, { type: "workflow_removed", projectId, agentId, workflowId });
  }

  private notify(projectId: string, agentId: string, workflow: WorkflowInfo): void {
    this.publish(projectId, { type: "workflow_updated", projectId, agentId, workflow });
  }

  /** Users of the Project (owner + members) hear about the change. */
  private publish(projectId: string, event: ServerEvent): void {
    const users = new Set(this.members.list(projectId).map((m) => m.userId));
    const owner = this.projects.findById(projectId)?.ownerUserId;
    if (owner) users.add(owner);
    for (const userId of users) {
      this.channels.peek(userChannelKey(userId))?.publish(event, "server_event");
    }
  }

  private watch(projectId: string, agentId: string): void {
    const k = `${projectId}/${agentId}`;
    if (this.watchers.has(k) || this.disposed) return;
    const declared = workflowsDir(this.paths.root, projectId, agentId);
    const watcher = fs.existsSync(declared)
      ? watchFolder(declared, (id) => this.schedule(projectId, agentId, id))
      : watchForFolder(declared, () => {
          this.watchers.delete(k);
          // The folder exists now: watch it properly, and load whatever is already inside.
          void this.list(projectId, agentId).catch((err) =>
            this.log.line(`[workflows] ${k}: ${messageOf(err)}`),
          );
        });
    if (watcher === null) return;
    watcher.on("error", () => {
      watcher.close();
      this.watchers.delete(k);
    });
    this.watchers.set(k, watcher);
  }

  private schedule(projectId: string, agentId: string, workflowId: string): void {
    const k = key(projectId, agentId, workflowId);
    if (this.removing.has(k)) return;
    const t = this.pending.get(k);
    if (t) clearTimeout(t);
    this.pending.set(
      k,
      setTimeout(() => {
        this.pending.delete(k);
        void this.reloadIfChanged(projectId, agentId, workflowId).catch((err) => {
          if (err instanceof WorkflowNotFound) {
            this.forget(projectId, agentId, workflowId);
            return;
          }
          this.log.line(`[workflows] ${k}: ${messageOf(err)}`);
        });
      }, WATCH_SETTLE_MS),
    );
  }
}

export class WorkflowNotFound extends Error {}
