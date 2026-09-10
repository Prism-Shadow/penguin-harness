/**
 * The HMR layer's entry: the operations that are FROZEN.
 *
 * Everything that decides how a generation becomes current lives here and in host.ts —
 * how the first one boots, how a push is applied and what happens when its boot fails, when
 * a request may be handed to a generation, and what the layer must refresh once a new one
 * is current. The product hands in three things and drives nothing itself:
 *
 * - `host`: the store and the swap (HmrHost), built over the product's packaged bundle;
 * - `replace`: what the product does with a generation once it is current — point its
 *   handles at it, refresh what it derives from a version. Called for the first boot and
 *   after every push: the pushed generation when it lands, the previous one re-booted
 *   when it does not;
 * - `start`: the product's boot — publish what a generation claims, then the first `ensure`.
 *
 * `start` receives the control object before it runs, so the product's routes and seam can
 * be built over it while the first generation is still coming up.
 */
import type { Instance, Park } from "@prismshadow/penguin-core/kernel";
import type { HmrHost, UpgradeAllTarget, UpgradeOutcome } from "./host.js";

/** What the product does with a generation once it is current. */
export type Replace<Api extends Park> = (instance: Instance<Api>) => void;

/** The frozen operations, as the product sees them. */
export interface Hmr<Api extends Park> {
  /**
   * The generation requests go to. Waits out an in-flight swap FIRST: the kernel disposes the
   * old tree before the new one has booted, and for that window the host still answers with
   * the old instance — a caller that did not wait would be handed a disposed tree. Throws
   * when no generation can boot at all; the product's own routes are the fallback then, and
   * the upgrade channel stays reachable to push a working one.
   */
  current(): Promise<Instance<Api>>;
  /**
   * THE upgrade, serialized: store the bundles, boot the new generation, swap, commit the
   * version — or put the previous generation back and report why. `replace` runs once the
   * new one is current.
   */
  upgrade(target: UpgradeAllTarget): Promise<UpgradeOutcome>;
}

/** The control object alone, for a product that boots its first generation some other way (tests). */
export function hmrControl<Api extends Park>(host: HmrHost<Api>, replace: Replace<Api>): Hmr<Api> {
  return {
    current: async () => {
      await host.waitIdle();
      return host.ensure();
    },
    upgrade: async (target) => {
      const outcome = await host.upgradeAll(target);
      // Whatever is current now is a NEW instance — the pushed generation, or the previous
      // one re-booted after the pushed one failed — and the product is told either way. A
      // double fault leaves nothing current: ensure() throws, and the product keeps its last.
      try {
        replace(await host.ensure());
      } catch {
        // No generation is current; the upgrade channel stays reachable to push a good one.
      }
      return outcome;
    },
  };
}

export async function hmrMain<Api extends Park>(
  host: HmrHost<Api>,
  replace: Replace<Api>,
  start: (hmr: Hmr<Api>) => Promise<void>,
): Promise<Hmr<Api>> {
  const hmr = hmrControl(host, replace);
  await start(hmr);
  replace(await host.ensure());
  return hmr;
}
