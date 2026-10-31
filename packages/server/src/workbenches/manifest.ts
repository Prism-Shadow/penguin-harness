/**
 * Workbench PWA manifests: what a workbench's "add to home screen" answers.
 *
 * A manifest is generated for each workbench from what it already is — its registration
 * (`name`, `version` from its package.json, its tabs) — with no manifest file of its own:
 * `name` is the tab's title when it contributes one (falling back to the workbench's name),
 * `scope` and `start_url` are its `ui/` path (where its tabs' pages are served from), and
 * icons follow the convention `ui/icons/icon-192.png` / `icon-512.png`, falling back to the
 * main app's penguin icons when the workbench ships none. No service worker is implied: this
 * is only the install surface, so the browser opens the workbench's own UI standalone. Pure
 * functions; the route (./routes.ts) only mounts them.
 */
import type { WorkbenchInfo } from "../mechanisms/workbenches.js";

export const MANIFEST_FILE = "manifest.webmanifest";
/** The main app's icons, the fallback for a workbench without its own `ui/icons/`. */
export const MAIN_ICON_192 = "/penguin-logo-192.png";
export const MAIN_ICON_512 = "/penguin-logo-512.png";
/** Where a workbench's own icons live, relative to its `ui/`. */
export const WORKBENCH_ICONS = [
  { file: "icons/icon-192.png", sizes: "192x192" },
  { file: "icons/icon-512.png", sizes: "512x512" },
] as const;

/** A PWA manifest: only what the install surface needs. */
export interface WorkbenchManifest {
  name: string;
  short_name: string;
  version: string;
  start_url: string;
  scope: string;
  display: "standalone";
  icons: { src: string; sizes: string; type: "image/png" }[];
}

/** The workbench's `ui/` mount: its own scope, and the base of every icon URL it serves. */
export function workbenchUiBase(projectId: string, agentId: string, workbenchId: string): string {
  return (
    `/api/projects/${encodeURIComponent(projectId)}` +
    `/agents/${encodeURIComponent(agentId)}` +
    `/workbenches/${encodeURIComponent(workbenchId)}/ui/`
  );
}

/**
 * The manifest for one workbench. `name` is its first tab's title (the tab is the thing a
 * person opens), falling back to the workbench's own name; icons come from its `ui/icons/`
 * when it ships them (each `shipped` a path that exists, as the route checks through the same
 * `ui/` serving its pages), the main app's penguin otherwise.
 */
export function workbenchManifest(
  projectId: string,
  agentId: string,
  info: WorkbenchInfo,
  shipped: readonly string[],
): WorkbenchManifest {
  const base = workbenchUiBase(projectId, agentId, info.id);
  const icons = WORKBENCH_ICONS.filter(({ file }) => shipped.includes(file)).map(
    ({ file, sizes }) => ({ src: base + file, sizes, type: "image/png" as const }),
  );
  return {
    name: info.tabs[0]?.title ?? info.name,
    short_name: info.name,
    version: info.version ?? "0.0.0",
    start_url: base,
    scope: base,
    display: "standalone",
    icons:
      icons.length > 0
        ? icons
        : [
            { src: MAIN_ICON_192, sizes: "192x192", type: "image/png" },
            { src: MAIN_ICON_512, sizes: "512x512", type: "image/png" },
          ],
  };
}
