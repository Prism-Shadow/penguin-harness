/**
 * The harness plugin seam.
 *
 * Deliberately NOT under hmr/: a plugin has nothing to do with hot updates. It is
 * installed configuration (see ./loader.ts), never part of a platform bundle, and the
 * platform merely drives this host at every App creation.
 *
 * This file IS the plugin domain's entry point (./loader.ts resolves what a deployment
 * configured, ./workflow.ts carries the workflow surface).
 *
 * Vocabulary:
 *   harness  = Platform (backend) + App (frontend)
 *   workflow = Workflow — a named unit a plugin registers and anyone can call
 *              (its type surface and instantiation live in ./workflow.ts)
 *
 * A plugin is a module exporting ONE function:
 *
 *   export function activate(ctx: PluginContext): void
 *
 * `activate` runs once per process, at load time (startup step ④ — before any App
 * exists). Everything after that is events, subscribed through `ctx.on(...)` and typed
 * by {@link PluginEvents}. The two views of the harness arrive as the two events fired
 * at EVERY App creation — the packaged boot and each hot-swap boot alike:
 *
 *   - `"initialize"` — {@link PenguinInterface}, the DEFINITION view. Workflow FACTORIES
 *     live at `iface.workflow` (a Map), tool factories at `iface.tool`. This is where
 *     registration happens.
 *   - `"create"` — {@link PenguinContext}, an INSTANCE of the harness, assembled after
 *     registration closes. Platform members flatten directly onto it
 *     (`context.terminals`, not `context.platform.terminals`); workflow instances live
 *     at `context.workflows`.
 *
 * The subscription window is `activate` itself: `on(...)` after it returns throws.
 * Handlers run per App, so a subscription made inside one would accumulate one copy per
 * hot swap — sealing turns that slow leak into a loud error at the packaged boot.
 * Long-lived things a plugin allocates go into `ctx.disposables` (also sealed with the
 * window, for the same accumulation reason) and are disposed at process exit.
 *
 * Everything here stays minimal on purpose: members land when a concrete need names
 * them, so what is here is what something actually uses.
 */
import type { Resources } from "@prismshadow/penguin-core/kernel";
import type { TerminalManager } from "../terminal/manager.js";
import type { WorkflowFactory, WorkflowInstances } from "./workflow.js";

/** A tool factory — RESERVED. The shape lands with the first plugin-provided tool. */
export type ToolFactory = unknown;

/** An INSTANCE of the harness: platform members flattened, workflow instances at `workflows`. */
export interface PenguinContext {
  /** Workflow instances built from `iface.workflow` (see {@link WorkflowInstances}). */
  workflows: WorkflowInstances;
  /** Terminals — a platform member, flattened onto the context per the vocabulary. */
  terminals: TerminalManager;
  // context.* — further platform members flatten here as concrete needs land.
}

/** The INTERFACE (definition view) of the harness. */
export interface PenguinInterface {
  /** Workflow factories, keyed by name. Registering a duplicate name is an error. */
  workflow: Map<string, WorkflowFactory>;
  /** Tool factories, keyed by name — RESERVED (see {@link ToolFactory}). */
  tool: Map<string, ToolFactory>;
}

/**
 * Typed event registry: event name → payload. This is the ONE place the event
 * vocabulary lives — adding an event here types the platform's emit and every plugin's
 * handler at once. Both current events fire once per App creation.
 */
export interface PluginEvents {
  /** The definition view (see the module doc). Register factories here. */
  initialize: PenguinInterface;
  /** The instance view, assembled after registration closes. */
  create: PenguinContext;
}

export interface Disposable {
  dispose(): void;
}

/**
 * What `activate` receives: the subscription surface and the plugin's cleanup list.
 * Process-level — this is NOT the harness instance (that is {@link PenguinContext},
 * delivered by the `"create"` event).
 */
export interface PluginContext {
  /**
   * Subscribes a handler. Callable only while `activate` runs; the window seals when it
   * returns (see the module doc for why). Handlers are delivered synchronously and
   * unwrapped — a throwing handler fails that App's boot.
   */
  on<E extends keyof PluginEvents>(event: E, handler: (payload: PluginEvents[E]) => void): void;
  /**
   * Cleanup for anything long-lived the plugin allocates during `activate`; disposed at
   * process exit (newest first), through the registry sweep that owns the host.
   */
  disposables: Disposable[];
}

/** A plugin module's contract: the one exported function. */
export interface Plugin {
  activate(ctx: PluginContext): void;
}

/** One activated plugin: its handlers by event, and what it asked to clean up. */
interface ActivatedPlugin {
  handlers: { [E in keyof PluginEvents]?: Array<(payload: PluginEvents[E]) => void> };
  disposables: Disposable[];
}

/**
 * The minimal plugin host: activation order is delivery order, and handlers are
 * delivered synchronously. One host per server process; the platform drives it at every
 * App creation, so a plugin activated before boot sees every instance — including the
 * ones a hot swap creates.
 */
export class PluginHost {
  private readonly plugins: ActivatedPlugin[] = [];

  /** Activates one plugin: builds its context, runs `activate`, seals the window. */
  use(plugin: Plugin): void {
    const entry: ActivatedPlugin = { handlers: {}, disposables: [] };
    let sealed = false;
    plugin.activate({
      on<E extends keyof PluginEvents>(event: E, handler: (payload: PluginEvents[E]) => void) {
        if (sealed) {
          throw new Error(
            `plugin subscribed to '${event}' after activate returned — a handler-time ` +
              `subscription would accumulate one copy per hot swap`,
          );
        }
        // The cast is sound — `handlers[E]` holds exactly `(p: PluginEvents[E]) => void`
        // entries — but under a generic key TS folds the mapped type to a union and
        // rejects the push.
        const list = (entry.handlers[event] ??= []) as Array<(payload: PluginEvents[E]) => void>;
        list.push(handler);
      },
      disposables: entry.disposables,
    });
    sealed = true;
    // Same accumulation argument as on(): a per-App push would pile up until exit.
    Object.freeze(entry.disposables);
    this.plugins.push(entry);
  }

  /** Delivers one event: plugin activation order, then each plugin's own on() order. */
  emit<E extends keyof PluginEvents>(event: E, payload: PluginEvents[E]): void {
    for (const plugin of this.plugins) {
      for (const handler of plugin.handlers[event] ?? []) handler(payload);
    }
  }

  /** Runs every disposable, newest first. Best-effort: the process is going away. */
  dispose(): void {
    for (const plugin of [...this.plugins].reverse()) {
      for (const disposable of [...plugin.disposables].reverse()) {
        try {
          disposable.dispose();
        } catch {
          // A throwing disposer must not strand the rest.
        }
      }
    }
    this.plugins.length = 0;
  }
}

/** Registry key the runtime publishes its loaded host under. */
export const PLUGINS_RESOURCE_ID = "runtime:plugins";

/**
 * The host the runtime published, or one with no plugins in it.
 *
 * Loading is the runtime's job: it owns plugins.json and the module imports (see
 * ./loader.ts) and does that once per process, before any App exists. The
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
