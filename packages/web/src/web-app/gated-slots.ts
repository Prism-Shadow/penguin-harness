/**
 * The shell's own slots for a web module that waits for its server module
 * (`WebAppModule.serverModules`, lib/module-gate.ts). WebAppModule records the declarations, so
 * it knows at boot which of its contributions are gated:
 *
 * - a layer is mounted only while its module is shown, and mounts the moment it is;
 * - a page carries its module (`gatedBy`), and the page table leaves it out while the module is
 *   not shown — routes and the nav alike (web-app/contributions.tsx);
 * - a session provider is not mounted at all: it wraps the whole signed-in tree, which turning
 *   it on and off would remount.
 *
 * Contributions of a module that declares nothing pass through as they are.
 */
import type { ComponentType, ReactNode } from "react";
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import type { ServerModuleData } from "@prismshadow/penguin-web-plugin";
import { gatedComponent, warnUngatable } from "../lib/module-gate";
import type { WebAppLayer, WebAppSessionProvider } from "./deps";
import type { WebAppPage } from "./page-table";

/** Each web module's declared server modules, by the web module's name. */
export function gatesOf(contributions: readonly Contributed[]): Map<string, string[]> {
  const gates = new Map<string, string[]>();
  for (const c of contributions) {
    const list = gates.get(c.from) ?? [];
    list.push((c.data as unknown as ServerModuleData).module);
    gates.set(c.from, list);
  }
  return gates;
}

type Gates = ReadonlyMap<string, readonly string[]>;

/** The layers in their order, a gated module's each behind its gate. */
export function layersOf(
  layers: ReadonlyArray<{
    id: string;
    from: string;
    Component: ComponentType;
    area: WebAppLayer["area"];
  }>,
  gates: Gates,
): WebAppLayer[] {
  return layers.map((layer) => ({
    id: layer.id,
    Component: gates.has(layer.from)
      ? gatedComponent(layer.from, layer.Component)
      : layer.Component,
    area: layer.area,
  }));
}

/** The page table with each gated module's page marked by its module. */
export function gatedPagesOf(
  pages: readonly WebAppPage[],
  contributions: readonly Contributed[],
  gates: Gates,
): readonly WebAppPage[] {
  const fromOf = new Map(contributions.map((c) => [c.id, c.from]));
  return pages.map((page) => {
    const from = fromOf.get(page.id);
    return from !== undefined && gates.has(from) ? { ...page, gatedBy: from } : page;
  });
}

/** The session providers in their order, without a gated module's (which is said on the console). */
export function sessionProvidersOf(
  providers: ReadonlyArray<{
    id: string;
    from: string;
    Component: ComponentType<{ children: ReactNode }>;
  }>,
  gates: Gates,
): WebAppSessionProvider[] {
  return providers.flatMap((provider) => {
    if (!gates.has(provider.from)) return [{ id: provider.id, Component: provider.Component }];
    warnUngatable(provider.from, "WebAppModule.sessionProviders");
    return [];
  });
}
