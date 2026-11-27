/**
 * WorkflowLoaderService: one load of one workflow folder, whoever's workflow it is.
 *
 * A workflow is a plugin package: hand-written manifests in `package.json#penguin.modules`
 * and an `index.ts` whose default export pairs them with code, its root module named
 * `Workflow`. What it is written against and what its tree is given is the caller's to say
 * (WorkflowLoadRequest): an Agent's workflow is handed `WorkflowHost` and the Web slots
 * (./service.ts), an organization's company workflow what company-proposals publishes. The
 * rest is the same for every kind, and is here.
 *
 * Three checks run before any create(), and a failure of any fails the load with the problem
 * named — the caller keeps whatever was serving: the source is type-checked under `strict`
 * against the types the harness wrote into the folder when the workflow was new
 * (./harness-types.ts, ./compile.ts); those are compared with this platform's, both ways, by
 * the compiler (../plugin/iface-check.ts); and the tree is checked like any other — wiring,
 * slots, contribution shapes.
 *
 * Loading is by content: the folder's revision (store.ts) names the directory the source is
 * emitted into, so an edited workflow is a new import URL rather than a hit in the ESM cache,
 * and every successful load records the folder as a version that can be restored.
 *
 * A caller that needs the CODE a workflow contributes (a slot with a code half) names the slot
 * owner as a sink: it boots as a node of its own beside the root, under one root of the
 * loader's, and what it receives comes back with the tree. A published module gets no context,
 * so it could hold the data halves only.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bootModules, Component, parseManifest, Use } from "@prismshadow/penguin-core/kernel";
import type {
  ClassCtx,
  Contributed,
  IfaceTable,
  Manifest,
  ModuleDef,
} from "@prismshadow/penguin-core/kernel";
import table from "../ifaces.json" with { type: "json" };
import type { Clock, Hmr, Log } from "../hmr/capabilities.js";
import type {
  WorkflowFolderView,
  WorkflowLoader,
  WorkflowLoadOutcome,
  WorkflowLoadRequest,
  WorkflowVersion,
} from "../mechanisms/workflows.js";
import { compileWorkflow, pruneBuilds } from "./compile.js";
import { installHarnessTypes, readHarnessTable } from "./harness-types.js";
import { checkIfaces, ifaceQuestions } from "../plugin/iface-check.js";
import { loadTypeScript } from "../plugin/typescript.js";
import {
  isWorkflowId,
  listFolders,
  listVersions,
  readFolder,
  recordVersion,
  restoreVersion,
} from "./store.js";

export const ROOT_MODULE = "Workflow";
/** The loader's own root over a workflow and its sinks; never a name a workflow may use. */
const SINK_ROOT = "WorkflowSinks";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The platform's table with a plugin's under it: the platform's entries win a clash. */
function merged(extra: IfaceTable | undefined): IfaceTable {
  const platform = table as unknown as IfaceTable;
  if (extra === undefined) return platform;
  return {
    ifaces: { ...extra.ifaces, ...platform.ifaces },
    types: { ...extra.types, ...platform.types },
  };
}

/** Reads `package.json`: the manifests, and that the package is an ES module. */
export async function readManifests(dir: string): Promise<Manifest[]> {
  const raw = JSON.parse(await fs.promises.readFile(path.join(dir, "package.json"), "utf8")) as {
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

/** Pairs the manifests with the emitted default export, by name; answers the root. */
async function loadDefs(
  manifests: readonly Manifest[],
  entry: string,
  main: string | null,
): Promise<ModuleDef> {
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
  if (main !== null && !Object.values(root.manifest.provides).some((ref) => ref === main)) {
    throw new Error(`module '${ROOT_MODULE}' must provide "${main}"`);
  }
  return root;
}

/**
 * The root and the sinks under one root of the loader's. Each sink provides the interface that
 * declares its slots and keeps what it is handed; the edges the booter draws (a slot owner after
 * the modules that contribute code to it) make it come up after the workflow's modules.
 */
function withSinks(
  root: ModuleDef,
  sinks: Readonly<Record<string, string>>,
): { def: ModuleDef; collected: Record<string, Contributed[]> } {
  const names = Object.keys(sinks);
  const collected: Record<string, Contributed[]> = {};
  if (names.length === 0) return { def: root, collected };
  const children = names.map((name): ModuleDef => ({
    manifest: parseManifest({ name, provides: { slots: sinks[name]! } }),
    create: (ctx) => {
      for (const [slot, list] of Object.entries(ctx.contributions)) {
        collected[`${name}.${slot}`] = list;
      }
      return { api: { slots: {} } };
    },
  }));
  return {
    def: {
      manifest: parseManifest({ name: SINK_ROOT, children: [ROOT_MODULE, ...names] }),
      create: () => ({ api: {} }),
      children: [root, ...children],
    },
    collected,
  };
}

@Component()
export class WorkflowLoaderService implements WorkflowLoader {
  @Use() private readonly clock!: Clock;
  @Use() private readonly log!: Log;
  @Use() private readonly hmr!: Hmr;
  private resources: ClassCtx["resources"] | null = null;

  setup(ctx: ClassCtx) {
    this.resources = ctx.resources;
  }

  folder(dir: string, id: string): Promise<WorkflowFolderView | null> {
    if (!isWorkflowId(id)) return Promise.resolve(null);
    return readFolder(dir, id);
  }

  folders(base: string): Promise<WorkflowFolderView[]> {
    return listFolders(base);
  }

  history(historyDir: string, id: string): Promise<WorkflowVersion[]> {
    if (!isWorkflowId(id)) return Promise.resolve([]);
    return listVersions(historyDir, id);
  }

  async restore(historyDir: string, dir: string, id: string, revision: string): Promise<boolean> {
    if (!isWorkflowId(id) || !/^[0-9a-f]{12}$/.test(revision)) return false;
    const folder = await readFolder(dir, id);
    if (folder === null) return false;
    return restoreVersion(historyDir, folder, revision);
  }

  async load(request: WorkflowLoadRequest): Promise<WorkflowLoadOutcome> {
    const { folder } = request;
    const label = `[workflows] ${request.label ?? folder.dir}@${folder.revision}`;
    /** The tree this attempt booted, so a later throw can let it go instead of leaking it. */
    let booted: { dispose: () => void } | null = null;
    let outcome: Extract<WorkflowLoadOutcome, { ok: true }>;
    try {
      const manifests = await readManifests(folder.dir);
      request.inspect?.(manifests);
      const ifaces = merged(request.table);
      const ts = await loadTypeScript(this.hmr.assetsDir());
      // A new workflow takes its types from THIS harness; one that has them keeps them, and
      // they are its side of the comparison below.
      installHarnessTypes(folder.dir, ifaces, request.harness.keys, this.clock.now(), {
        packageTypes: request.harness.packageTypes,
        readme: request.harness.readme,
      });
      const entry = compileWorkflow(ts, folder.dir, folder.revision, request.typeModules);
      const written = readHarnessTable(folder.dir);
      if (typeof written === "string") throw new Error(written);
      const fit = checkIfaces(ts, ifaces, written, ifaceQuestions(manifests));
      // An interface the workflow names but holds no types for cannot be compared, and for a
      // workflow that is a problem, not a pass.
      const misfits = [
        ...fit.uncompared.map((q) => `${q}: not among the types this workflow was written against`),
        ...fit.problems,
      ];
      if (misfits.length > 0) throw new Error(misfits.join("\n"));
      const root = await loadDefs(manifests, entry, request.main);
      const { def, collected } = withSinks(root, request.sinks ?? {});
      const tree = await bootModules(def, {
        ifaces,
        resources: this.resources!,
        published: request.published(ifaces),
      });
      booted = tree;
      outcome = { ok: true, tree, manifests, contributions: collected };
    } catch (err) {
      const error = messageOf(err);
      this.log.line(`${label}: ${error}`);
      // A tree booted before the throw serves nobody: nothing holds it, so it is let go here.
      booted?.dispose();
      return { ok: false, error };
    }
    // Recording the version is bookkeeping around a load that has already succeeded, so it
    // cannot be inside the try that decides whether the load failed: a copy that ENOENTs on a
    // file rewritten since it was hashed must not turn a serving tree into a failure.
    pruneBuilds(folder.dir, folder.revision);
    try {
      await recordVersion(request.historyDir, folder, this.clock.now());
    } catch (err) {
      this.log.line(`${label}: version not recorded: ${messageOf(err)}`);
    }
    return outcome;
  }
}
