/**
 * The App Center: a Project's home screen of workbench shortcuts, and the one manifest key behind
 * it. A workbench asks to be shown with `penguin.appCenter` in its own package.json, beside
 * `penguin.version` and `penguin.modules`:
 *
 *   "appCenter": { "show": true, "title"?: "…", "titleZh"?: "…", "icon"?: "ui/icon.svg", "tab"?: "<key>" }
 *
 * The files are the truth. The shortcut list is read from the manifests and each folder's last
 * load status (`.build/status.json`) and never by loading a workbench, so opening the App Center
 * compiles nothing. The settings switch rewrites the one key in the file; the load that follows
 * records the edit as a version like any other.
 *
 * A declaration that does not hold up (a wrong type, an icon outside `ui/` or too large, a tab
 * the manifest does not contribute) is not a load error: the workbench loads as before, has no
 * shortcut, and its load hints name the fix.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { AppCenterShortcut, WorkbenchAppCenter } from "../mechanisms/workbenches.js";
import { BUILD_DIR, STATUS_FILE } from "./compile.js";
import {
  isSafeRelPath,
  isWorkbenchId,
  TMP_SUFFIX,
  UI_DIR,
} from "./store.js";

const TITLE_MAX = 60;
const ICON_MAX_BYTES = 256 * 1024;
const ICON_TYPES = new Set([".svg", ".png", ".webp"]);
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

async function iconProblem(dir: string, icon: unknown): Promise<string | null> {
  if (icon === undefined) return null;
  const rule = `"icon" must name a .svg, .png or .webp file under ${UI_DIR}/ of at most 256 KB`;
  if (typeof icon !== "string" || !isSafeRelPath(icon) || !icon.startsWith(`${UI_DIR}/`))
    return rule;
  if (!ICON_TYPES.has(path.extname(icon).toLowerCase())) return rule;
  const stat = await fs.stat(path.join(dir, icon)).catch(() => null);
  if (stat === null || !stat.isFile()) return `"icon" names ${icon}, which is not a file`;
  if (stat.size > ICON_MAX_BYTES) return `${rule} (${icon} is ${stat.size} bytes)`;
  return null;
}

/** Checks `penguin.appCenter`; the first problem found, or the declaration it makes. */
async function checkDeclaration(
  dir: string,
  value: unknown,
  tabs: readonly ManifestTab[],
): Promise<{ appCenter: WorkbenchAppCenter } | { problem: string }> {
  if (!isRecord(value)) return { problem: 'it must be an object such as { "show": true }' };
  const { show, title, titleZh, icon, tab } = value;
  if (typeof show !== "boolean") return { problem: '"show" must be true or false' };
  const problem =
    titleProblem("title", title) ??
    titleProblem("titleZh", titleZh) ??
    (await iconProblem(dir, icon)) ??
    (tab !== undefined && (typeof tab !== "string" || !tabs.some((t) => t.key === tab))
      ? `"tab" must be the key of one of this workbench's tabs (${tabs.map((t) => t.key).join(", ") || "it has none"})`
      : null);
  if (problem !== null) return { problem };
  return {
    appCenter: {
      show,
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof titleZh === "string" ? { titleZh } : {}),
      ...(typeof icon === "string" ? { icon } : {}),
      ...(typeof tab === "string" ? { tab } : {}),
    },
  };
}

/**
 * Reads what a workbench folder's package.json declares for the App Center. A package.json that
 * is missing or does not parse declares nothing: the load reports that on its own.
 */
export async function readAppCenterManifest(dir: string, id: string): Promise<AppCenterManifest> {
  let pkg: unknown = null;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as unknown;
  } catch {
    // Nothing to read: no declaration, and the load names what is wrong with the file.
  }
  const name = isRecord(pkg) && typeof pkg["name"] === "string" && pkg["name"] !== "" ? pkg["name"] : id;
  const penguin = isRecord(pkg) && isRecord(pkg["penguin"]) ? pkg["penguin"] : null;
  if (penguin === null) return { name, tabs: [], hint: null };
  const tabs = manifestTabs(penguin);
  if (penguin["appCenter"] === undefined) return { name, tabs, hint: null };
  const checked = await checkDeclaration(dir, penguin["appCenter"], tabs);
  if ("appCenter" in checked) return { name, tabs, appCenter: checked.appCenter, hint: null };
  return {
    name,
    tabs,
    hint:
      `package.json#penguin.appCenter is ignored: ${checked.problem}. ` +
      `Until it is fixed the workbench has no shortcut in the App Center.`,
  };
}

/** Whether the last load of the folder failed, as its status file records it. */
async function lastLoadFailed(dir: string): Promise<boolean> {
  try {
    const status = JSON.parse(
      await fs.readFile(path.join(dir, BUILD_DIR, STATUS_FILE), "utf8"),
    ) as unknown;
    return isRecord(status) && status["ok"] === false;
  } catch {
    // Never loaded here: nothing says it is broken.
    return false;
  }
}

const segment = encodeURIComponent;

/** The shortcut a shown declaration makes: its titles, icon URL and the full page it opens. */
function shortcutOf(
  projectId: string,
  agent: { agentId: string; agentName: string },
  workbenchId: string,
  manifest: AppCenterManifest & { appCenter: WorkbenchAppCenter },
  broken: boolean,
): AppCenterShortcut {
  const { appCenter, tabs } = manifest;
  const first = tabs[0];
  const titleZh = appCenter.titleZh ?? first?.titleZh;
  const base = `/api/projects/${segment(projectId)}/agents/${segment(agent.agentId)}/workbenches/${segment(workbenchId)}`;
  const page = `/app/${segment(projectId)}/${segment(agent.agentId)}/${segment(workbenchId)}`;
  return {
    agentId: agent.agentId,
    agentName: agent.agentName,
    workbenchId,
    title: appCenter.title ?? first?.title ?? manifest.name,
    ...(titleZh !== undefined ? { titleZh } : {}),
    ...(appCenter.icon !== undefined
      ? {
          iconUrl: `${base}/${UI_DIR}/${appCenter.icon
            .slice(UI_DIR.length + 1)
            .split("/")
            .map(segment)
            .join("/")}`,
        }
      : {}),
    path: appCenter.tab !== undefined ? `${page}/${segment(appCenter.tab)}` : page,
    ...(broken ? { broken: true as const } : {}),
  };
}

/**
 * One Agent's shortcuts, by title: every folder under `base` with a package.json whose
 * declaration holds up and says `show: true`.
 */
export async function agentShortcuts(
  projectId: string,
  agent: { agentId: string; agentName: string },
  base: string,
): Promise<AppCenterShortcut[]> {
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
  const out: AppCenterShortcut[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isWorkbenchId(entry.name)) continue;
    const dir = path.join(base, entry.name);
    const manifest = await readAppCenterManifest(dir, entry.name);
    if (manifest.appCenter?.show !== true) continue;
    out.push(
      shortcutOf(
        projectId,
        agent,
        entry.name,
        { ...manifest, appCenter: manifest.appCenter },
        await lastLoadFailed(dir),
      ),
    );
  }
  return out.sort((a, b) => a.title.localeCompare(b.title) || a.workbenchId.localeCompare(b.workbenchId));
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
