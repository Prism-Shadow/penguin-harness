/**
 * The dock: its `panels`, `scopeListeners` and `layoutListeners` slots (iface.ts), the layer that
 * keeps its scope on the conversation on screen (dock-scope.tsx), and a Workspace group's "Browse
 * files" in the session list (browse-files.ts).
 *
 * Each contributed panel is registered in the panel registry (panel-registry.ts) at boot — its
 * stored key, its name in the active language, its mark, its place, whether it leads the empty
 * dock's picker, and the module that contributed it — which every dock surface reads; a stored tab
 * of a kind nobody contributes keeps its place with a placeholder body. The listeners go to
 * dock-listeners.ts in their contributed order.
 */
import {
  Bind,
  Module,
  Provide,
  type ClassCtx,
  type Contributed,
} from "@prismshadow/penguin-core/kernel";

import { S, zh } from "../../lib/strings";
import { glyphOf } from "../../lib/nav-icons";
import type {
  DockLayoutListener,
  DockScopeListener,
  Ordered,
} from "@prismshadow/penguin-web-plugin";
import { DockScope } from "./dock-scope";
import { browseFilesAction } from "./browse-files";
import { setDockListeners } from "./dock-listeners";
import { registerDockPanel, type DockPanelDefinition } from "./panel-registry";

import type { Dock, DockPanel, DockPanelData, PanelOffering } from "./iface";

/** Registers the `panels` contributions in the panel registry, in their contributed order. */
function registerPanels(contributions: readonly Contributed[]): void {
  const main = contributions.flatMap((c) => {
    const lead = (c.data as unknown as DockPanelData).lead;
    const definitions =
      (c.code as { mainDefinitions?: readonly DockPanelDefinition[] }).mainDefinitions ?? [];
    // The data half says whether the kind leads the picker, unless its definition says it itself.
    return definitions.map((definition) => ({
      from: c.from,
      definition:
        lead === undefined || definition.lead !== undefined ? definition : { ...definition, lead },
    }));
  });
  const mainKinds = new Set(main.map(({ definition }) => definition.id));
  for (const { from, definition } of main) registerDockPanel(definition, from);
  for (const c of contributions) {
    if ("mainDefinitions" in (c.code as object)) continue;
    const data = c.data as unknown as DockPanelData;
    // A main definition owns its evolved body, labels and offering; never overwrite it.
    if (mainKinds.has(data.kind)) continue;
    const Body = c.code as DockPanel & PanelOffering;
    registerDockPanel(
      {
        id: data.kind,
        // Read at call time, like every registry label: `S` follows the active language.
        label: () => (S === zh ? data.titleZh : data.title),
        glyph: glyphOf(data.icon),
        order: data.order,
        ...(data.lead !== undefined ? { lead: data.lead } : {}),
        Body,
        ...(Body.offered !== undefined ? { offered: Body.offered } : {}),
        ...(Body.subscribeOffered !== undefined ? { subscribeOffered: Body.subscribeOffered } : {}),
      },
      c.from,
    );
  }
}

/** A listener slot's code halves, by `order`. */
function inOrder<F>(contributions: readonly Contributed[] | undefined): F[] {
  return [...(contributions ?? [])]
    .sort((a, b) => (a.data as unknown as Ordered).order - (b.data as unknown as Ordered).order)
    .map((c) => c.code as F);
}

@Module({
  contributes: {
    // Last of the layers: the layout's own effect it replaces ran after every layer's.
    "WebAppModule.layers": [{ id: "dock.scope", order: 50 }],
    "SessionListModule.rowActions": [{ id: "dock.browse-files", order: 10 }],
  },
})
export class DockModule {
  @Provide() dock!: Dock;
  @Bind("dock.scope") scope = DockScope;
  @Bind("dock.browse-files") browseFiles = browseFilesAction;
  setup({ contributions }: ClassCtx) {
    registerPanels(contributions.panels ?? []);
    setDockListeners({
      scope: inOrder<DockScopeListener>(contributions.scopeListeners),
      layout: inOrder<DockLayoutListener>(contributions.layoutListeners),
    });
    this.dock = {};
  }
}
