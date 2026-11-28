/**
 * Runtime loader and kernel booter for active external plugins' JIT-compiled `./web` modules.
 *
 * Unlike any hand-rolled reflection or `globalThis` shim:
 * - Static `/plugins/manifest.json` lists compiled external plugins and their single `ifaces.json`.
 * - Dynamic `import(entry)` resolves bare host specifiers (`react`, `@prismshadow/penguin-ui`,
 *   `@prismshadow/penguin-core/kernel`, `@prismshadow/penguin-web-plugin`) natively via the
 *   document's `<script type="importmap">`.
 * - Loaded plugin `{ modules }` are booted through the REAL `@prismshadow/penguin-core/kernel`
 *   (`defineModule`, `moduleDefOf`, `bootModules`, `tree.dispose()`) against a host
 *   `WebAppModule` bridge carrying the exact host `WebAppSlots` contract from `src/ifaces.json`.
 * - Any plugin whose manifest, `@Use`, or slot contribution fails kernel validation is cleanly
 *   rejected and reported in `unsatisfied` without taking down valid plugins or the host SPA.
 */
import { createContext, useContext, useEffect, useState, type ComponentType } from "react";
import {
  bootModules,
  defineModule,
  ModuleBootError,
  moduleDefOf,
  moduleMetaOf,
  type Contributed,
  type IfaceTable,
  type ManifestTable,
  type ModuleClass,
  type ModuleDef,
  type ModuleTree,
  type Resources,
} from "@prismshadow/penguin-core/kernel";
import hostTable from "../ifaces.json";
import { setRuntimeServerModuleGates } from "../lib/module-gate";
import type { WebAppLayer } from "./deps";
import { gatedPagesOf, gatesOf, layersOf, pageRenderersOf } from "./gated-slots";
import { pageTableOf, type WebAppPage } from "./page-table";

export interface RuntimePluginIfaces {
  readonly ifaces: IfaceTable["ifaces"];
  readonly types: IfaceTable["types"];
  readonly modules: ManifestTable;
}

export interface RuntimePluginManifestEntry {
  readonly specifier: string;
  readonly hash: string;
  readonly entry: string;
  readonly ifacesUrl: string;
  readonly browser?: {
    readonly entry: string;
    readonly modules: readonly string[];
    readonly replaces: readonly string[];
  };
}

export interface RuntimePluginWebManifest {
  readonly imports?: Readonly<Record<string, string>>;
  readonly modules: readonly RuntimePluginManifestEntry[];
  readonly unsatisfied: ReadonlyArray<{ readonly specifier: string; readonly error: string }>;
}

export interface LoadedRuntimePlugin {
  readonly specifier: string;
  readonly browser?: RuntimePluginManifestEntry["browser"];
  readonly ifaces: RuntimePluginIfaces;
  readonly namespace: unknown;
}

export interface RuntimeWebPluginsState {
  readonly layers: readonly WebAppLayer[];
  readonly pages: readonly WebAppPage[];
  readonly pageRenderers: ReadonlyMap<string, ComponentType>;
  readonly gates: ReadonlyMap<string, readonly string[]>;
  readonly unsatisfied: ReadonlyArray<{ readonly specifier: string; readonly error: string }>;
}

export interface BootedRuntimeWebPlugins extends RuntimeWebPluginsState {
  dispose(): void;
}

const EMPTY_STATE: RuntimeWebPluginsState = {
  layers: [],
  pages: [],
  pageRenderers: new Map(),
  gates: new Map(),
  unsatisfied: [],
};

const NO_RESOURCES: Resources = {
  register: () => () => {},
  claim: () => undefined,
};

export const RuntimeLayersContext = createContext<readonly WebAppLayer[]>([]);

export function useRuntimeWebAppLayers(): readonly WebAppLayer[] {
  return useContext(RuntimeLayersContext);
}

/** Reads the document's W3C `<script type="importmap">` imports map, or null if absent. */
function readDocumentImportMap(): Record<string, string> | null {
  if (typeof document === "undefined") return null;
  const raw = document.querySelector('script[type="importmap"]')?.textContent;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { imports?: Record<string, string> };
    return parsed.imports && typeof parsed.imports === "object" ? parsed.imports : null;
  } catch {
    return null;
  }
}

/**
 * Compares the document's W3C importmap against the server's `/assets/modules.json` `imports`.
 * Prevents an older browser tab from loading modules compiled against a hot-pushed newer runtime
 * (e.g. upgraded `react-dom` or `@prismshadow/penguin-ui`). Dev-server virtual URLs pass through.
 */
export function isImportMapCompatible(
  pageImports: Readonly<Record<string, string>> | null,
  manifestImports: Readonly<Record<string, string>> | undefined,
): boolean {
  if (!pageImports || !manifestImports) return true;
  const pageEntries = Object.entries(pageImports);
  if (pageEntries.some(([, v]) => v.startsWith("/@penguin-shared/"))) return true;
  const manifestEntries = Object.entries(manifestImports);
  if (manifestEntries.length === 0) return true;
  if (pageEntries.length !== manifestEntries.length) return false;
  return manifestEntries.every(([k, v]) => pageImports[k] === v);
}

/** Extracts the explicitly registered `@Module`/`@Component` classes from a `./web` entry's default export. */
function extractDeclaredModules(specifier: string, ns: unknown): ModuleClass[] {
  if (!ns || typeof ns !== "object") {
    throw new ModuleBootError(`${specifier}: ./web entry exported no module namespace`);
  }
  const def = (ns as { default?: unknown }).default;
  if (!def || typeof def !== "object" || !Array.isArray((def as { modules?: unknown }).modules)) {
    throw new ModuleBootError(
      `${specifier}: ./web default export must be { modules: [<@Module class>, ...] }`,
    );
  }
  const classes: ModuleClass[] = [];
  for (const item of (def as { modules: unknown[] }).modules) {
    if (typeof item !== "function") {
      throw new ModuleBootError(
        `${specifier}: ./web default export's modules contains a non-class entry`,
      );
    }
    moduleMetaOf(item as ModuleClass);
    classes.push(item as ModuleClass);
  }
  return classes;
}

function mergeIfaceTables(plugins: readonly LoadedRuntimePlugin[]): {
  ifaces: IfaceTable;
  manifests: ManifestTable;
} {
  const host = hostTable as unknown as IfaceTable & { modules: ManifestTable };
  const ifaces: IfaceTable["ifaces"] = { ...host.ifaces };
  const types: IfaceTable["types"] = { ...host.types };
  const manifests: Record<string, ManifestTable[string]> = {};
  for (const plugin of plugins) {
    for (const [k, v] of Object.entries(plugin.ifaces.ifaces)) ifaces[k] ??= v;
    for (const [k, v] of Object.entries(plugin.ifaces.types)) types[k] ??= v;
    for (const [k, v] of Object.entries(plugin.ifaces.modules)) manifests[k] ??= v;
  }
  return { ifaces: { ifaces, types }, manifests };
}

interface BridgeResult {
  Root: ComponentType;
  layers: readonly WebAppLayer[];
  pages: readonly WebAppPage[];
  pageRenderers: ReadonlyMap<string, ComponentType>;
  gates: ReadonlyMap<string, readonly string[]>;
}

function NoopBridgeRoot() {
  return null;
}

const WEB_APP_IFACE_KEY = "@prismshadow/penguin-web#WebApp";

function buildExternalWebRoot(
  plugins: readonly LoadedRuntimePlugin[],
  manifests: ManifestTable,
): { root: ModuleDef; moduleToSpecifier: Map<string, string> } {
  const extra: ModuleDef[] = [];
  const moduleToSpecifier = new Map<string, string>();
  for (const plugin of plugins) {
    const classes = extractDeclaredModules(plugin.specifier, plugin.namespace);
    const expectedNames = plugin.browser?.modules;
    if (expectedNames !== undefined && expectedNames.length > 0) {
      const actualNames = classes.map((c) => moduleMetaOf(c).name);
      if (actualNames.join(",") !== expectedNames.join(",")) {
        throw new ModuleBootError(
          `${plugin.specifier}: browser entry exports [${actualNames.join(", ")}], but ifaces.json browser.modules lists [${expectedNames.join(", ")}] — run gen:ifaces`,
        );
      }
    }
    for (const cls of classes) {
      const def = moduleDefOf(cls, { manifests });
      moduleToSpecifier.set(def.manifest.name, plugin.specifier);
      extra.push(def);
    }
  }

  const webAppBridge = defineModule(
    {
      name: "WebAppModule",
      kind: "module",
      requires: {},
      provides: { webApp: WEB_APP_IFACE_KEY },
      contributes: {},
      children: [],
    },
    {
      create({ contributions }) {
        const gates = gatesOf(contributions.serverModules ?? []);
        const pages = gatedPagesOf(
          pageTableOf(contributions.pages ?? []),
          contributions.pages ?? [],
          gates,
        );
        const rawLayers = [...(contributions.layers ?? [])]
          .filter((c): c is Contributed => typeof c.code === "function")
          .map((c) => ({
            id: c.id,
            from: c.from,
            Component: c.code as ComponentType,
            order:
              typeof (c.data as { order?: unknown }).order === "number"
                ? (c.data as { order: number }).order
                : 0,
            area: ((c.data as { area?: unknown }).area === "page"
              ? "page"
              : "shell") as WebAppLayer["area"],
          }))
          .sort((a, b) => a.order - b.order);
        const layers = layersOf(rawLayers, gates);
        const pageRenderers = pageRenderersOf(contributions.pageRenderers ?? [], gates);
        const result: BridgeResult = { Root: NoopBridgeRoot, layers, pages, pageRenderers, gates };
        return { api: { webApp: result } };
      },
    },
  );

  const root = defineModule(
    {
      name: "ExternalWebRoot",
      kind: "module",
      requires: {},
      provides: {},
      contributes: {},
      children: ["WebAppModule", "*"],
    },
    {
      create() {
        return { api: {} };
      },
      children: [webAppBridge, ...extra],
    },
  );

  return { root, moduleToSpecifier };
}

/**
 * Boots external web plugins through the real `@prismshadow/penguin-core/kernel` (`bootModules`),
 * validating manifests, `@Use`/`@Provide` wiring, and slot contributions. Any plugin that fails
 * kernel validation is excluded cleanly into `unsatisfied` without breaking remaining valid plugins.
 */
export async function bootRuntimeWebPlugins(
  plugins: readonly LoadedRuntimePlugin[],
): Promise<BootedRuntimeWebPlugins> {
  const unsatisfied: Array<{ specifier: string; error: string }> = [];
  let candidates = [...plugins];

  while (candidates.length > 0) {
    const { ifaces, manifests } = mergeIfaceTables(candidates);
    let built: { root: ModuleDef; moduleToSpecifier: Map<string, string> };
    try {
      built = buildExternalWebRoot(candidates, manifests);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const guilty = candidates.find(
        (p) =>
          msg.includes(p.specifier) ||
          Object.keys(p.ifaces.modules).some((m) => msg.startsWith(`${m}:`)),
      );
      if (guilty) {
        unsatisfied.push({ specifier: guilty.specifier, error: msg });
        candidates = candidates.filter((p) => p !== guilty);
        continue;
      }
      for (const p of candidates) unsatisfied.push({ specifier: p.specifier, error: msg });
      candidates = [];
      break;
    }

    let tree: ModuleTree;
    try {
      tree = await bootModules(built.root, { ifaces, resources: NO_RESOURCES });
    } catch (err) {
      if (err instanceof ModuleBootError && err.problems.length > 0) {
        const guiltySpecs = new Set<string>();
        for (const problem of err.problems) {
          for (const seg of problem.path.split("/")) {
            const spec = built.moduleToSpecifier.get(seg);
            if (spec) guiltySpecs.add(spec);
          }
        }
        if (guiltySpecs.size > 0) {
          for (const spec of guiltySpecs) {
            unsatisfied.push({ specifier: spec, error: err.message });
          }
          candidates = candidates.filter((p) => !guiltySpecs.has(p.specifier));
          continue;
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      for (const p of candidates) unsatisfied.push({ specifier: p.specifier, error: msg });
      candidates = [];
      break;
    }

    const result = tree.api<BridgeResult>("WebAppModule", "webApp");
    return {
      ...result,
      unsatisfied,
      dispose: () => tree.dispose(),
    };
  }

  return {
    ...EMPTY_STATE,
    unsatisfied,
    dispose: () => {},
  };
}

export function useRuntimeWebPlugins(
  enabled: boolean,
  refreshKey: string,
): RuntimeWebPluginsState & { loading: boolean } {
  const [loaded, setLoaded] = useState<{ key: string; state: RuntimeWebPluginsState }>({
    key: "",
    state: EMPTY_STATE,
  });
  const effectiveKey = enabled ? `on:${refreshKey}` : "";

  useEffect(() => {
    if (!enabled) {
      setRuntimeServerModuleGates(new Map());
      setLoaded({ key: "", state: EMPTY_STATE });
      return;
    }

    let cancelled = false;
    let booted: BootedRuntimeWebPlugins | null = null;

    void (async () => {
      let manifest: RuntimePluginWebManifest;
      try {
        const res = await fetch("/assets/modules.json", { cache: "no-cache" });
        if (!res.ok) {
          if (!cancelled) {
            setRuntimeServerModuleGates(new Map());
            setLoaded({ key: effectiveKey, state: EMPTY_STATE });
          }
          return;
        }
        manifest = (await res.json()) as RuntimePluginWebManifest;
      } catch {
        if (!cancelled) {
          setRuntimeServerModuleGates(new Map());
          setLoaded({ key: effectiveKey, state: EMPTY_STATE });
        }
        return;
      }

      if (cancelled) return;
      const pageImports = readDocumentImportMap();
      if (!isImportMapCompatible(pageImports, manifest.imports)) {
        console.warn(
          "Web host importmap updated on server; skipping cross-generation module load until page reload.",
        );
        setLoaded((prev) => ({ key: effectiveKey, state: prev.state }));
        return;
      }
      for (const bad of manifest.unsatisfied ?? []) {
        console.error(
          `External web plugin "${bad.specifier}" failed server compile:\n${bad.error}`,
        );
      }

      if (!manifest.modules || manifest.modules.length === 0) {
        setRuntimeServerModuleGates(new Map());
        setLoaded({
          key: effectiveKey,
          state: { ...EMPTY_STATE, unsatisfied: manifest.unsatisfied ?? [] },
        });
        return;
      }

      const settled = await Promise.allSettled(
        manifest.modules.map(async (entry) => {
          const [namespace, ifacesRes] = await Promise.all([
            import(/* @vite-ignore */ entry.entry),
            fetch(entry.ifacesUrl, { cache: "force-cache" }),
          ]);
          if (!ifacesRes.ok) {
            throw new Error(`HTTP ${ifacesRes.status} loading ${entry.ifacesUrl}`);
          }
          const ifaces = (await ifacesRes.json()) as RuntimePluginIfaces;
          return { namespace, ifaces };
        }),
      );
      if (cancelled) return;

      const loadedPlugins: LoadedRuntimePlugin[] = [];
      const loadFailures: Array<{ specifier: string; error: string }> = [
        ...(manifest.unsatisfied ?? []),
      ];
      for (let i = 0; i < settled.length; i++) {
        const res = settled[i]!;
        const entry = manifest.modules[i]!;
        if (res.status === "fulfilled") {
          loadedPlugins.push({
            specifier: entry.specifier,
            ...(entry.browser !== undefined ? { browser: entry.browser } : {}),
            ifaces: res.value.ifaces,
            namespace: res.value.namespace,
          });
        } else {
          const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
          console.error(
            `Failed to import runtime browser module "${entry.specifier}":`,
            res.reason,
          );
          loadFailures.push({ specifier: entry.specifier, error: msg });
        }
      }

      const nextBooted = await bootRuntimeWebPlugins(loadedPlugins);
      if (cancelled) {
        nextBooted.dispose();
        return;
      }
      booted = nextBooted;
      for (const bad of nextBooted.unsatisfied) {
        console.error(
          `External web plugin "${bad.specifier}" rejected by kernel boot:\n${bad.error}`,
        );
      }
      setRuntimeServerModuleGates(nextBooted.gates);
      setLoaded({
        key: effectiveKey,
        state: {
          layers: nextBooted.layers,
          pages: nextBooted.pages,
          pageRenderers: nextBooted.pageRenderers,
          gates: nextBooted.gates,
          unsatisfied: [...loadFailures, ...nextBooted.unsatisfied],
        },
      });
    })();

    return () => {
      cancelled = true;
      booted?.dispose();
    };
  }, [enabled, effectiveKey]);

  const loading = effectiveKey !== "" && loaded.key !== effectiveKey;
  return { ...loaded.state, loading };
}
