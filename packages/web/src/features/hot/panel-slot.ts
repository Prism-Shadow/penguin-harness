/**
 * Web-side hot panel slot: the same kernel (Park + boot + static tree) the
 * server platform runs on, driving a UI node whose code arrives from the
 * server at runtime (/api/hot/ui/panel.js?rev=...).
 *
 * The panel module receives its dependencies (react, zustand) through `deps`
 * — the seed-table mechanism in miniature: heavy shared modules come from the
 * shell, the panel bundle stays gist-sized. Hot swap = park the store state →
 * import the new code → boot with the parked document.
 */
import type { ComponentType } from "react";
import type { Impl, Instance, Json, Park, Resources } from "@prismshadow/penguin-core/kernel";
import { boot, BootError, defineIface, initialDoc, s } from "@prismshadow/penguin-core/kernel";

/** Dependencies injected into panel modules (the shell's seed table). */
export interface PanelDeps {
  react: unknown;
  createStore: unknown;
  useStore: unknown;
}

/** The contract a panel module exports: `export const panel = {...}`. */
export interface PanelModule {
  name: string;
  version: number;
  create(deps: PanelDeps, state: Json): { park(): Json; Component: ComponentType };
}

export interface PanelApi extends Park {
  Component: ComponentType;
  describe(): { name: string; version: number };
}

export type PanelCtx = { rev: string; state: Json };

export const PanelSlotIface = defineIface<PanelApi, PanelCtx>({
  name: "ui-panel-slot",
  version: 1,
  context: s.object<PanelCtx>({ rev: s.string(), state: s.json() }),
  methods: ["park", "Component", "describe"],
});

export type PanelModuleLoader = (rev: string) => Promise<{ panel?: PanelModule }>;

export function panelSlotImpl(deps: PanelDeps, load: PanelModuleLoader): Impl<PanelApi, PanelCtx> {
  return {
    async create(_ctx, context) {
      const mod = await load(context.rev);
      if (mod.panel === undefined || typeof mod.panel.create !== "function") {
        throw new BootError("panel module does not export a 'panel' contract");
      }
      const panel = mod.panel;
      const api = panel.create(deps, context.state);
      return {
        park: () => ({ rev: context.rev, state: api.park() }),
        Component: api.Component,
        describe: () => ({ name: panel.name, version: panel.version }),
      };
    },
  };
}

/** Web side has no live runtime resources (yet): a null registry. */
export const noResources: Resources = {
  register: () => undefined,
  claim: () => undefined,
  release: () => undefined,
};

/** First boot: no prior state. */
export async function bootPanel(
  deps: PanelDeps,
  load: PanelModuleLoader,
  rev: string,
): Promise<Instance<PanelApi>> {
  return boot(
    panelSlotImpl(deps, load),
    PanelSlotIface,
    initialDoc(PanelSlotIface, { rev, state: null }),
    noResources,
  );
}

/**
 * Hot swap: park the running panel, re-boot with the new rev — the state
 * document rides across, React remounts the new Component. The old instance
 * is disposed only after the new module loaded (prefetch-then-swap would be
 * the next refinement; MVP keeps the straight line).
 */
export async function swapPanel(
  current: Instance<PanelApi>,
  deps: PanelDeps,
  load: PanelModuleLoader,
  rev: string,
): Promise<Instance<PanelApi>> {
  const parked = current.park();
  const state = (parked.self as { state: Json }).state;
  current.dispose();
  return boot(
    panelSlotImpl(deps, load),
    PanelSlotIface,
    initialDoc(PanelSlotIface, { rev, state }),
    noResources,
  );
}
