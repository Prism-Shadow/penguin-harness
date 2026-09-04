/**
 * WorkflowService: boots every workflow folder of an Agent as a module tree of its own.
 *
 * A workflow is a plugin package (`package.json#penguin.modules` + a default export pairing
 * the manifests with code, exactly as ../plugin/loader.ts reads a platform plugin). Its root
 * module must be named `Workflow` and provide `WorkflowMain`; the
 * server publishes `WorkflowHost` to the tree as module `Host`. The tree is checked
 * against the platform's own interface table before any create() runs, so a workflow
 * that requires something the host does not publish, or provides a handler of the wrong
 * shape, fails to load with a named problem — and the previous instance keeps serving.
 *
 * Loading is by content: the folder's revision (store.ts) is part of the import URL, so
 * an edited index.mjs is re-imported rather than served from the ESM cache, and every
 * successful load records the folder as a version the Agent (or the user) can roll back
 * to. A watcher on the `workflows/` folder reloads on change, debounced, and the users of
 * the Project hear `workflow_updated` on their event stream.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bootModules, Component, parseManifest, Use } from "@prismshadow/penguin-core/kernel";
import type {
  ClassCtx,
  IfaceDecl,
  IfaceTable,
  ModuleDef,
  ModuleTree,
} from "@prismshadow/penguin-core/kernel";
import { userText } from "@prismshadow/penguin-core";
import table from "../ifaces.json" with { type: "json" };
import type { ServerEvent } from "../api/types.js";
import type { Channels, Clock, Log, Paths } from "../hmr/capabilities.js";
import { userChannelKey } from "../http/routes/events.js";
import type { Members, Projects } from "../mechanisms/projects.js";
import type {
  WorkflowInfo,
  WorkflowRequest,
  WorkflowResponse,
  WorkflowVersion,
  Workflows,
} from "../mechanisms/workflows.js";
import { ScheduleSessionCreator, ScheduleTaskRunner } from "../runtime/scheduler.js";
import {
  historyDir,
  isSafeRelPath,
  isWorkflowId,
  listFolders,
  listVersions,
  readFolder,
  readState,
  recordVersion,
  restoreVersion,
  UI_DIR,
  workflowsDir,
  writeState,
  type WorkflowFolder,
} from "./store.js";

const PKG = "@prismshadow/penguin-server";
export const HOST_MODULE = "Host";
export const ROOT_MODULE = "Workflow";
export const HOST_IFACE = `${PKG}#WorkflowHost`;
export const MAIN_IFACE = `${PKG}#WorkflowMain`;
/** A burst of file writes (an editor, a git checkout, a rollback) becomes one reload. */
const WATCH_SETTLE_MS = 300;

interface Loaded {
  folder: WorkflowFolder;
  tree: ModuleTree | null;
  main: { handle(request: WorkflowRequest): Promise<WorkflowResponse> } | null;
  loadedAt: string;
  error: string | null;
}

function key(projectId: string, agentId: string, workflowId: string): string {
  return `${projectId}/${agentId}/${workflowId}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads `package.json#penguin.modules` and pairs it with the default export, by name. */
async function loadDefs(folder: WorkflowFolder): Promise<ModuleDef> {
  const raw = JSON.parse(
    await fs.promises.readFile(path.join(folder.dir, "package.json"), "utf8"),
  ) as {
    penguin?: { modules?: unknown };
  };
  const list = raw.penguin?.modules;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("package.json#penguin.modules must list at least the `Workflow` module");
  }
  const manifests = list.map((doc, i) => {
    try {
      return parseManifest(doc);
    } catch (err) {
      throw new Error(`package.json#penguin.modules[${i}]: ${messageOf(err)}`);
    }
  });
  const entry = ["index.mjs", "index.js"]
    .map((f) => path.join(folder.dir, f))
    .find((f) => fs.existsSync(f));
  if (entry === undefined) throw new Error("no index.mjs (or index.js) next to package.json");
  const mod = (await import(`${pathToFileURL(entry).href}?rev=${folder.revision}`)) as {
    default?: { modules?: Record<string, ModuleDef["create"] | { create: ModuleDef["create"] }> };
  };
  const code = mod.default?.modules;
  if (code === null || typeof code !== "object") {
    throw new Error("the default export must be { modules: { <name>: { create } } }");
  }
  const defs = new Map<string, ModuleDef>();
  for (const manifest of manifests) {
    const found = code[manifest.name];
    const create = typeof found === "function" ? found : found?.create;
    if (typeof create !== "function") {
      throw new Error(
        `package.json names module '${manifest.name}' but the default export has no create() for it`,
      );
    }
    defs.set(manifest.name, { manifest, create });
  }
  for (const def of defs.values()) {
    def.children = def.manifest.children.map((ref) => {
      const name = typeof ref === "string" ? ref : ref.keyed;
      const child = defs.get(name);
      if (!child)
        throw new Error(
          `module '${def.manifest.name}' lists child '${name}', which package.json does not declare`,
        );
      return child;
    });
  }
  const root = defs.get(ROOT_MODULE);
  if (!root)
    throw new Error(`package.json#penguin.modules must include a module named '${ROOT_MODULE}'`);
  if (!Object.values(root.manifest.provides).some((ref) => ref === MAIN_IFACE)) {
    throw new Error(`module '${ROOT_MODULE}' must provide "${MAIN_IFACE}"`);
  }
  return root;
}

@Component()
export class WorkflowService implements Workflows {
  @Use() private readonly paths!: Paths;
  @Use() private readonly clock!: Clock;
  @Use() private readonly log!: Log;
  @Use() private readonly channels!: Channels;
  @Use() private readonly members!: Members;
  @Use() private readonly projects!: Projects;
  @Use() private readonly runner!: ScheduleTaskRunner;
  @Use() private readonly sessions!: ScheduleSessionCreator;

  private readonly loaded = new Map<string, Loaded>();
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private resources: ClassCtx["resources"] | null = null;
  private disposed = false;

  setup(ctx: ClassCtx) {
    this.resources = ctx.resources;
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
    const file = rel === "" ? "index.html" : rel;
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
    return listVersions(historyDir(this.paths.root, projectId, agentId), workflowId);
  }

  async rollback(
    projectId: string,
    agentId: string,
    workflowId: string,
    revision: string,
  ): Promise<WorkflowInfo> {
    const folder = await this.folder(projectId, agentId, workflowId);
    if (!/^[0-9a-f]{12}$/.test(revision)) throw new WorkflowNotFound("no such version");
    const restored = await restoreVersion(
      historyDir(this.paths.root, projectId, agentId),
      folder,
      revision,
    );
    if (!restored) throw new WorkflowNotFound("no such version");
    return this.reload(projectId, agentId, workflowId);
  }

  async remove(projectId: string, agentId: string, workflowId: string): Promise<void> {
    const folder = await this.folder(projectId, agentId, workflowId);
    await fs.promises.rm(folder.dir, { recursive: true, force: true });
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
      loadedAt: l.loadedAt,
      error: l.error,
    };
  }

  /** Boots the folder; on failure keeps the previous instance and reports the error. */
  private async load(projectId: string, agentId: string, folder: WorkflowFolder): Promise<Loaded> {
    const k = key(projectId, agentId, folder.id);
    const previous = this.loaded.get(k);
    const loadedAt = this.clock.now().toISOString();
    let next: Loaded;
    try {
      const root = await loadDefs(folder);
      const host = this.host(projectId, agentId, folder);
      const tree = await bootModules(root, {
        ifaces: table as unknown as IfaceTable,
        resources: this.resources!,
        published: {
          ifaces: { [HOST_MODULE]: { host: hostDecl() } },
          values: { [HOST_MODULE]: { host } },
        },
      });
      const alias = Object.entries(root.manifest.provides).find(
        ([, ref]) => ref === MAIN_IFACE,
      )![0];
      const main = tree.api<Loaded["main"]>(ROOT_MODULE, alias);
      next = { folder, tree, main, loadedAt, error: null };
      previous?.tree?.dispose();
      await recordVersion(
        historyDir(this.paths.root, projectId, agentId),
        folder,
        this.clock.now(),
      );
    } catch (err) {
      const error = messageOf(err);
      this.log.line(`[workflows] ${k}@${folder.revision}: ${error}`);
      next = {
        folder,
        tree: previous?.tree ?? null,
        main: previous?.main ?? null,
        loadedAt: previous?.loadedAt ?? loadedAt,
        error,
      };
    }
    if (this.disposed) {
      next.tree?.dispose();
      return next;
    }
    this.loaded.set(k, next);
    this.notify(projectId, agentId, this.info(folder.id, next));
    return next;
  }

  private host(projectId: string, agentId: string, folder: WorkflowFolder) {
    const service = this;
    let state: unknown = null;
    let stateRead: Promise<void> | null = null;
    const ensureState = () => (stateRead ??= readState(folder.dir).then((s) => void (state = s)));
    void ensureState();
    return {
      async runAgent(input: { text: string; sessionId?: string }) {
        if (typeof input?.text !== "string" || input.text === "")
          throw new Error("runAgent: text is required");
        const sessionId =
          input.sessionId ??
          (await service.sessions.createSession({ projectId, agentId })).sessionId;
        await service.runner.startTask(sessionId, [userText(input.text, "server")]);
        return { sessionId };
      },
      sessionStatus: (sessionId: string) => service.runner.statusOf(sessionId),
      getState: () => state,
      async setState(next: unknown) {
        await ensureState();
        state = next ?? null;
        await writeState(folder.dir, state);
      },
      log: (message: string) => service.log.line(`[workflow ${folder.id}] ${message}`),
    };
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
    if (!fs.existsSync(declared)) return;
    // Watch the REAL path: libuv compares each event's filename against the string it was
    // given, and a Windows short name (`RUNNER~1\…`, which is what os.tmpdir() hands back
    // on a CI runner) never matches the long name the events carry — the mismatch trips an
    // assertion inside fs-event.c and aborts the whole process, which no `try` can catch.
    let dir: string;
    try {
      dir = fs.realpathSync.native(declared);
    } catch {
      dir = declared;
    }
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
        const id = typeof filename === "string" ? filename.split(/[\\/]/)[0] : undefined;
        if (id === undefined || !isWorkflowId(id) || filename?.endsWith("state.json")) return;
        this.schedule(projectId, agentId, id);
      });
    } catch {
      return;
    }
    watcher.on("error", () => {
      watcher.close();
      this.watchers.delete(k);
    });
    this.watchers.set(k, watcher);
  }

  private schedule(projectId: string, agentId: string, workflowId: string): void {
    const k = key(projectId, agentId, workflowId);
    const t = this.pending.get(k);
    if (t) clearTimeout(t);
    this.pending.set(
      k,
      setTimeout(() => {
        this.pending.delete(k);
        void this.reload(projectId, agentId, workflowId).catch((err) => {
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

/** The published `WorkflowHost` declaration, straight from the platform's interface table. */
function hostDecl(): IfaceDecl {
  const decl = (table as unknown as { ifaces: Record<string, IfaceDecl> }).ifaces[HOST_IFACE];
  if (!decl) throw new Error(`${HOST_IFACE} is not in ifaces.json (regenerate it)`);
  return decl;
}
