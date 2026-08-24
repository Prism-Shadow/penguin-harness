/**
 * Kernel update: advance a stored `system_config.yaml` to the current built-in defaults
 * **without losing user customizations** — the smart-merge counterpart of
 * `resetSystemConfigToDefaults` (which overwrites everything; the two actions sit side by
 * side in the Web App).
 *
 * The unit is a **settings tab** (see KERNEL_TABS), matched and written whole:
 *
 * - tab absent from the config → it predates the section, so the defaults are materialized
 *   (reported `advanced`);
 * - tab hashing equal to the current default → untouched, not reported;
 * - tab hashing equal to a **superseded default** (KERNEL_HISTORY.superseded) → an old default
 *   the user never edited: every path the tab owns is rewritten from the current defaults
 *   (`advanced`), which is also how tools added since reach the config;
 * - anything else → the user edited something in that tab, or it comes from a generation too
 *   old to be recorded: the whole tab is conservatively kept (`kept`), edits, additions and
 *   deliberate deletions alike. Restore-default-config remains the full-refresh recourse.
 *
 * Never touched: `name`, `description`, `version` (the optimization counter) and
 * `tools.mcpServers` — identity and user-owned data, none of them owned by a kernel tab. The
 * file is edited via yaml `parseDocument`, so comments and untouched content survive (same
 * mechanism as the config PUT); finally the config is stamped `kernel_version: KERNEL_VERSION`.
 */
import fs from "node:fs/promises";
import { parseDocument, parse as parseYaml } from "yaml";
import { defaultSystemConfig } from "./default-config.js";
import {
  KERNEL_SUPERSEDED_TAB_HASHES,
  KERNEL_TABS,
  KERNEL_TAB_KEYS,
  KERNEL_VERSION,
  isSupersededTab,
  kernelTabHash,
  valueAtPath,
  type KernelSupersededTabHashes,
  type KernelTab,
} from "./kernel-history.js";
import { assertValidId } from "./agent-state.js";
import { systemConfigPath } from "./paths.js";

/** Outcome of a kernel update, tab keys in the settings page's tab order (see KERNEL_TABS). */
export interface KernelUpdateResult {
  /** Tabs written to the current defaults (previously absent, or an untouched old default). */
  advanced: KernelTab[];
  /** Tabs left alone because they match no recorded default (customized — and unrecorded old generations, kept conservatively). */
  kept: KernelTab[];
  /** The stamp written: always the current KERNEL_VERSION. */
  kernelVersion: string;
}

/** Test seam: alternate superseded tab hashes (same shape as KERNEL_SUPERSEDED_TAB_HASHES). Production callers never pass it. */
export interface KernelUpdateOptions {
  supersededTabs?: KernelSupersededTabHashes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function applyKernelUpdate(
  root: string,
  projectId: string,
  agentId: string,
  options?: KernelUpdateOptions,
): Promise<KernelUpdateResult> {
  // Validate before building paths, to prevent path traversal.
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  const configPath = systemConfigPath(root, projectId, agentId);
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch {
    throw new Error(`Agent State config not found: ${configPath} (the Agent does not exist).`);
  }
  const parsed = parseYaml(raw) as unknown;
  const stored = isPlainObject(parsed) ? parsed : {};
  const doc = parseDocument(raw);

  const superseded = options?.supersededTabs ?? KERNEL_SUPERSEDED_TAB_HASHES;
  const advanced: KernelTab[] = [];
  const kept: KernelTab[] = [];

  /**
   * setIn that tolerates an invalid intermediate node — a hand-edited dangling `tools:` key
   * parses as null, and `doc.setIn(["tools", …])` would throw "Expected YAML collection" on
   * it. Such a section is effectively missing on the read side (the tab reads absent and gets
   * materialized), so it is replaced by a map first — once, tracked so a later write to the
   * same section does not wipe the earlier one.
   */
  const replacedSections = new Set<string>();
  const setDeep = (segments: string[], value: unknown): void => {
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i);
      const key = ancestor.join(".");
      if (replacedSections.has(key)) continue;
      const existing = valueAtPath(stored, ancestor);
      if (existing !== undefined && !isPlainObject(existing)) {
        // createNode: a bare `{}` would be stored verbatim as a JS object, not a YAMLMap,
        // and the child setIn below would still throw.
        doc.setIn(ancestor, doc.createNode({}));
        replacedSections.add(key);
      }
    }
    doc.setIn(segments, value);
  };

  const defaults = defaultSystemConfig();

  for (const tab of KERNEL_TAB_KEYS) {
    const storedHash = kernelTabHash(stored, tab);
    if (storedHash !== null) {
      if (storedHash === kernelTabHash(defaults, tab)) continue;
      if (!isSupersededTab(tab, storedHash, superseded)) {
        kept.push(tab);
        continue;
      }
    }
    // Absent, or an untouched old default: write every path the tab owns from the defaults.
    for (const path of KERNEL_TABS[tab]) {
      const segments = path.split(".");
      const value = valueAtPath(defaults, segments);
      if (value !== undefined) setDeep(segments, value);
    }
    advanced.push(tab);
  }

  doc.setIn(["kernel_version"], KERNEL_VERSION);
  await fs.writeFile(configPath, doc.toString(), "utf8");
  return { advanced, kept, kernelVersion: KERNEL_VERSION };
}
