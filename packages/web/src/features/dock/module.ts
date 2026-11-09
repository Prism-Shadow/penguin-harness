/**
 * The dock: its `panels` slot (iface.ts), the layer that keeps its scope on the conversation on
 * screen (dock-scope.tsx), and a Workspace group's "Browse files" in the session list
 * (browse-files.ts).
 *
 * Each contributed panel is registered in the panel registry (panel-registry.ts) at boot — its
 * stored key, its name in the active language, its mark and its place — which every dock surface
 * reads; a stored tab of a kind nobody contributes keeps its place with a placeholder body.
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
import { DockScope } from "./dock-scope";
import { browseFilesAction } from "./browse-files";
import { registerDockPanel, type DockPanelDefinition } from "./panel-registry";

import type { Dock, DockPanel, DockPanelData, PanelOffering } from "./iface";

/** Registers the `panels` contributions in the panel registry, in their contributed order. */
function registerPanels(contributions: readonly Contributed[]): void {
  const main = contributions.flatMap(
    (c) => (c.code as { mainDefinitions?: readonly DockPanelDefinition[] }).mainDefinitions ?? [],
  );
  const mainKinds = new Set(main.map((definition) => definition.id));
  for (const definition of main) registerDockPanel(definition);
  for (const c of contributions) {
    if ("mainDefinitions" in (c.code as object)) continue;
    const data = c.data as unknown as DockPanelData;
    // A main definition owns its evolved body, labels and offering; never overwrite it.
    if (mainKinds.has(data.kind)) continue;
    const Body = c.code as DockPanel & PanelOffering;
    registerDockPanel({
      id: data.kind,
      // Read at call time, like every registry label: `S` follows the active language.
      label: () => (S === zh ? data.titleZh : data.title),
      glyph: glyphOf(data.icon),
      order: data.order,
      Body,
      ...(Body.offered !== undefined ? { offered: Body.offered } : {}),
      ...(Body.subscribeOffered !== undefined ? { subscribeOffered: Body.subscribeOffered } : {}),
    });
  }
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
    this.dock = {};
  }
}
