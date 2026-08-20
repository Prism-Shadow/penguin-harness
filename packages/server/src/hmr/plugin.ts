/**
 * The harness plugin seam.
 *
 * Vocabulary:
 *   harness  = Platform (backend) + App (frontend)
 *   workflow = Workflow — a named unit a plugin registers and anyone can call
 *
 * Two views of the harness:
 *
 *   - {@link PenguinContext} — an INSTANCE of the harness. Platform members flatten
 *     directly onto it (`context.terminals`, not `context.platform.terminals`);
 *     workflow instances live at `context.workflows`.
 *   - {@link PenguinInterface} — the harness's DEFINITION view. Workflow FACTORIES
 *     live at `iface.workflow` (a Map), tool factories at `iface.tool`.
 *
 * A plugin is two hooks:
 *   - `onCreateApp(iface)` — definition time, once per App creation (a hot swap creates
 *     a new App, so it fires again). This is where factories are registered.
 *   - `subscribe(eventName, ctx)` — instance time: the host delivers each event with the
 *     live context. Event names are an open set; `"create"`, fired once the instance
 *     context is assembled, is the only one the platform emits yet.
 *
 * Both views stay minimal on purpose: members land when a concrete need names them, so
 * what is here is what something actually uses.
 */
import type { Resources } from "@prismshadow/penguin-core/kernel";
import type { TerminalManager } from "../terminal/manager.js";
import type { SandboxProviderSource, SandboxSettings } from "../sandbox/index.js";

/** What a registered workflow does when called. Plain JS in, plain JS out. */
export interface WorkflowInstance {
  run(input: unknown): unknown;
}

/**
 * Builds a workflow instance. Called once per App creation, so a factory that keeps
 * state gets a fresh instance per boot — and a hot swap therefore never carries a
 * half-built one across.
 */
export type WorkflowFactory = () => WorkflowInstance;

/** A tool factory — RESERVED. The shape lands with the first plugin-provided tool. */
export type ToolFactory = unknown;

/**
 * Sandbox backend registration — the floor where plugins are PROVIDERS. Backends
 * register against the harness's own sandbox interface (../sandbox/). None of them is
 * built in: every backend, including the ones this repo ships, is a package a
 * deployment installs and names in plugins.json, so a third-party one enters by exactly
 * the same door. A backend declares which dimensions it implements (`network` and
 * `mask-paths` are optional implementations; declaring nothing means filesystem only),
 * and the service ROUTES each policy to a backend implementing what it requires — so an
 * unimplemented dimension can never be silently ignored. A backend may be handed in as
 * a promise: loading is asynchronous (dynamic imports, probes), and the service fails
 * closed while a load is pending or failed.
 */
export interface SandboxProviderRegistry {
  registerProvider(name: string, provider: SandboxProviderSource): void;
}

/**
 * The sandbox config surface on the instance view: what a deployment (or a plugin
 * reacting to an event) uses to flip confinement. Settings park with the platform
 * context, so they survive hot swaps.
 */
export interface SandboxControl {
  configure(settings: SandboxSettings): void;
  settings(): SandboxSettings;
}

/**
 * The workflow instances this App built from the registered factories: a plain
 * call-by-name surface, deliberately not an agent one. Invoking a workflow is a
 * function call; anything that needs a Session, approval or streaming is a different
 * capability and does not belong on this floor.
 */
export interface WorkflowInstances {
  /** The registered names, in registration order. */
  names(): string[];
  get(name: string): WorkflowInstance | undefined;
  /** Calls a workflow by name; throws when no such workflow is registered. */
  run(name: string, input: unknown): unknown;
}

/** An INSTANCE of the harness: platform members flattened, workflow instances at `workflows`. */
export interface PenguinContext {
  /** Workflow instances built from `iface.workflow` (see {@link WorkflowInstances}). */
  workflows: WorkflowInstances;
  /** Terminals — a platform member, flattened onto the context per the vocabulary. */
  terminals: TerminalManager;
  /** The sandbox config surface (see {@link SandboxControl}). */
  sandbox: SandboxControl;
  // context.* — further platform members flatten here as concrete needs land.
}

/** The INTERFACE (definition view) of the harness. */
export interface PenguinInterface {
  /** Workflow factories, keyed by name. Registering a duplicate name is an error. */
  workflow: Map<string, WorkflowFactory>;
  /** Tool factories, keyed by name — RESERVED (see {@link ToolFactory}). */
  tool: Map<string, ToolFactory>;
  /** Sandbox backend registration (see {@link SandboxProviderRegistry}). */
  sandbox: SandboxProviderRegistry;
}

/** A raw plugin: both hooks optional — a plugin may care about only one side. */
export interface RawPlugin {
  onCreateApp?(iface: PenguinInterface): void;
  subscribe?(eventName: string, ctx: PenguinContext): void;
}

/**
 * The minimal plugin host: registration order is delivery order, and hooks are delivered
 * synchronously. One host per server process; the platform drives it at every App
 * creation, so a plugin registered before boot sees every instance — including the ones
 * a hot swap creates.
 */
export class PluginHost {
  private readonly plugins: RawPlugin[] = [];

  use(plugin: RawPlugin): void {
    this.plugins.push(plugin);
  }

  /** Definition-time dispatch: every plugin's onCreateApp, in registration order. */
  createApp(iface: PenguinInterface): void {
    for (const plugin of this.plugins) plugin.onCreateApp?.(iface);
  }

  /** Instance-time dispatch: deliver one event to every plugin, in registration order. */
  emit(eventName: string, ctx: PenguinContext): void {
    for (const plugin of this.plugins) plugin.subscribe?.(eventName, ctx);
  }
}

/**
 * Builds the instance view of the registered factories. Kept beside the host rather than
 * in platform.ts because it is plugin-layer behavior, not platform business: the
 * platform only decides when to build it and what else rides on the context.
 */
export function instantiateWorkflows(factories: Map<string, WorkflowFactory>): WorkflowInstances {
  const instances = new Map<string, WorkflowInstance>();
  for (const [name, factory] of factories) instances.set(name, factory());
  return {
    names: () => [...instances.keys()],
    get: (name) => instances.get(name),
    run(name, input) {
      const instance = instances.get(name);
      if (instance === undefined) throw new Error(`no workflow named '${name}'`);
      return instance.run(input);
    },
  };
}

/** Registry key the runtime publishes its loaded host under. */
export const PLUGINS_RESOURCE_ID = "runtime:plugins";

/**
 * The host the runtime published, or one with no plugins in it.
 *
 * Loading is the runtime's job: it owns plugins.json and the module imports (see
 * ../plugins/loader.ts) and does that once per process, before any App exists. The
 * platform claims the result here rather than holding a host of its own, for the same
 * reason it claims identity (see ./terminal/identity.ts): a pushed bundle is compiled
 * standalone, so a module-level singleton inside it would be a second, empty host and
 * every configured plugin would go missing on the first hot push. Claiming instead means
 * both Apps — packaged and pushed — drive the one host that actually has the plugins.
 *
 * A runtime too old to publish one runs no plugins, which is the honest reading of "this
 * runtime knows nothing about plugins".
 */
export function pluginHostFrom(resources: Resources): PluginHost {
  return resources.claim<PluginHost>(PLUGINS_RESOURCE_ID) ?? new PluginHost();
}
