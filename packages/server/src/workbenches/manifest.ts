/**
 * Workbench PWA manifests: what a workbench's "add to home screen" answers.
 *
 * A manifest is generated for each workbench from what it already is — its registration
 * (`name`, `version` from its package.json, its tabs) and its plugin icon — with no manifest
 * file of its own: `name` is the tab's title when it contributes one (falling back to the
 * workbench's name), `scope` and `start_url` are the workbench's full-page app route
 * (`/app/<project>/<agent>/<workbench>`, the page whose manifest link names this manifest —
 * the whole shell, standalone), and the icon is the plugin icon a workbench already ships as
 * a plugin package (`package.json#penguin.icon`, `icon.svg` at the root, read through core's
 * `readPluginIcon` — the same reader and the same safe-SVG face the plugin library uses),
 * inlined as a `data:image/svg+xml` (or PNG as `data:image/png`) icon so it has no external
 * reference and rides with the install; a workbench without one falls back to the main app's
 * penguin SVG. No service worker is implied: this is only the install surface. Pure
 * functions; the route (./routes.ts) only mounts them.
 */
import type { WorkbenchInfo } from "../mechanisms/workbenches.js";

export const MANIFEST_FILE = "manifest.webmanifest";
/** The main app's icon, the fallback for a workbench that ships no plugin icon. */
export const MAIN_ICON = "/penguin-logo.svg";

/** One icon entry of a PWA manifest: an inlined SVG or PNG (the type follows the kind). */
export interface WorkbenchManifestIcon {
  src: string;
  sizes: string;
  type: "image/svg+xml" | "image/png";
}

/** A PWA manifest: only what the install surface needs. */
export interface WorkbenchManifest {
  name: string;
  short_name: string;
  version: string;
  start_url: string;
  scope: string;
  display: "standalone";
  icons: WorkbenchManifestIcon[];
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
 * The workbench's full-page app route: the page that installs the workbench as its own app
 * (its manifest link points here), and the manifest's `start_url` and `scope` — launching the
 * app opens the shell on this workbench, and the scope keeps its navigations in the window.
 */
export function workbenchAppBase(
  projectId: string,
  agentId: string,
  workbenchId: string,
  tabKey?: string,
): string {
  const segments = [projectId, agentId, workbenchId, ...(tabKey === undefined ? [] : [tabKey])].map(
    encodeURIComponent,
  );
  return `/app/${segments.join("/")}`;
}

/**
 * The workbench's plugin icon as a PWA icon entry: inlined, so it rides with the install. An
 * SVG is base64-encoded here (the reader hands markup over); a PNG arrives already base64.
 * Null (no icon, or one refused) falls back to the main app's penguin SVG.
 */
export function workbenchIcon(
  icon: { kind: "svg" | "png"; data: string } | null,
): WorkbenchManifestIcon {
  if (icon === null) return { src: MAIN_ICON, sizes: "any", type: "image/svg+xml" };
  if (icon.kind === "png")
    return { src: `data:image/png;base64,${icon.data}`, sizes: "any", type: "image/png" };
  return {
    src: `data:image/svg+xml;base64,${Buffer.from(icon.data, "utf8").toString("base64")}`,
    sizes: "any",
    type: "image/svg+xml",
  };
}

/**
 * The manifest for one workbench — or, when `tabKey` is given, for one of its tabs. `name`
 * and `short_name` come from one source — the tab's own title (the tab is the thing a person
 * opens), falling back to the workbench's own name — because a browser shows one in the
 * install prompt and the other as the launcher label, and two different sources read as two
 * different apps ("preview says A, the icon says B"). A tab may declare its own launcher
 * label (`shortName` in its sessionTabs contribution); it overrides the title for
 * `short_name`, so a tab installs under a name that fits under an icon without giving up
 * its title in the strip.
 *
 * A tab's manifest makes the tab its own installable app: `start_url` and `scope` are the
 * tab's full-page route, so launching the icon opens THAT tab — one workbench installs as
 * one app per tab, not one shared app.
 *
 * The icon is the plugin icon the service resolved (`icon`, null when the workbench ships
 * none), the main app's penguin otherwise.
 */
export function workbenchManifest(
  projectId: string,
  agentId: string,
  info: WorkbenchInfo,
  icon: { kind: "svg" | "png"; data: string } | null,
  tabKey?: string,
): WorkbenchManifest {
  const tab = tabKey === undefined ? undefined : info.tabs.find((t) => t.key === tabKey);
  // Unreachable through the route (it 404s an unknown tab first); a guard, not a fallback.
  if (tabKey !== undefined && tab === undefined)
    throw new Error(`workbench '${info.id}' has no tab '${tabKey}'`);
  const base = workbenchAppBase(projectId, agentId, info.id, tabKey);
  const title = tab?.title ?? info.tabs[0]?.title ?? info.name;
  return {
    name: title,
    short_name: tab?.shortName ?? title,
    version: info.version ?? "0.0.0",
    start_url: base,
    scope: base,
    display: "standalone",
    icons: [workbenchIcon(icon)],
  };
}
