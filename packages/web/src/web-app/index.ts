/**
 * WebApp's public face: the page table (the modules' pages and the server's) and the layers,
 * for whatever renders under WebApp's root, and the rest of what the server contributes.
 */
import { useMemo } from "react";
import { webAppDeps, type WebAppLayer } from "./deps";
import { useRuntimeWebAppLayers } from "./runtime-plugins";

export type { PageData, ServerPage, WebAppPage } from "./page-table";
export { navPagesOf, pageTitle } from "./page-table";
export { useContributions, useWebAppPages } from "./contributions";

/** The contributed layers (compiled + active external plugins), by `order`. */
export function useWebAppLayers(): readonly WebAppLayer[] {
  const staticLayers = webAppDeps.useDeps().layers;
  const runtimeLayers = useRuntimeWebAppLayers();
  return useMemo(() => {
    if (runtimeLayers.length === 0) return staticLayers;
    const ids = new Set(staticLayers.map((l) => l.id));
    const extras = runtimeLayers.filter((l) => !ids.has(l.id));
    return extras.length === 0 ? staticLayers : [...staticLayers, ...extras];
  }, [staticLayers, runtimeLayers]);
}
