/**
 * Workbench PWA manifests: what a workbench's "add to home screen" answers.
 *
 * A manifest is generated for each workbench from what it already is — its registration
 * (`name`, `version` from its package.json, its tabs) and its plugin icon — with no manifest
 * file of its own: `name` is the tab's title when it contributes one (falling back to the
 * workbench's name), `scope` and `start_url` are its `ui/` path (where its tabs' pages are
 * served from), and the icon is the plugin icon a workbench already ships as a plugin package
 * (`package.json#penguin.icon`, `icon.svg` at the root, read through core's `readPluginIcon` —
 * the same reader and the same safe-SVG face the plugin library uses), inlined as a
 * `data:image/svg+xml` icon so it has no external reference and rides with the install; a
 * workbench without one falls back to the main app's penguin SVG. No service worker is
 * implied: this is only the install surface, so the browser opens the workbench's own UI
 * standalone. Pure functions; the route (./routes.ts) only mounts them.
 */
import type { WorkbenchInfo } from "../mechanisms/workbenches.js";

export const MANIFEST_FILE = "manifest.webmanifest";
/** The main app's icon, the fallback for a workbench that ships no plugin icon. */
export const MAIN_ICON = "/penguin-logo.svg";

/** A PWA manifest: only what the install surface needs. */
export interface WorkbenchManifest {
  name: string;
  short_name: string;
  version: string;
  start_url: string;
  scope: string;
  display: "standalone";
  icons: { src: string; sizes: string; type: "image/svg+xml" }[];
}

/** The workbench's `ui/` mount: its own scope, and the base of every icon URL it serves. */
export function workbenchUiBase(projectId: string, agentId: string, workbenchId: string): string {
  return (
    `/api/projects/${encodeURIComponent(projectId)}` +
    `/agents/${encodeURIComponent(agentId)}` +
    `/workbenches/${encodeURIComponent(workbenchId)}/ui/`
  );
}

/** The workbench's plugin icon as a PWA icon entry: inlined, so it rides with the install. */
export function workbenchIcon(iconSvg: string | null): {
  src: string;
  sizes: string;
  type: "image/svg+xml";
} {
  if (iconSvg === null) return { src: MAIN_ICON, sizes: "any", type: "image/svg+xml" };
  return {
    src: `data:image/svg+xml;base64,${Buffer.from(iconSvg, "utf8").toString("base64")}`,
    sizes: "any",
    type: "image/svg+xml",
  };
}

/**
 * The manifest for one workbench. `name` is its first tab's title (the tab is the thing a
 * person opens), falling back to the workbench's own name; the icon is the plugin icon the
 * folder read (`iconSvg`, null when the workbench ships none), the main app's penguin
 * otherwise.
 */
export function workbenchManifest(
  projectId: string,
  agentId: string,
  info: WorkbenchInfo,
  iconSvg: string | null,
): WorkbenchManifest {
  const base = workbenchUiBase(projectId, agentId, info.id);
  return {
    name: info.tabs[0]?.title ?? info.name,
    short_name: info.name,
    version: info.version ?? "0.0.0",
    start_url: base,
    scope: base,
    display: "standalone",
    icons: [workbenchIcon(iconSvg)],
  };
}
