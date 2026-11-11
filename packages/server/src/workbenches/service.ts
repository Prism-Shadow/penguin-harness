/**
 * WorkbenchService: boots every workbench folder of an Agent as a module tree of its own.
 *
 * A workbench is a plugin package: hand-written manifests in `package.json#penguin.modules`
 * and an `index.ts` whose default export pairs them with code. Its root module must be
 * named `Workbench` and provide `WorkbenchMain`; the server publishes `WorkbenchHost` to the
 * tree as module `Host`, and the slots it opens to workbenches under the platform's own
 * module names (today `WebModule.sessionTabs`), so a workbench contributes a tab the way a
 * plugin does and the host scopes it to the Agent.
 *
 * Three checks run before any create(), and a failure of any keeps the previous instance
 * serving with the problem named: the source is type-checked under `strict` against the
 * types the harness wrote into the folder when the workbench was new (./harness-types.ts,
 * ./compile.ts); those are compared with this platform's, both ways, by the compiler
 * (../plugin/iface-check.ts); and the tree is checked like any other — wiring, slots,
 * contribution shapes. A `ui/` with TSX pages adds one more: the pages are type-checked
 * against the page runtime this server serves them with (./compile-ui.ts).
 *
 * Loading is by content: the folder's revision (store.ts) names the directory the source
 * is emitted into, so an edited workbench is a new import URL rather than a hit in the ESM
 * cache, and every successful load commits the folder to the Agent State repository
 * (./repo.ts) as a version the Agent (or the user) can roll back to. A watcher on the Agent
 * State's `workbenches/` folder reloads on change, debounced, and the users of the Project
 * hear `workbench_building` when a load starts and `workbench_updated` when it ends.
 *
 * Two switches decide whether a workbench runs, each an empty marker file (./store.ts): its own
 * (`<id>/.disabled`) and the Agent's (`workbenches/.disabled`). Only with both off-markers absent
 * is it loaded; otherwise it is listed from its folder, every serving route refuses it, and no
 * listing, watcher event or request loads it. The markers are dot entries the watcher ignores,
 * so a switch takes effect through setEnabled / setAgentEnabled, which unload or load at once.
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
import { agentDir, userText } from "@prismshadow/penguin-core";
import type { IconImage } from "@prismshadow/penguin-core";
import table from "../ifaces.json" with { type: "json" };
import type { ServerEvent } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { Channels, Clock, Config, Hmr, Log, Paths } from "../hmr/capabilities.js";
import { userChannelKey } from "../http/routes/events.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import type { AgentIndex, Members, Projects } from "../mechanisms/projects.js";
import type { Traces } from "../mechanisms/traces.js";
import { workbenchResult } from "./result.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type {
  AppCenterShortcut,
  WorkbenchInfo,
  WorkbenchInput,
  WorkbenchRecord,
  WorkbenchRequest,
  WorkbenchResponse,
  WorkbenchTab,
  WorkbenchUiFile,
  WorkbenchUiRuntime,
  WorkbenchUiRuntimeFile,
  WorkbenchVersion,
  Workbenches,
} from "../mechanisms/workbenches.js";
import { ScheduleSessionCreator, ScheduleTaskRunner } from "../runtime/scheduler.js";
import {
  agentShortcuts,
  appCenterIconRef,
  AppCenterManifestInvalid,
  readAppCenterIcon,
  readAppCenterManifest,
  writeAppCenterShow,
  type AppCenterManifest,
} from "./app-center.js";
import { migrateWorkbenches } from "./migrate.js";
import { WorkbenchSubscriptions } from "./subscribe.js";
import {
  BUILD_DIR,
  compileWorkbench,
  pruneBuilds,
  readLoadStatus,
  writeLoadStatus,
} from "./compile.js";
import { compileWorkbenchUi, hasTsxPages, type UiBuild } from "./compile-ui.js";
import { installHarnessTypes, readHarnessTable } from "./harness-types.js";
import { checkIfaces, ifaceQuestions } from "../plugin/iface-check.js";
import { loadTypeScript } from "../plugin/typescript.js";
import { openUiRuntime, requireUiRuntime, type UiRuntime, type WebFiles } from "./ui-runtime.js";
import { AgentStateRepo, agentStateRepoDir } from "./repo.js";
import {
  isSafeRelPath,
  isSwitchedOff,
  isTempName,
  isWorkbenchId,
  listFolders,
  readFolder,
  readLoadedSource,
  readState,
  restoreSource,
  STATE_FILE,
  UI_DIR,
  workbenchesDir,
  writeState,
  writeSwitch,
  type WorkbenchFolder,
} from "./store.js";

const PKG = "@prismshadow/penguin-server";
export const HOST_MODULE = "Host";
export const ROOT_MODULE = "Workbench";
export const HOST_IFACE = `${PKG}#WorkbenchHost`;
export const MAIN_IFACE = `${PKG}#WorkbenchMain`;
/** The platform module whose slots the host opens to workbenches, and the slots it opens. */
export const WEB_MODULE = "WebModule";
export const WEB_IFACE = `${PKG}#WebShell`;
export const TABS_SLOT = "sessionTabs";
const OPEN_WEB_SLOTS = [TABS_SLOT] as const;
/** A burst of file writes (an editor, a git checkout, a rollback) becomes one reload. */
const WATCH_SETTLE_MS = 300;

interface Loaded {
  folder: WorkbenchFolder;
  tree: ModuleTree | null;
  main: { handle(request: WorkbenchRequest): Promise<WorkbenchResponse> } | null;
  tabs: WorkbenchTab[];
  loadedAt: string;
  error: string | null;
  /**
   * The revision whose `.build/<revision>/ui/` holds the SERVING instance's compiled pages —
   * the previous one's while `error` is set — or null when its pages are served as written.
   */
  uiBuild: string | null;
  /** What the folder's package.json declares for the App Center, as read for this load. */
  appCenter: AppCenterManifest;
}

function key(projectId: string, agentId: string, workbenchId: string): string {
  return `${projectId}/${agentId}/${workbenchId}`;
}

/** Where a workbench's folder sits in the Agent State repository. */
function repoPath(workbenchId: string): string {
  return `workbenches/${workbenchId}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Reads `package.json`: the manifests, and that the package is an ES module. */
async function readManifests(folder: WorkbenchFolder): Promise<Manifest[]> {
  const raw = JSON.parse(
    await fs.promises.readFile(path.join(folder.dir, "package.json"), "utf8"),
  ) as {
    type?: unknown;
    penguin?: { modules?: unknown };
  };
  if (raw.type !== "module") {
    throw new Error('package.json must set "type": "module" (a workbench is an ES module)');
  }
  const list = raw.penguin?.modules;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("package.json#penguin.modules must list at least the `Workbench` module");
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
 * A workbench that loads and shows nothing is the quietest way to get this wrong: the pages are
 * written, the load is green, and no tab appears, because a page is only a file until the
 * manifest contributes a tab for it. The author is usually an Agent with nothing but these
 * files and the load status, so the status says it, with the entry to add.
 */
export function loadHints(
  uiRev: string | null,
  tabs: readonly WorkbenchTab[],
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
      `In package.json, under penguin.modules[0] (the module named Workbench), set ` +
      `"contributes": ${JSON.stringify({ [`${WEB_MODULE}.${TABS_SLOT}`]: [entry] })} — ` +
      `one entry per tab, src a file under ${UI_DIR}/.`,
  ];
}

/**
 * The tabs the manifests contribute to `WebModule.sessionTabs`, with each page's path (in
 * the folder, under `ui/`) turned into the URL it is served from. The slot's shape was
 * checked with the tree; where a page may live is this host's rule.
 */
function contributedTabs(manifests: readonly Manifest[], uiBase: string): WorkbenchTab[] {
  const tabs: WorkbenchTab[] = [];
  const keys = new Set<string>();
  for (const m of manifests) {
    for (const entry of m.contributes[`${WEB_MODULE}.${TABS_SLOT}`] ?? []) {
      const tab = entry as unknown as WorkbenchTab;
      if (keys.has(tab.key)) {
        throw new Error(
          `contribution '${tab.id}': another tab of this workbench already has the key '${tab.key}'`,
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
export class WorkbenchService implements Workbenches {
  @Use() private readonly paths!: Paths;
  @Use() private readonly config!: Config;
  @Use() private readonly clock!: Clock;
  @Use() private readonly log!: Log;
  @Use() private readonly channels!: Channels;
  @Use() private readonly members!: Members;
  @Use() private readonly projects!: Projects;
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly agents!: AgentIndex;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly sessionIndex!: SessionIndex;
  @Use() private readonly traces!: Traces;
  @Use() private readonly runner!: ScheduleTaskRunner;
  @Use() private readonly sessions!: ScheduleSessionCreator;

  private readonly loaded = new Map<string, Loaded>();
  private readonly watchers = new Map<string, { close(): void }>();
  private readonly pending = new Map<string, NodeJS.Timeout>();
  /** The load in flight per workbench: a load takes a compiler run, so two can overlap. */
  private readonly loading = new Map<string, Promise<Loaded>>();
  /** The revision the newest queued load will load, while one is queued (see reloadIfChanged). */
  private readonly loadingRevision = new Map<string, string>();
  /** Workbenches whose folder is being deleted: the watcher schedules no reload for them. */
  private readonly removing = new Set<string>();
  private resources: ClassCtx["resources"] | null = null;
  private disposed = false;
  /** The Agent State repository; its writes stay in order across instances (./repo.ts). */
  private repo(projectId: string, agentId: string): AgentStateRepo {
    return new AgentStateRepo({
      gitdir: agentStateRepoDir(agentDir(this.paths.root, projectId, agentId)),
      now: () => this.clock.now(),
      log: (line) => this.log.line(`[workbenches] ${projectId}/${agentId}: ${line}`),
    });
  }

  /** A read of the repository that fails is logged and answered as an error the caller can retry. */
  private async fromRepo<T>(k: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (err) {
      this.log.line(`[workbenches] ${k}: history not read: ${messageOf(err)}`);
      throw new HttpError(
        500,
        "workbench_history_unreadable",
        `The workbench's history could not be read: ${messageOf(err)}`,
      );
    }
  }

  /** Agents whose State is being replaced (whileReleased), and when that ends. */
  private readonly held = new Map<string, Promise<void>>();

  /**
   * Every way into an Agent's workbenches comes through here, so it waits out an import first.
   * Asked on every access, not once: until the old place is a link, a workbench can still be
   * written there and is moved in once it settles (./migrate-state.ts). Absent or linked, it
   * costs a few stats, and concurrent callers share a run.
   */
  private async migrate(projectId: string, agentId: string): Promise<void> {
    await this.held.get(`${projectId}/${agentId}`);
    return migrateWorkbenches(agentDir(this.paths.root, projectId, agentId));
  }

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

  async list(projectId: string, agentId: string): Promise<WorkbenchInfo[]> {
    await this.migrate(projectId, agentId);
    this.watch(projectId, agentId);
    const base = workbenchesDir(this.paths.root, projectId, agentId);
    const folders = await listFolders(base);
    const all = !(await isSwitchedOff(base));
    const out: WorkbenchInfo[] = [];
    for (const folder of folders) {
      const { info, unloaded } = await this.settle(projectId, agentId, folder, all);
      // A marker written by hand is only seen here: what it unloaded is news to open pages.
      if (unloaded) this.notify(projectId, agentId, info);
      out.push(info);
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

  async agentEnabled(projectId: string, agentId: string): Promise<boolean> {
    await this.migrate(projectId, agentId);
    return !(await isSwitchedOff(workbenchesDir(this.paths.root, projectId, agentId)));
  }

  async reload(projectId: string, agentId: string, workbenchId: string): Promise<WorkbenchInfo> {
    const folder = await this.folder(projectId, agentId, workbenchId);
    if (!(await this.runs(projectId, agentId, folder))) throw new WorkbenchDisabled(workbenchId);
    return this.info(projectId, agentId, workbenchId, await this.load(projectId, agentId, folder));
  }

  async reloadIfEnabled(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<WorkbenchInfo> {
    const folder = await this.folder(projectId, agentId, workbenchId);
    if (await this.runs(projectId, agentId, folder)) {
      try {
        return this.info(
          projectId,
          agentId,
          workbenchId,
          await this.load(projectId, agentId, folder),
        );
      } catch (err) {
        // Switched off while it loaded: answered as it stands, like any other that does not run.
        if (!(err instanceof WorkbenchDisabled)) throw err;
      }
    }
    return (await this.settle(projectId, agentId, folder, false)).info;
  }

  async setEnabled(
    projectId: string,
    agentId: string,
    workbenchId: string,
    enabled: boolean,
  ): Promise<WorkbenchInfo> {
    const folder = await this.folder(projectId, agentId, workbenchId);
    await writeSwitch(folder.dir, enabled);
    const all = await this.agentEnabled(projectId, agentId);
    const { info, loaded } = await this.settle(projectId, agentId, folder, all);
    // A load announces itself; anything else is announced here, so open pages follow the switch.
    if (!loaded) this.notify(projectId, agentId, info);
    return info;
  }

  async setAgentEnabled(
    projectId: string,
    agentId: string,
    enabled: boolean,
  ): Promise<{ workbenches: WorkbenchInfo[]; enabled: boolean }> {
    await this.migrate(projectId, agentId);
    const base = workbenchesDir(this.paths.root, projectId, agentId);
    await writeSwitch(base, enabled);
    const workbenches: WorkbenchInfo[] = [];
    for (const folder of await listFolders(base)) {
      const { info, loaded } = await this.settle(projectId, agentId, folder, enabled);
      if (!loaded) this.notify(projectId, agentId, info);
      workbenches.push(info);
    }
    return { workbenches, enabled };
  }

  /**
   * The watcher's reload: only when the content differs from what is loaded, or from what the
   * load in flight is loading. An event is a hint, not an edit — Windows reports a `change` on
   * a directory when a file in it is read or written (the workbench's own state, `.build/`, and
   * a load's own reads of the folder), and reloading on those tore the tree down under the
   * request that had just written its state, or loaded the same folder twice over. The
   * revision is the content hash, so an edit always differs.
   *
   * A workbench this process has not loaded is compared with the revision its status file says
   * last loaded: the App Center watches Agents whose workbenches it only reads, and its own
   * reads would otherwise compile, on Windows, every workbench it lists.
   */
  private async reloadIfChanged(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<void> {
    const folder = await this.folder(projectId, agentId, workbenchId);
    if (!(await this.runs(projectId, agentId, folder))) return;
    const k = key(projectId, agentId, workbenchId);
    const current = this.loading.has(k)
      ? this.loadingRevision.get(k)
      : (this.loaded.get(k)?.folder.revision ?? (await readLoadStatus(folder.dir))?.revision);
    if (current === folder.revision) return;
    await this.load(projectId, agentId, folder);
  }

  async dispatch(
    projectId: string,
    agentId: string,
    workbenchId: string,
    request: WorkbenchRequest,
  ): Promise<WorkbenchResponse> {
    const loaded = await this.current(projectId, agentId, workbenchId);
    if (loaded.main === null) {
      return { status: 503, body: { error: loaded.error ?? "workbench is not loaded" } };
    }
    return loaded.main.handle(request);
  }

  async uiFile(
    projectId: string,
    agentId: string,
    workbenchId: string,
    rel: string,
  ): Promise<WorkbenchUiFile | null> {
    if (!isWorkbenchId(workbenchId)) return null;
    await this.migrate(projectId, agentId);
    const dir = path.join(workbenchesDir(this.paths.root, projectId, agentId), workbenchId);
    await this.refuseIfOff(projectId, agentId, workbenchId, dir);
    // No default document: which page a tab shows is what its contribution says.
    if (!isSafeRelPath(rel)) return null;
    const onDisk = path.join(dir, UI_DIR, rel);
    if (await isFile(onDisk)) {
      // Only a page needs to know whether it is compiled; every other file is served as it is.
      if (!/\.html?$/i.test(rel)) return { path: onDisk, compiled: null };
      const build = await this.uiBuild(projectId, agentId, workbenchId);
      return { path: onDisk, compiled: build === null ? null : this.runtimeLinks() };
    }
    // What a TSX page compiled to, from the instance that is serving.
    if (!rel.endsWith(".js")) return null;
    const build = await this.uiBuild(projectId, agentId, workbenchId);
    if (build === null) return null;
    const emitted = path.join(dir, BUILD_DIR, build, UI_DIR, rel);
    return (await isFile(emitted)) ? { path: emitted, compiled: null } : null;
  }

  async uiRuntimeFile(
    projectId: string,
    agentId: string,
    workbenchId: string,
    rel: string,
  ): Promise<WorkbenchUiRuntimeFile | null> {
    if (!isWorkbenchId(workbenchId)) return null;
    await this.migrate(projectId, agentId);
    const dir = path.join(workbenchesDir(this.paths.root, projectId, agentId), workbenchId);
    // A folder without package.json is not a workbench (./store.ts).
    if (!(await isFile(path.join(dir, "package.json")))) return null;
    await this.refuseIfOff(projectId, agentId, workbenchId, dir);
    return (await this.runtime()?.file(rel)) ?? null;
  }

  async history(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<WorkbenchVersion[]> {
    if (!isWorkbenchId(workbenchId)) return [];
    await this.migrate(projectId, agentId);
    return this.fromRepo(key(projectId, agentId, workbenchId), () =>
      this.repo(projectId, agentId).history(repoPath(workbenchId)),
    );
  }

  async rollback(
    projectId: string,
    agentId: string,
    workbenchId: string,
    revision: string,
  ): Promise<WorkbenchInfo> {
    const folder = await this.folder(projectId, agentId, workbenchId);
    if (!/^[0-9a-f]{12}$/.test(revision)) throw new WorkbenchNotFound("no such version");
    const files = await this.fromRepo(key(projectId, agentId, workbenchId), () =>
      this.repo(projectId, agentId).filesAt(repoPath(workbenchId), revision),
    );
    if (!files) throw new WorkbenchNotFound("no such version");
    // The load this triggers records the restored files as the newest version; a workbench
    // that does not run takes the files only, and records them when it next loads.
    await restoreSource(folder, files);
    return this.reloadIfEnabled(projectId, agentId, workbenchId);
  }

  async remove(projectId: string, agentId: string, workbenchId: string): Promise<void> {
    const folder = await this.folder(projectId, agentId, workbenchId);
    const k = key(projectId, agentId, workbenchId);
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
    try {
      await this.repo(projectId, agentId).removePath(
        repoPath(workbenchId),
        `workbench ${workbenchId}: removed`,
      );
    } catch (err) {
      this.log.line(`[workbenches] ${k}: removal not recorded: ${messageOf(err)}`);
    }
    this.forget(projectId, agentId, workbenchId);
  }

  async appCenter(projectId: string): Promise<AppCenterShortcut[]> {
    const out: AppCenterShortcut[] = [];
    // The index's order is the Agents list's (created, then id); a row whose folder is no longer
    // an Agent is not one the list shows either.
    for (const row of this.agents.list(projectId)) {
      const { agentId } = row;
      if (!(await this.agentConfig.exists(projectId, agentId))) continue;
      // One Agent whose older layout cannot be moved is left out, not the whole App Center.
      try {
        await this.migrate(projectId, agentId);
      } catch (err) {
        this.log.line(`[workbenches] ${projectId}/${agentId}: ${messageOf(err)}`);
        continue;
      }
      // An edit made while the App Center is open loads, and the load is announced.
      this.watch(projectId, agentId);
      const base = workbenchesDir(this.paths.root, projectId, agentId);
      // With the Agent-wide switch off none of its workbenches runs, so none has a tile.
      if (await isSwitchedOff(base)) continue;
      const agentName = (await this.agentConfig.readCardMeta(projectId, agentId)).name ?? agentId;
      out.push(
        ...(await agentShortcuts(projectId, { agentId, agentName }, base, (workbenchId) =>
          this.building(key(projectId, agentId, workbenchId)),
        )),
      );
    }
    return out;
  }

  async appCenterIcon(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<IconImage | null> {
    if (!isWorkbenchId(workbenchId)) return null;
    await this.migrate(projectId, agentId);
    const dir = path.join(workbenchesDir(this.paths.root, projectId, agentId), workbenchId);
    return readAppCenterIcon(dir, workbenchId);
  }

  async setAppCenter(
    projectId: string,
    agentId: string,
    workbenchId: string,
    show: boolean,
  ): Promise<WorkbenchInfo> {
    const folder = await this.folder(projectId, agentId, workbenchId);
    try {
      await writeAppCenterShow(folder.dir, show);
    } catch (err) {
      if (!(err instanceof AppCenterManifestInvalid)) throw err;
      throw new HttpError(
        409,
        "workbench_manifest_invalid",
        `The workbench's ${err.message}, so it cannot be changed from here.`,
      );
    }
    // The watcher sees the same edit; a load of the revision just written is shared, not repeated.
    // One that does not run is written all the same and answered from its folder.
    return this.reloadIfEnabled(projectId, agentId, workbenchId);
  }

  async releaseAgent(projectId: string, agentId: string): Promise<void> {
    const agentKey = `${projectId}/${agentId}`;
    // On Windows a recursive watcher holds its folder open, and a folder held open cannot be
    // moved; everywhere, a reload or a load finishing late would write `.build/` back into it.
    this.watchers.get(agentKey)?.close();
    this.watchers.delete(agentKey);
    const prefix = key(projectId, agentId, "");
    for (const [k, t] of this.pending) {
      if (!k.startsWith(prefix)) continue;
      clearTimeout(t);
      this.pending.delete(k);
    }
    await Promise.all(
      [...this.loading].filter(([k]) => k.startsWith(prefix)).map(([, p]) => p.catch(() => {})),
    );
    for (const [k, l] of this.loaded) {
      if (!k.startsWith(prefix)) continue;
      l.tree?.dispose();
      this.loaded.delete(k);
    }
  }

  async whileReleased<T>(projectId: string, agentId: string, work: () => Promise<T>): Promise<T> {
    const agentKey = `${projectId}/${agentId}`;
    for (let held = this.held.get(agentKey); held; held = this.held.get(agentKey)) await held;
    let end!: () => void;
    this.held.set(agentKey, new Promise<void>((resolve) => (end = resolve)));
    try {
      await this.releaseAgent(projectId, agentId);
      return await work();
    } finally {
      this.held.delete(agentKey);
      end();
    }
  }

  // ---- internals ------------------------------------------------------------------

  /**
   * A load of the workbench is under way or queued behind another. The watcher's settle window
   * does not count: a change event there may turn out to change nothing (Windows reports one
   * when a file is read), and then no load starts and no event follows to end it.
   * `workbench_building` marks the start of every load that does run.
   */
  private building(k: string): boolean {
    return this.loading.has(k);
  }

  private async folder(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<WorkbenchFolder> {
    if (!isWorkbenchId(workbenchId)) throw new WorkbenchNotFound("no such workbench");
    await this.migrate(projectId, agentId);
    const dir = path.join(workbenchesDir(this.paths.root, projectId, agentId), workbenchId);
    const folder = await readFolder(dir, workbenchId);
    if (!folder) throw new WorkbenchNotFound("no such workbench");
    return folder;
  }

  /** The Web App's files this server serves, where the page runtime travels (./ui-runtime.ts). */
  private webFiles(): WebFiles {
    return this.hmr.resolveWebSource() ?? { kind: "dir", dir: this.config.webDist };
  }

  /** The page runtime, or null when this server has none or cannot read it. */
  private runtime(): UiRuntime | null {
    try {
      return openUiRuntime(this.webFiles());
    } catch (err) {
      this.log.line(`[workbenches] ${messageOf(err)}`);
      return null;
    }
  }

  /** What a compiled page's import map names; null leaves the page as written. */
  private runtimeLinks(): WorkbenchUiRuntime | null {
    const manifest = this.runtime()?.manifest;
    return manifest === undefined
      ? null
      : { imports: manifest.imports, stylesheet: manifest.stylesheet };
  }

  /**
   * The serving instance's compiled-pages revision. A page can be asked for before anything
   * in this process listed its workbench (a frame reloading after a restart), so an instance
   * not yet loaded is loaded first.
   */
  private async uiBuild(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<string | null> {
    const loaded = this.loaded.get(key(projectId, agentId, workbenchId));
    if (loaded) return loaded.uiBuild;
    try {
      return (await this.current(projectId, agentId, workbenchId)).uiBuild;
    } catch (err) {
      if (err instanceof WorkbenchNotFound) return null;
      throw err;
    }
  }

  private async current(projectId: string, agentId: string, workbenchId: string): Promise<Loaded> {
    const folder = await this.folder(projectId, agentId, workbenchId);
    if (!(await this.runs(projectId, agentId, folder))) throw new WorkbenchDisabled(workbenchId);
    const k = key(projectId, agentId, workbenchId);
    const existing = this.loaded.get(k);
    if (existing && existing.folder.revision === folder.revision) return existing;
    return this.load(projectId, agentId, folder);
  }

  /** A loaded instance, which runs, so both its switches are on. */
  private info(projectId: string, agentId: string, id: string, l: Loaded): WorkbenchInfo {
    const { icon } = l.appCenter;
    return {
      id,
      name: l.folder.pkg.name,
      version: l.folder.pkg.version,
      revision: l.folder.revision,
      uiRev: l.folder.uiRev,
      tabs: l.tabs,
      loadedAt: l.loadedAt,
      error: l.error,
      hints: hintsOf(l),
      enabled: true,
      ...(l.appCenter.appCenter !== undefined ? { appCenter: l.appCenter.appCenter } : {}),
      ...(icon !== undefined ? { icon: appCenterIconRef(projectId, agentId, id, icon) } : {}),
    };
  }

  /** One that does not run, from its folder alone (see WorkbenchInfo). */
  private idleInfo(
    projectId: string,
    agentId: string,
    folder: WorkbenchFolder,
    enabled: boolean,
    declared: AppCenterManifest,
  ): WorkbenchInfo {
    const { appCenter, icon } = declared;
    return {
      id: folder.id,
      name: folder.pkg.name,
      version: folder.pkg.version,
      revision: folder.revision,
      uiRev: folder.uiRev,
      tabs: [],
      loadedAt: null,
      error: null,
      hints: [],
      enabled,
      ...(appCenter !== undefined ? { appCenter } : {}),
      ...(icon !== undefined
        ? { icon: appCenterIconRef(projectId, agentId, folder.id, icon) }
        : {}),
    };
  }

  /** Whether the workbench runs: neither its own off-marker nor the Agent's is there. */
  private async runs(
    projectId: string,
    agentId: string,
    folder: WorkbenchFolder,
  ): Promise<boolean> {
    return (
      !(await isSwitchedOff(workbenchesDir(this.paths.root, projectId, agentId))) &&
      !(await isSwitchedOff(folder.dir))
    );
  }

  /** A workbench that exists and does not run is refused; a missing one is left to the caller's 404. */
  private async refuseIfOff(
    projectId: string,
    agentId: string,
    workbenchId: string,
    dir: string,
  ): Promise<void> {
    if (!(await isFile(path.join(dir, "package.json")))) return;
    const base = workbenchesDir(this.paths.root, projectId, agentId);
    if ((await isSwitchedOff(base)) || (await isSwitchedOff(dir))) {
      throw new WorkbenchDisabled(workbenchId);
    }
  }

  /**
   * Brings one workbench in line with its switches (`all` is the Agent's): when it runs, loaded
   * unless the loaded instance already has this revision; otherwise unloaded, after any load in
   * flight has finished, and answered from its folder. `loaded` says a load ran (and announced
   * itself), `unloaded` that an instance was let go.
   */
  private async settle(
    projectId: string,
    agentId: string,
    folder: WorkbenchFolder,
    all: boolean,
  ): Promise<{ info: WorkbenchInfo; loaded: boolean; unloaded: boolean }> {
    const k = key(projectId, agentId, folder.id);
    const own = !(await isSwitchedOff(folder.dir));
    if (own && all) {
      const current = this.loaded.get(k);
      if (current && current.folder.revision === folder.revision) {
        return {
          info: this.info(projectId, agentId, folder.id, current),
          loaded: false,
          unloaded: false,
        };
      }
      try {
        const fresh = await this.load(projectId, agentId, folder);
        return {
          info: this.info(projectId, agentId, folder.id, fresh),
          loaded: true,
          unloaded: false,
        };
      } catch (err) {
        if (!(err instanceof WorkbenchDisabled)) throw err;
      }
    }
    // A load that started before the switch went off still lands; it is let go with the rest.
    await this.loading.get(k)?.catch(() => undefined);
    const unloaded = this.unload(k);
    const info = this.idleInfo(
      projectId,
      agentId,
      folder,
      !(await isSwitchedOff(folder.dir)),
      await readAppCenterManifest(folder.dir, folder.id),
    );
    return { info, loaded: false, unloaded };
  }

  /** Lets go of a loaded instance — its tree, and with it its subscriptions — and a pending reload. */
  private unload(k: string): boolean {
    const t = this.pending.get(k);
    if (t) clearTimeout(t);
    this.pending.delete(k);
    const loaded = this.loaded.get(k);
    if (!loaded) return false;
    loaded.tree?.dispose();
    this.loaded.delete(k);
    return true;
  }

  /**
   * One load at a time per workbench. The watcher and a request can both ask while the
   * compiler is still running for the last edit; the later one waits and then loads what
   * is on disk by then, so versions are recorded in order and never concurrently.
   */
  private load(projectId: string, agentId: string, folder: WorkbenchFolder): Promise<Loaded> {
    const k = key(projectId, agentId, folder.id);
    // The tab list, iframe and watcher can arrive together. They share one load of the same
    // revision instead of recompiling it and disposing its newly created tree for each caller.
    const inFlight = this.loading.get(k);
    if (inFlight && this.loadingRevision.get(k) === folder.revision) return inFlight;
    const after = this.loading.get(k) ?? Promise.resolve();
    const run = after
      .catch(() => undefined)
      .then(async () => {
        const current = (await readFolder(folder.dir, folder.id)) ?? folder;
        // Checked in the queue, after the loads before it: a switch turned off since this was
        // asked for is what wins (setEnabled waits for every load queued before its marker).
        if (!(await this.runs(projectId, agentId, current))) throw new WorkbenchDisabled(folder.id);
        if (this.loading.get(k) === run) this.loadingRevision.set(k, current.revision);
        return this.loadNow(projectId, agentId, current);
      });
    this.loading.set(k, run);
    this.loadingRevision.set(k, folder.revision);
    // Once per run: a caller that shares the run above hears nothing new.
    this.publish(projectId, {
      type: "workbench_building",
      projectId,
      agentId,
      workbenchId: folder.id,
    });
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
    folder: WorkbenchFolder,
  ): Promise<Loaded> {
    const k = key(projectId, agentId, folder.id);
    const previous = this.loaded.get(k);
    const loadedAt = this.clock.now().toISOString();
    let next: Loaded;
    /** The tree this attempt booted, so a later throw can let it go instead of leaking it. */
    let booted: { dispose: () => void } | null = null;
    /** Its handler's subscriptions (./subscribe.ts): they end with the tree, or here if it never serves. */
    let subscriptions: WorkbenchSubscriptions | null = null;
    /** Its compiled pages, emitted aside until the load has succeeded. */
    let pages: UiBuild | null = null;
    // Read whether or not the load succeeds: what the files declare is not the serving instance's.
    const appCenter = await readAppCenterManifest(folder.dir, folder.id);
    try {
      const manifests = await readManifests(folder);
      const tabs = contributedTabs(manifests, uiBase(projectId, agentId, folder.id));
      const ts = await loadTypeScript(this.hmr.assetsDir());
      // A new workbench takes its types from THIS harness; one that has them keeps them, and
      // they are its side of the comparison below.
      installHarnessTypes(
        folder.dir,
        table as unknown as IfaceTable,
        [HOST_IFACE, MAIN_IFACE],
        this.clock.now(),
      );
      const entry = compileWorkbench(ts, folder.dir, folder.revision);
      // Pages in TSX are the same load's second program, checked against the runtime this
      // server serves them with; a folder of plain pages never touches the runtime.
      if (hasTsxPages(folder.files)) {
        pages = compileWorkbenchUi(ts, folder, requireUiRuntime(this.webFiles()));
      }
      const written = readHarnessTable(folder.dir);
      if (typeof written === "string") throw new Error(written);
      const fit = checkIfaces(
        ts,
        table as unknown as IfaceTable,
        written,
        ifaceQuestions(manifests),
      );
      // An interface the workbench names but holds no types for cannot be compared, and for a
      // workbench that is a problem, not a pass.
      const misfits = [
        ...fit.uncompared.map(
          (q) => `${q}: not among the types this workbench was written against`,
        ),
        ...fit.problems,
      ];
      if (misfits.length > 0) throw new Error(misfits.join("\n"));
      const root = await loadDefs(manifests, entry);
      const own = new WorkbenchSubscriptions({
        channels: this.channels,
        statusOf: (sessionId) => this.runner.statusOf(sessionId),
        now: () => this.clock.now().getTime(),
        log: (line) => this.log.line(`[workbench ${folder.id}] ${line}`),
      });
      subscriptions = own;
      const host = await this.host(projectId, agentId, folder, own);
      const modules = await bootModules(root, {
        ifaces: table as unknown as IfaceTable,
        resources: this.resources!,
        published: {
          ifaces: { [HOST_MODULE]: { host: hostDecl() }, [WEB_MODULE]: { web: webSlotsDecl() } },
          values: { [HOST_MODULE]: { host }, [WEB_MODULE]: { web: {} } },
        },
      });
      // Whatever lets this tree go — a reload replacing it, a removal, the platform going away —
      // ends its handler's subscriptions with it: each one holds a Session's channel.
      const tree: ModuleTree = {
        ...modules,
        dispose: () => {
          try {
            modules.dispose();
          } finally {
            own.close();
          }
        },
      };
      const alias = Object.entries(root.manifest.provides).find(
        ([, ref]) => ref === MAIN_IFACE,
      )![0];
      const main = tree.api<Loaded["main"]>(ROOT_MODULE, alias);
      booted = tree;
      // In place before this tree serves, and before anything the old one served is let go.
      pages?.commit();
      next = {
        folder,
        tree,
        main,
        tabs,
        loadedAt,
        error: null,
        uiBuild: pages === null ? null : folder.revision,
        appCenter,
      };
      // Recording the version is bookkeeping around a load that has already succeeded, so it
      // cannot be inside the try that decides whether the load failed: a repository that
      // cannot be written would hand the caller back the tree disposed just above, and leak
      // the one that is actually serving.
      previous?.tree?.dispose();
      pruneBuilds(folder.dir, folder.revision);
      try {
        if (folder.refused.length > 0) {
          this.log.line(
            `[workbenches] ${k}@${folder.revision}: not in its versions, git refuses the name: ${folder.refused.join(", ")}`,
          );
        }
        // Exactly the bytes that loaded: an edit since then is the next load's version.
        const files = await readLoadedSource(folder);
        if (files === null) {
          this.log.line(
            `[workbenches] ${k}@${folder.revision}: version not recorded: the files changed after they were read`,
          );
        } else {
          await this.repo(projectId, agentId).commitPath(
            repoPath(folder.id),
            files,
            `workbench ${folder.id} @${folder.revision}`,
          );
        }
      } catch (err) {
        this.log.line(
          `[workbenches] ${k}@${folder.revision}: version not recorded: ${messageOf(err)}`,
        );
      }
    } catch (err) {
      const error = messageOf(err);
      this.log.line(`[workbenches] ${k}@${folder.revision}: ${error}`);
      // A tree booted before the throw serves nobody: nothing holds it, so it is let go here
      // rather than left behind. The previous instance keeps answering — it was never
      // disposed, because that only happens once the new one is in place.
      booted?.dispose();
      subscriptions?.close();
      try {
        pages?.discard();
      } catch {
        // Left aside; the next load of this revision clears it.
      }
      next = {
        folder,
        tree: previous?.tree ?? null,
        main: previous?.main ?? null,
        tabs: previous?.tabs ?? [],
        loadedAt: previous?.loadedAt ?? loadedAt,
        error,
        uiBuild: previous?.uiBuild ?? null,
        appCenter,
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
      hints: hintsOf(next),
    });
    this.loaded.set(k, next);
    this.notify(projectId, agentId, this.info(projectId, agentId, folder.id, next));
    return next;
  }

  private async host(
    projectId: string,
    agentId: string,
    folder: WorkbenchFolder,
    subscriptions: WorkbenchSubscriptions,
  ) {
    const service = this;
    let state: unknown = await readState(folder.dir);
    return {
      listAgents: () => service.agents.list(projectId).map((row) => ({ agentId: row.agentId })),
      async createSession(opts?: { agentId?: string }) {
        const target = opts?.agentId ?? agentId;
        if (!service.agents.exists(projectId, target)) {
          throw new Error(`createSession: this Project has no Agent '${target}'`);
        }
        // Unattended, like a scheduled run: allow-all, whatever the default preset asks.
        return service.sessions.createSession({
          projectId,
          agentId: target,
          approvalMode: "allow-all",
          source: "workbench",
          client: "workbench",
        });
      },
      async run(sessionId: string, input: WorkbenchInput[]) {
        service.ownSession(projectId, sessionId, "run");
        const texts = (Array.isArray(input) ? input : []).map((item) => item?.text);
        if (texts.length === 0 || texts.some((t) => typeof t !== "string" || t === "")) {
          throw new Error('run: input is a non-empty list of { text: "…" } items');
        }
        // Whatever the workbench stamped, the Agent hears the server, never a person.
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
      sessionTitle: (sessionId: string) => {
        service.ownSession(projectId, sessionId, "sessionTitle");
        return service.sessionIndex.findById(sessionId)!.title;
      },
      async sessionResult(sessionId: string) {
        service.ownSession(projectId, sessionId, "sessionResult");
        const status = service.runner.statusOf(sessionId);
        if (status !== "idle") return workbenchResult(status, []);
        const row = service.sessionIndex.findById(sessionId)!;
        const messages = await service.traces.readMessages(projectId, row.agentId, sessionId);
        // A new task can begin while reading the trace; never label its prior answer complete.
        return workbenchResult(service.runner.statusOf(sessionId), messages);
      },
      subscribe(sessionId: string, listener: (record: WorkbenchRecord) => void) {
        service.ownSession(projectId, sessionId, "subscribe");
        return subscriptions.subscribe(sessionId, listener);
      },
      getState: () => state,
      async setState(next: unknown) {
        await writeState(folder.dir, next ?? null);
        state = next ?? null;
      },
      log: (message: string) => service.log.line(`[workbench ${folder.id}] ${message}`),
    };
  }

  /** A workbench reaches the Sessions of its own Project and no others. */
  private ownSession(projectId: string, sessionId: string, call: string): void {
    if (this.sessionIndex.findById(sessionId)?.projectId !== projectId) {
      throw new Error(`${call}: this Project has no Session '${sessionId}'`);
    }
  }

  /** Drops a workbench's instance and tells the Project's users it is gone. */
  private forget(projectId: string, agentId: string, workbenchId: string): void {
    this.unload(key(projectId, agentId, workbenchId));
    this.publish(projectId, { type: "workbench_removed", projectId, agentId, workbenchId });
  }

  private notify(projectId: string, agentId: string, workbench: WorkbenchInfo): void {
    this.publish(projectId, { type: "workbench_updated", projectId, agentId, workbench });
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
    if (this.watchers.has(k) || this.disposed || this.held.has(k)) return;
    const declared = workbenchesDir(this.paths.root, projectId, agentId);
    if (!fs.existsSync(declared)) {
      this.awaitFirstWorkbench(projectId, agentId, declared);
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
        // The workbench's own document is not code, and neither is the staging file a write
        // of it goes through: `state.json` used to be the only name skipped, so every
        // `setState` recompiled the workbench and tore down the tree that had just written it.
        if (id === undefined || !isWorkbenchId(id)) return;
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
   * An Agent with no `workbenches/` folder yet: poll that path until it appears. Native
   * directory notifications can miss its creation (observed under macOS filesystem load),
   * leaving no watcher on the new folder and no later event to recover from. Once it exists,
   * the normal recursive watcher takes over. The Agent uses its file tools only — without
   * this, nothing noticed until somebody listed the workbenches again, and the Agent sat
   * waiting for a load that was never going to happen.
   */
  private awaitFirstWorkbench(projectId: string, agentId: string, declared: string): void {
    const k = `${projectId}/${agentId}`;
    const appeared = (current: fs.Stats) => {
      if (!current.isDirectory()) return;
      watcher.close();
      this.watchers.delete(k);
      // Watch before scanning: edits made during the first load must still be noticed.
      void this.list(projectId, agentId).catch((err) =>
        this.log.line(`[workbenches] ${k}: ${messageOf(err)}`),
      );
    };
    const watcher = { close: () => fs.unwatchFile(declared, appeared) };
    try {
      fs.watchFile(declared, { persistent: false, interval: 500 }, appeared);
    } catch {
      return;
    }
    this.watchers.set(k, watcher);
  }

  private schedule(projectId: string, agentId: string, workbenchId: string): void {
    const k = key(projectId, agentId, workbenchId);
    if (this.removing.has(k)) return;
    const t = this.pending.get(k);
    if (t) clearTimeout(t);
    this.pending.set(
      k,
      setTimeout(() => {
        this.pending.delete(k);
        void this.reloadIfChanged(projectId, agentId, workbenchId).catch((err) => {
          if (err instanceof WorkbenchNotFound) {
            this.forget(projectId, agentId, workbenchId);
            return;
          }
          // Switched off between the check and the load: nothing to do.
          if (err instanceof WorkbenchDisabled) return;
          this.log.line(`[workbenches] ${k}: ${messageOf(err)}`);
        });
      }, WATCH_SETTLE_MS),
    );
  }
}

export class WorkbenchNotFound extends Error {}

/** A load's hints: the ones about what it serves, then the App Center declaration's. */
function hintsOf(l: Loaded): string[] {
  const hints = loadHints(l.folder.uiRev, l.tabs, l.error);
  return l.appCenter.hint === null ? hints : [...hints, l.appCenter.hint];
}

/** A workbench that exists but does not run: its own switch or the Agent's is off. */
export class WorkbenchDisabled extends HttpError {
  constructor(workbenchId: string) {
    super(
      409,
      "workbench_disabled",
      `The workbench ${workbenchId} is turned off; turn it on in the Agent's settings to use it.`,
    );
  }
}

/** Where a workbench's `ui/` is served from (./routes.ts). */
function uiBase(projectId: string, agentId: string, workbenchId: string): string {
  const [p, a, w] = [projectId, agentId, workbenchId].map(encodeURIComponent);
  return `/api/projects/${p}/agents/${a}/workbenches/${w}/${UI_DIR}`;
}

/**
 * The slots the host opens to a workbench tree, published under the platform module's own
 * name: the slot declarations come from the platform's table (so a workbench's contribution
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
  return { name: "WorkbenchWebSlots", methods: {}, slots };
}

/** The published `WorkbenchHost` declaration, straight from the platform's interface table. */
function hostDecl(): IfaceDecl {
  const decl = (table as unknown as { ifaces: Record<string, IfaceDecl> }).ifaces[HOST_IFACE];
  if (!decl) throw new Error(`${HOST_IFACE} is not in ifaces.json (regenerate it)`);
  return decl;
}
