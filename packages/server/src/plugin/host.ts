/**
 * The plugin host: it owns activation, event delivery and disposal. Kept out of
 * ./index.ts so the published `@prismshadow/penguin-server/plugin` subpath stays types
 * only — a plugin package cannot take a runtime dependency on the harness even by
 * accident, which is what keeps it a self-contained library.
 */
import type { Resources } from "@prismshadow/penguin-core/kernel";
import type { Disposable, Plugin, PluginEvents } from "@prismshadow/penguin-core/plugin";

interface ActivatedPlugin {
  handlers: { [E in keyof PluginEvents]?: Array<(payload: PluginEvents[E]) => void> };
  disposables: Disposable[];
}

/** One host per server process; activation order is delivery order. */
export class PluginHost {
  private readonly plugins: ActivatedPlugin[] = [];

  /**
   * Runs `activate` (awaiting it when async), then seals its subscription window.
   *
   * TRANSACTIONAL: a plugin may have registered disposables before it threw, and the
   * caller is about to drop it — so those run here, before the failure is reported.
   * Without this the entry is never published and `dispose()` could never reach them.
   */
  async use(plugin: Plugin): Promise<void> {
    const entry: ActivatedPlugin = { handlers: {}, disposables: [] };
    let sealed = false;
    try {
      await plugin.activate({
        on<E extends keyof PluginEvents>(event: E, handler: (payload: PluginEvents[E]) => void) {
          if (sealed) {
            throw new Error(
              `plugin subscribed to '${event}' after activate settled — a handler-time ` +
                `subscription would accumulate one copy per hot swap`,
            );
          }
          // Sound, but under a generic key TS folds the mapped type to a union.
          const list = (entry.handlers[event] ??= []) as Array<(payload: PluginEvents[E]) => void>;
          list.push(handler);
        },
        disposables: entry.disposables,
      });
    } catch (err) {
      sealed = true;
      await runDisposables(entry.disposables);
      throw err;
    }
    sealed = true;
    Object.freeze(entry.disposables);
    this.plugins.push(entry);
  }

  emit<E extends keyof PluginEvents>(event: E, payload: PluginEvents[E]): void {
    for (const plugin of this.plugins) {
      for (const handler of plugin.handlers[event] ?? []) {
        // An App is assembled synchronously around this call, so a returned promise
        // could not be awaited and its rejection would escape unhandled — possibly
        // killing the process, since boot runs before the process handlers are on.
        // Refusing it fails the boot loudly instead, which is what a throwing handler
        // already does.
        const returned = handler(payload) as { then?: unknown; catch?: unknown } | undefined;
        if (typeof returned?.then === "function") {
          // Neutralize it first: the promise is already running, and throwing below
          // without claiming it would leave its rejection unhandled — exactly the escape
          // this refusal exists to close.
          if (typeof returned.catch === "function") {
            (returned as Promise<unknown>).catch(() => {});
          }
          throw new Error(
            `plugin handler for '${event}' returned a promise — event handlers must be ` +
              `synchronous (do async work in activate, or start it without awaiting)`,
          );
        }
      }
    }
  }

  /**
   * Runs every disposable concurrently, settling once all have: a failing one is logged
   * without stranding the rest, and there is deliberately no teardown order. Idempotent
   * — the graceful shutdown awaits it (bounded), the registry sweep only starts it.
   */
  async dispose(): Promise<void> {
    const plugins = this.plugins.splice(0);
    await runDisposables(plugins.flatMap((plugin) => [...plugin.disposables]));
  }
}

/** Concurrent, failure-isolated teardown — see {@link PluginHost.dispose}. */
async function runDisposables(disposables: readonly Disposable[]): Promise<void> {
  await Promise.all(
    disposables.map(async (disposable) => {
      try {
        await disposable.dispose();
      } catch (err) {
        console.warn(
          `[plugins] disposer failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );
}

/** Registry key the runtime publishes its loaded host under. */
export const PLUGINS_RESOURCE_ID = "runtime:plugins";

/**
 * The host the runtime loaded (see ./loader.ts), or an empty one — the honest reading
 * of "this runtime knows nothing about plugins".
 *
 * CLAIMED, not imported: a pushed bundle is compiled standalone, so a module-level host
 * inside it would be a second, empty one and every configured plugin would go missing
 * on the first hot push.
 */
export function pluginHostFrom(resources: Resources): PluginHost {
  return resources.claim<PluginHost>(PLUGINS_RESOURCE_ID) ?? new PluginHost();
}
