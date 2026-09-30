/**
 * WorkflowService: boots every workflow folder of an Agent as a module tree of its own.
 *
 * A workflow is a plugin package: hand-written manifests in `package.json#penguin.modules`
 * and an `index.ts` whose default export pairs them with code. Its root module must be
 * named `Workflow` and provide `WorkflowMain`; the server publishes `WorkflowHost` to the
 * tree as module `Host`, and the slots it opens to workflows under the platform's own
 * module names (today `WebModule.sessionTabs`), so a workflow contributes a tab the way a
 * plugin does and the host scopes it to the Agent.
 *
 * Three checks run before any create(), and a failure of any keeps the previous instance
 * serving with the problem named: the source is type-checked under `strict` against the
 * types the harness wrote into the folder when the workflow was new (./harness-types.ts,
 * ./compile.ts); those are compared with this platform's, both ways, by the compiler
 * (../plugin/iface-check.ts); and the tree is checked like any other — wiring, slots,
 * contribution shapes.
 *
 * Loading is by content: the folder's revision (store.ts) names the directory the source
 * is emitted into, so an edited workflow is a new import URL rather than a hit in the ESM
 * cache, and every successful load records the folder as a version the Agent (or the
 * user) can roll back to. A watcher on the `workflows/` folder reloads on change, debounced, and the users of
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
  Manifest,
  ModuleDef,
  ModuleTree,
} from "@prismshadow/penguin-core/kernel";
import { userText } from "@prismshadow/penguin-core";
import table from "../ifaces.json" with { type: "json" };
import type { ServerEvent } from "../api/types.js";
import type { Channels, Clock, Hmr, Log, Paths } from "../hmr/capabilities.js";
import { userChannelKey } from "../http/routes/events.js";
import type { AgentIndex, Members, Projects } from "../mechanisms/projects.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type {
  WorkflowInfo,
  WorkflowInput,
  WorkflowRequest,
  WorkflowResponse,
  WorkflowTab,
  WorkflowVersion,
  Workflows,
} from "../mechanisms/workflows.js";
import { ScheduleSessionCreator, ScheduleTaskRunner } from "../runtime/scheduler.js";
import { compileWorkflow, pruneBuilds, writeLoadStatus } from "./compile.js";
import { installHarnessTypes, readHarnessTable } from "./harness-types.js";
import { checkIfaces, ifaceQuestions } from "../plugin/iface-check.js";
import { loadTypeScript } from "../plugin/typescript.js";
import {
  historyDir,
  isSafeRelPath,
  isTempName,
  isWorkflowId,
  listFolders,
  listVersions,
  readFolder,
  readState,
  recordVersion,
  restoreVersion,
  STATE_FILE,
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
/** The platform module whose slots the host opens to workflows, and the slots it opens. */
export const WEB_MODULE = "WebModule";
export const WEB_IFACE = `${PKG}#WebShell`;
export const TABS_SLOT = "sessionTabs";
const OPEN_WEB_SLOTS = [TABS_SLOT] as const;
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

/** Reads `package.json`: the manifests, and that the package is an ES module. */
async function readManifests(folder: WorkflowFolder): Promise<Manifest[]> {
  const raw = JSON.parse(
    await fs.promises.readFile(path.join(folder.dir, "package.json"), "utf8"),
  ) as {
    type?: unknown;
    penguin?: { modules?: unknown };
  };
  if (raw.type !== "module") {
    throw new Error('package.json must set "type": "module" (a workflow is an ES module)');
  }
  const list = raw.penguin?.modules;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("package.json#penguin.modules must list at least the `Workflow` module");
  }
  return list.map((doc, i) => {
    try {
      return parseManifest(doc);
    } catch (err) {
      throw new Error(`package.json#penguin.modules[${i}]: ${messageOf(err)}`);
    }
  });
}

/**
 * A workflow that loads and shows nothing is the quietest way to get this wrong: the pages are
 * written, the load is green, and no tab appears, because a page is only a file until the
 * manifest contributes a tab for it. The author is usually an Agent with nothing but these
 * files and the load status, so the status says it, with the entry to add.
 */
export function loadHints(
  uiRev: string | null,
  tabs: readonly WorkflowTab[],
  error: string | null,
): string[] {
  if (error !== null || uiRev === null || tabs.length > 0) return [];
  const entry = {
    key: "main",
    title: "<tab title>",
    renderer: { iframe: { src: `${UI_DIR}/index.html` } },
  };
  return [
    `${UI_DIR}/ has pages but the manifest contributes no tab, so nothing shows beside the chat. ` +
      `In package.json, under penguin.modules[0] (the module named Workflow), set ` +
      `"contributes": ${JSON.stringify({ [`${WEB_MODULE}.${TABS_SLOT}`]: [entry] })} — ` +
      `one entry per tab, src a file under ${UI_DIR}/.`,
  ];
}

/**
 * The tabs the manifests contribute to `WebModule.sessionTabs`, with each page's path (in
 * the folder, under `ui/`) turned into the URL it is served from. The slot's shape was
 * checked with the tree; where a page may live is this host's rule.
 */
function contributedTabs(manifests: readonly Manifest[], uiBase: string): WorkflowTab[] {
  const tabs: WorkflowTab[] = [];
  const keys = new Set<string>();
  for (const m of manifests) {
    for (const entry of m.contributes[`${WEB_MODULE}.${TABS_SLOT}`] ?? []) {
      const tab = entry as unknown as WorkflowTab;
      if (keys.has(tab.key)) {
        throw new Error(
          `contribution '${tab.id}': another tab of this workflow already has the key '${tab.key}'`,
        );
      }
      keys.add(tab.key);
      if (!("iframe" in tab.renderer)) {
        tabs.push(tab);
        continue;
      }
      const src = tab.renderer.iframe.src;
      if (!isSafeRelPath(src) || !src.startsWith(`${UI_DIR}/`)) {
        throw new Error(
          `contribution '${tab.id}': renderer.iframe.src must be a file under ${UI_DIR}/ (got '${src}')`,
        );
      }
      const rest = src
        .slice(UI_DIR.length + 1)
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      tabs.push({ ...tab, renderer: { iframe: { src: `${uiBase}/${rest}` } } });
    }
  }
  return tabs;
}

/** Pairs the manifests with the emitted default export, by name. */
async function loadDefs(manifests: readonly Manifest[], entry: string): Promise<ModuleDef> {
  const mod = (await import(pathToFileURL(entry).href)) as {
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
  @Use() private readonly hmr!: Hmr;
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
    let next: Loaded;
    /** The tree this attempt booted, so a later throw can let it go instead of leaking it. */
    let booted: { dispose: () => void } | null = null;
    try {
      const manifests = await readManifests(folder);
      const tabs = contributedTabs(manifests, uiBase(projectId, agentId, folder.id));
      const ts = await loadTypeScript(this.hmr.assetsDir());
      // A new workflow takes its types from THIS harness; one that has them keeps them, and
      // they are its side of the comparison below.
      installHarnessTypes(
        folder.dir,
        table as unknown as IfaceTable,
        [HOST_IFACE, MAIN_IFACE],
        this.clock.now(),
      );
      const entry = compileWorkflow(ts, folder.dir, folder.revision);
      const written = readHarnessTable(folder.dir);
      if (typeof written === "string") throw new Error(written);
      const fit = checkIfaces(
        ts,
        table as unknown as IfaceTable,
        written,
        ifaceQuestions(manifests),
      );
      // An interface the workflow names but holds no types for cannot be compared, and for a
      // workflow that is a problem, not a pass.
      const misfits = [
        ...fit.uncompared.map((q) => `${q}: not among the types this workflow was written against`),
        ...fit.problems,
      ];
      if (misfits.length > 0) throw new Error(misfits.join("\n"));
      const root = await loadDefs(manifests, entry);
      const host = this.host(projectId, agentId, folder);
      const tree = await bootModules(root, {
        ifaces: table as unknown as IfaceTable,
        resources: this.resources!,
        published: {
          ifaces: { [HOST_MODULE]: { host: hostDecl() }, [WEB_MODULE]: { web: webSlotsDecl() } },
          values: { [HOST_MODULE]: { host }, [WEB_MODULE]: { web: {} } },
        },
      });
      const alias = Object.entries(root.manifest.provides).find(
        ([, ref]) => ref === MAIN_IFACE,
      )![0];
      const main = tree.api<Loaded["main"]>(ROOT_MODULE, alias);
      next = { folder, tree, main, tabs, loadedAt, error: null };
      booted = tree;
      // Recording the version is bookkeeping around a load that has already succeeded, so it
      // cannot be inside the try that decides whether the load failed: a copy that ENOENTs on
      // a file rewritten since it was hashed would hand the caller back the tree disposed
      // just above, and leak the one that is actually serving.
      previous?.tree?.dispose();
      pruneBuilds(folder.dir, folder.revision);
      try {
        await recordVersion(
          historyDir(this.paths.root, projectId, agentId),
          folder,
          this.clock.now(),
        );
      } catch (err) {
        this.log.line(
          `[workflows] ${k}@${folder.revision}: version not recorded: ${messageOf(err)}`,
        );
      }
    } catch (err) {
      const error = messageOf(err);
      this.log.line(`[workflows] ${k}@${folder.revision}: ${error}`);
      // A tree booted before the throw serves nobody: nothing holds it, so it is let go here
      // rather than left behind. The previous instance keeps answering — it was never
      // disposed, because that only happens once the new one is in place.
      booted?.dispose();
      next = {
        folder,
        tree: previous?.tree ?? null,
        main: previous?.main ?? null,
        tabs: previous?.tabs ?? [],
        loadedAt: previous?.loadedAt ?? loadedAt,
        error,
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

  private host(projectId: string, agentId: string, folder: WorkflowFolder) {
    const service = this;
    let state: unknown = null;
    let stateRead: Promise<void> | null = null;
    const ensureState = () => (stateRead ??= readState(folder.dir).then((s) => void (state = s)));
    void ensureState();
    return {
      listAgents: () => service.agents.list(projectId).map((row) => ({ agentId: row.agentId })),
      async createSession(opts?: { agentId?: string }) {
        const target = opts?.agentId ?? agentId;
        if (!service.agents.exists(projectId, target)) {
          throw new Error(`createSession: this Project has no Agent '${target}'`);
        }
        return service.sessions.createSession({ projectId, agentId: target });
      },
      async run(sessionId: string, input: WorkflowInput[]) {
        service.ownSession(projectId, sessionId, "run");
        const texts = (Array.isArray(input) ? input : []).map((item) => item?.text);
        if (texts.length === 0 || texts.some((t) => typeof t !== "string" || t === "")) {
          throw new Error('run: input is a non-empty list of { text: "…" } items');
        }
        // Whatever the workflow stamped, the Agent hears the server, never a person.
        return service.runner.startTask(
          sessionId,
          texts.map((text) => userText(text, "server")),
          { queueIfBusy: true },
        );
      },
      sessionStatus: (sessionId: string) => {
        service.ownSession(projectId, sessionId, "sessionStatus");
        return service.runner.statusOf(sessionId);
      },
      getState: () => state,
      async setState(next: unknown) {
        await ensureState();
        state = next ?? null;
        await writeState(folder.dir, state);
      },
      log: (message: string) => service.log.line(`[workflow ${folder.id}] ${message}`),
    };
  }

  /** A workflow reaches the Sessions of its own Project and no others. */
  private ownSession(projectId: string, sessionId: string, call: string): void {
    if (this.sessionIndex.findById(sessionId)?.projectId !== projectId) {
      throw new Error(`${call}: this Project has no Session '${sessionId}'`);
    }
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
    if (!fs.existsSync(declared)) {
      this.awaitFirstWorkflow(projectId, agentId, declared);
      return;
    }
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
        const segments = typeof filename === "string" ? filename.split(/[\\/]/) : [];
        const id = segments[0];
        // The workflow's own document is not code, and neither is the staging file a write
        // of it goes through: `state.json` used to be the only name skipped, so every
        // `setState` recompiled the workflow and tore down the tree that had just written it.
        if (id === undefined || !isWorkflowId(id)) return;
        if (filename?.endsWith(STATE_FILE) || (filename !== null && isTempName(filename))) return;
        // The server's own emit (`.build/`), and any other dot-directory, is not an edit.
        if (segments[1]?.startsWith(".")) return;
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

  /**
   * An Agent with no `workflows/` folder yet: watch its own directory for that folder to
   * appear. The Agent makes its first workflow with its file tools and nothing else — without
   * this, nothing noticed until somebody listed the workflows again, and the Agent sat
   * waiting for a load that was never going to happen.
   */
  private awaitFirstWorkflow(projectId: string, agentId: string, declared: string): void {
    const k = `${projectId}/${agentId}`;
    const parent = path.dirname(declared);
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(fs.realpathSync.native(parent), (_event, filename) => {
        if (filename !== path.basename(declared) || !fs.existsSync(declared)) return;
        watcher.close();
        this.watchers.delete(k);
        // The folder exists now: watch it properly, and load whatever is already inside.
        void this.list(projectId, agentId).catch((err) =>
          this.log.line(`[workflows] ${k}: ${messageOf(err)}`),
        );
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

/** Where a workflow's `ui/` is served from (./routes.ts). */
function uiBase(projectId: string, agentId: string, workflowId: string): string {
  const [p, a, w] = [projectId, agentId, workflowId].map(encodeURIComponent);
  return `/api/projects/${p}/agents/${a}/workflows/${w}/${UI_DIR}`;
}

/**
 * The slots the host opens to a workflow tree, published under the platform module's own
 * name: the slot declarations come from the platform's table (so a workflow's contribution
 * has the shape a plugin's has), and only the opened ones are there — contributing to any
 * other is `no-such-slot`. No members: there is nothing to require from it.
 */
function webSlotsDecl(): IfaceDecl {
  const decl = (table as unknown as { ifaces: Record<string, IfaceDecl> }).ifaces[WEB_IFACE];
  if (!decl) throw new Error(`${WEB_IFACE} is not in ifaces.json (regenerate it)`);
  const slots: IfaceDecl["slots"] = {};
  for (const name of OPEN_WEB_SLOTS) {
    const slot = decl.slots[name];
    if (!slot) throw new Error(`${WEB_IFACE} declares no slot '${name}' (regenerate ifaces.json)`);
    slots[name] = slot;
  }
  return { name: "WorkflowWebSlots", methods: {}, slots };
}

/** The published `WorkflowHost` declaration, straight from the platform's interface table. */
function hostDecl(): IfaceDecl {
  const decl = (table as unknown as { ifaces: Record<string, IfaceDecl> }).ifaces[HOST_IFACE];
  if (!decl) throw new Error(`${HOST_IFACE} is not in ifaces.json (regenerate it)`);
  return decl;
}
