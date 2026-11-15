/**
 * The App Center: a Project's home screen of workbench shortcuts, and the one manifest key behind
 * it. A workbench asks to be shown with `penguin.appCenter` in its own package.json, beside
 * `penguin.version` and `penguin.modules`:
 *
 *   "appCenter": { "show": true, "title"?: "…", "titleZh"?: "…", "icon"?: "ui/icon.svg", "tab"?: "<key>" }
 *
 * The files are the truth. The shortcut list is read from the manifests, each folder's last load
 * status (`.build/status.json`) and whether a load of it is under way, never by loading a
 * workbench, so opening the App Center compiles nothing. The settings switch rewrites the one key
 * in the file; the load that follows records the edit as a version like any other.
 *
 * The icon is an image the browser fetches from a route of its own, never markup put into the
 * page: a file under `ui/` that reads clean as an icon (core's `iconImage`: the format its name
 * claims, by its bytes, at most 256 KB, and an SVG with nothing the deny-list names), re-checked
 * each time it is served.
 *
 * A declaration that does not hold up (a wrong type, an icon outside `ui/`, missing, too large or
 * not a clean image of the format its name says, a tab the manifest does not contribute) is not a
 * load error: the workbench loads as before, has no shortcut, and its load hints name the fix.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { iconImage, MAX_ICON_BYTES } from "@prismshadow/penguin-core";
import type { IconImage } from "@prismshadow/penguin-core";
import type { IconRef } from "../api/types.js";
import { iconRev } from "../http/icon-response.js";
import type { AppCenterShortcut, WorkbenchAppCenter } from "../mechanisms/workbenches.js";
import { readLoadStatus } from "./compile.js";
import { isSafeRelPath, isSwitchedOff, isWorkbenchId, TMP_SUFFIX, UI_DIR } from "./store.js";

const TITLE_MAX = 60;
const TABS_KEY = "WebModule.sessionTabs";

/** A tab as the manifest writes it, read without the load's checks: what a shortcut's defaults need. */
interface ManifestTab {
  key: string;
  title: string;
  titleZh?: string;
}

/** What a folder's package.json says, as far as the App Center is concerned. */
export interface AppCenterManifest {
  /** The package name, else the folder's id. */
  name: string;
  tabs: ManifestTab[];
  /** The declaration, when there is one and it holds up. */
  appCenter?: WorkbenchAppCenter;
  /**
   * The declared icon's content revision and whether it takes the text colour, when the
   * declaration holds up and names one; never its bytes, which the icon route reads again.
   */
  icon?: { rev: string; tint: boolean };
  /** Why a declaration that is there is not used, with the fix; null otherwise. */
  hint: string | null;
}

/** The package.json of a folder could not be rewritten: it is not a JSON object to edit. */
export class AppCenterManifestInvalid extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function manifestTabs(penguin: Record<string, unknown>): ManifestTab[] {
  const modules = Array.isArray(penguin["modules"]) ? penguin["modules"] : [];
  const tabs: ManifestTab[] = [];
  for (const manifest of modules) {
    const contributes = isRecord(manifest) ? manifest["contributes"] : undefined;
    const entries = isRecord(contributes) ? contributes[TABS_KEY] : undefined;
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!isRecord(entry)) continue;
      const { key, title, titleZh } = entry;
      if (typeof key !== "string" || typeof title !== "string") continue;
      tabs.push({ key, title, ...(typeof titleZh === "string" ? { titleZh } : {}) });
    }
  }
  return tabs;
}

/** A title field: absent, or a non-empty string of at most 60 characters. */
function titleProblem(name: string, value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "" || [...value].length > TITLE_MAX)
    return `"${name}" must be a non-empty string of at most ${TITLE_MAX} characters`;
  return null;
}

/** Reads and checks the declared icon: the image it is, or what is wrong with it. */
async function readIcon(
  dir: string,
  icon: unknown,
): Promise<{ icon: IconImage } | { problem: string }> {
  if (typeof icon !== "string" || !isSafeRelPath(icon) || !icon.startsWith(`${UI_DIR}/`))
    return { problem: `"icon" must name a file under ${UI_DIR}/` };
  const file = path.join(dir, icon);
  const stat = await fs.stat(file).catch(() => null);
  const size = stat?.isFile() === true ? stat.size : null;
  // Measured before it is read: a file of any size can be named.
  if (size !== null && size > MAX_ICON_BYTES) {
    const cap = `${MAX_ICON_BYTES / 1024} KB`;
    return { problem: `"icon": ${icon} is larger than ${cap} (${size} bytes)` };
  }
  const bytes = size !== null ? await fs.readFile(file).catch(() => null) : null;
  if (bytes === null) return { problem: `"icon" names ${icon}, which is not a file` };
  const checked = iconImage(bytes, icon);
  return "problem" in checked ? { problem: `"icon": ${icon} ${checked.problem}` } : checked;
}

/** A declaration that holds up, with the icon it names as read for the check; or its problem. */
type Checked = { appCenter: WorkbenchAppCenter; icon: IconImage | null } | { problem: string };

/** Checks `penguin.appCenter`. */
async function checkDeclaration(
  dir: string,
  value: unknown,
  tabs: readonly ManifestTab[],
): Promise<Checked> {
  if (!isRecord(value)) return { problem: 'it must be an object such as { "show": true }' };
  const { show, title, titleZh, icon, tab } = value;
  if (typeof show !== "boolean") return { problem: '"show" must be true or false' };
  const titled = titleProblem("title", title) ?? titleProblem("titleZh", titleZh);
  if (titled !== null) return { problem: titled };
  let file: IconImage | null = null;
  if (icon !== undefined) {
    const read = await readIcon(dir, icon);
    if ("problem" in read) return read;
    file = read.icon;
  }
  if (tab !== undefined && (typeof tab !== "string" || !tabs.some((t) => t.key === tab))) {
    return {
      problem: `"tab" must be the key of one of this workbench's tabs (${tabs.map((t) => t.key).join(", ") || "it has none"})`,
    };
  }
  return {
    appCenter: {
      show,
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof titleZh === "string" ? { titleZh } : {}),
      ...(typeof icon === "string" ? { icon } : {}),
      ...(typeof tab === "string" ? { tab } : {}),
    },
    icon: file,
  };
}

/**
 * What a workbench folder's package.json declares for the App Center, and the icon it names as
 * read for the check. A package.json that is missing or does not parse declares nothing: the load
 * reports that on its own.
 */
async function readDeclaration(
  dir: string,
  id: string,
): Promise<{ manifest: AppCenterManifest; icon: IconImage | null }> {
  let pkg: unknown = null;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as unknown;
  } catch {
    // Nothing to read: no declaration, and the load names what is wrong with the file.
  }
  const name =
    isRecord(pkg) && typeof pkg["name"] === "string" && pkg["name"] !== "" ? pkg["name"] : id;
  const penguin = isRecord(pkg) && isRecord(pkg["penguin"]) ? pkg["penguin"] : null;
  if (penguin === null) return { manifest: { name, tabs: [], hint: null }, icon: null };
  const tabs = manifestTabs(penguin);
  if (penguin["appCenter"] === undefined)
    return { manifest: { name, tabs, hint: null }, icon: null };
  const checked = await checkDeclaration(dir, penguin["appCenter"], tabs);
  if ("problem" in checked) {
    const hint =
      `package.json#penguin.appCenter is ignored: ${checked.problem}. ` +
      `Until it is fixed the workbench has no shortcut in the App Center.`;
    return { manifest: { name, tabs, hint }, icon: null };
  }
  const { appCenter, icon } = checked;
  return {
    manifest: {
      name,
      tabs,
      appCenter,
      ...(icon !== null ? { icon: { rev: iconRev(icon), tint: icon.tint } } : {}),
      hint: null,
    },
    icon,
  };
}

/** What a workbench folder's package.json declares for the App Center. */
export async function readAppCenterManifest(dir: string, id: string): Promise<AppCenterManifest> {
  return (await readDeclaration(dir, id)).manifest;
}

/**
 * The icon a workbench's declaration names, read and checked again: null when the declaration
 * does not hold up or names none.
 */
export async function readAppCenterIcon(dir: string, id: string): Promise<IconImage | null> {
  return (await readDeclaration(dir, id)).icon;
}

/**
 * Where a folder's build stands: a load under way (or about to start) wins over what the last
 * one recorded, and a folder this process has never loaded is ready unless its status says not.
 */
async function buildOf(
  dir: string,
  building: boolean,
): Promise<Pick<AppCenterShortcut, "build" | "error">> {
  if (building) return { build: "building" };
  const status = await readLoadStatus(dir);
  if (status?.failed !== true) return { build: "ready" };
  return { build: "failed", ...(status.error !== null ? { error: status.error } : {}) };
}

const segment = encodeURIComponent;

/**
 * The declared icon as a listing sends it — on a shortcut and on the workbench's own row alike:
 * the workbench's icon route with the image's revision, and how to draw it.
 */
export function appCenterIconRef(
  projectId: string,
  agentId: string,
  workbenchId: string,
  icon: { rev: string; tint: boolean },
): IconRef {
  const base = `/api/projects/${segment(projectId)}/agents/${segment(agentId)}/workbenches/${segment(workbenchId)}`;
  return { url: `${base}/app-center/icon?rev=${icon.rev}`, tint: icon.tint };
}

/** The shortcut a shown declaration makes: its titles, icon URL, the page it opens, its build. */
function shortcutOf(
  projectId: string,
  agent: { agentId: string; agentName: string },
  workbenchId: string,
  manifest: AppCenterManifest & { appCenter: WorkbenchAppCenter },
  build: Pick<AppCenterShortcut, "build" | "error">,
): AppCenterShortcut {
  const { appCenter, tabs } = manifest;
  const first = tabs[0];
  const titleZh = appCenter.titleZh ?? first?.titleZh;
  const tab = appCenter.tab ?? first?.key;
  const page = `/app/${segment(projectId)}/${segment(agent.agentId)}/${segment(workbenchId)}`;
  return {
    agentId: agent.agentId,
    agentName: agent.agentName,
    workbenchId,
    title: appCenter.title ?? first?.title ?? manifest.name,
    ...(titleZh !== undefined ? { titleZh } : {}),
    ...(manifest.icon !== undefined
      ? { icon: appCenterIconRef(projectId, agent.agentId, workbenchId, manifest.icon) }
      : {}),
    path: appCenter.tab !== undefined ? `${page}/${segment(appCenter.tab)}` : page,
    ...(tab !== undefined ? { tab } : {}),
    ...build,
  };
}

/**
 * One Agent's shortcuts, by title: every folder under `base` with a package.json whose
 * declaration holds up and says `show: true`, and whose own switch is on (one turned off serves
 * nothing, so it has no tile; the caller leaves out an Agent whose Agent-wide switch is off). `building` says whether a load of a folder is under
 * way or queued in this process; the caller keeps that, this module keeps no state.
 */
export async function agentShortcuts(
  projectId: string,
  agent: { agentId: string; agentName: string },
  base: string,
  building: (workbenchId: string) => boolean,
): Promise<AppCenterShortcut[]> {
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
  const out: AppCenterShortcut[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isWorkbenchId(entry.name)) continue;
    const dir = path.join(base, entry.name);
    const manifest = await readAppCenterManifest(dir, entry.name);
    if (manifest.appCenter?.show !== true || (await isSwitchedOff(dir))) continue;
    const shown = { ...manifest, appCenter: manifest.appCenter };
    const build = await buildOf(dir, building(entry.name));
    out.push(shortcutOf(projectId, agent, entry.name, shown, build));
  }
  return out.sort(
    (a, b) => a.title.localeCompare(b.title) || a.workbenchId.localeCompare(b.workbenchId),
  );
}

/**
 * Sets `penguin.appCenter.show` in the folder's package.json and changes nothing else: the other
 * keys keep their values and order, an `appCenter` object keeps its other fields, and a missing
 * or malformed one becomes `{ "show": … }`. Written as 2-space JSON with a final newline, through
 * a staged file the watcher does not read as an edit, so the rename is the one change it sees.
 */
export async function writeAppCenterShow(dir: string, show: boolean): Promise<void> {
  const file = path.join(dir, "package.json");
  let pkg: unknown;
  try {
    pkg = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch {
    throw new AppCenterManifestInvalid("package.json is not valid JSON");
  }
  if (!isRecord(pkg)) throw new AppCenterManifestInvalid("package.json is not a JSON object");
  const penguin = pkg["penguin"] ?? {};
  if (!isRecord(penguin))
    throw new AppCenterManifestInvalid("package.json#penguin is not a JSON object");
  const current = penguin["appCenter"];
  penguin["appCenter"] = isRecord(current) ? { ...current, show } : { show };
  pkg["penguin"] = penguin;
  const staged = `${file}${TMP_SUFFIX}app-center`;
  try {
    await fs.writeFile(staged, `${JSON.stringify(pkg, null, 2)}\n`);
    await fs.rename(staged, file);
  } catch (err) {
    await fs.rm(staged, { force: true }).catch(() => undefined);
    throw err;
  }
}
