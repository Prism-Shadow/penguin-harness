/**
 * Kernel update: advance a stored `system_config.yaml` to the current built-in defaults
 * **without losing user customizations** — the smart-merge counterpart of
 * `resetSystemConfigToDefaults` (which overwrites everything; the two actions sit side by
 * side in the Web App).
 *
 * Per kernel-managed leaf of the current defaults (see kernelLeafEntries):
 *
 * - stored value missing → the effective value was already the built-in fallback, so the new
 *   default is materialized (reported `advanced`);
 * - stored value equal to the new default → untouched, not reported;
 * - stored value hash-matching **any recorded defaults generation** (KERNEL_HASH_HISTORY) →
 *   it is an old default the user never edited: replaced by the new default (`advanced`);
 * - anything else → a user customization or an unrecorded generation: conservatively kept
 *   (`kept`). Old generations beyond the seeded ones cannot be reconstructed, so their
 *   values also land here — restore-default-config remains the full-refresh recourse.
 *
 * `tools.builtin` merges per tool name: entries the user edited are kept individually while
 * the rest advance; entries the user added (names outside the defaults) are always kept and
 * never reported; a default-named entry the user *removed* from a present array stays
 * removed (`kept`) unless the tool is new in the latest generation — only then is it
 * genuinely new to this config and appended (`advanced`). If a default tool is ever removed
 * from the defaults, stale copies are conservatively kept the same way (they fall outside
 * the traversal base).
 *
 * Never touched: `name`, `description`, `version` (the optimization counter) and
 * `tools.mcpServers` — identity and user-owned data. The file is edited via yaml
 * `parseDocument`, so comments and untouched content survive (same mechanism as the config
 * PUT); finally the config is stamped `kernel_version: KERNEL_VERSION`.
 */
import fs from "node:fs/promises";
import { parseDocument, parse as parseYaml } from "yaml";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { defaultSystemConfig } from "./default-config.js";
import {
  KERNEL_HASH_HISTORY,
  KERNEL_VERSION,
  hashKernelValue,
  kernelLeafEntries,
} from "./kernel-history.js";
import { assertValidId } from "./agent-state.js";
import { systemConfigPath } from "./paths.js";

/** Outcome of a kernel update, path lists in defaults-traversal order (dotted leaf paths, `tools.builtin.<name>` per tool). */
export interface KernelUpdateResult {
  /** Leaves written to the new default (previously missing, or an untouched old default). */
  advanced: string[];
  /** Leaves left alone because the stored value matches no recorded defaults generation (user customizations — and unrecorded old generations, kept conservatively). */
  kept: string[];
  /** The stamp written: always the current KERNEL_VERSION. */
  kernelVersion: string;
}

/** Test seam: an alternate hash history (same shape as KERNEL_HASH_HISTORY). Production callers never pass it. */
export interface KernelUpdateOptions {
  history?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The stored value at a dotted-path's segments, or undefined when any segment is missing. */
function getAtPath(root: unknown, segments: string[]): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (!isPlainObject(current)) return undefined;
    current = current[segment];
  }
  return current;
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

  const history = options?.history ?? KERNEL_HASH_HISTORY;
  const latestGeneration = Object.keys(history).sort().at(-1);
  /** Hashes any recorded generation gives for a leaf path (an old generation without the path contributes nothing). */
  const historicalHashes = (path: string): Set<string> => {
    const hashes = new Set<string>();
    for (const generation of Object.values(history)) {
      const hash = generation[path];
      if (hash !== undefined) hashes.add(hash);
    }
    return hashes;
  };
  /** Whether a path is recorded only by the latest generation — i.e. new to the defaults in this generation. */
  const newInLatestGeneration = (path: string): boolean =>
    Object.entries(history).every(
      ([generation, hashes]) => generation === latestGeneration || hashes[path] === undefined,
    );

  const advanced: string[] = [];
  const kept: string[] = [];

  /**
   * setIn that tolerates an invalid intermediate node — a hand-edited dangling `tools:` key
   * parses as null, and `doc.setIn(["tools", …])` would throw "Expected YAML collection" on
   * it. Such a section is effectively missing on the read side (every leaf under it reads
   * undefined and gets materialized), so it is replaced by a map first — once, tracked so a
   * later leaf of the same section does not wipe the earlier one's write.
   */
  const replacedSections = new Set<string>();
  const setDeep = (segments: string[], value: unknown): void => {
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i);
      const key = ancestor.join(".");
      if (replacedSections.has(key)) continue;
      const existing = getAtPath(stored, ancestor);
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
  const defaultTools = defaults.tools?.builtin ?? [];
  /** The merged tools.builtin array, built only when the stored config carries one (else the whole default array is materialized). */
  let mergedTools: unknown[] | null = null;
  let toolsChanged = false;
  const storedTools = getAtPath(stored, ["tools", "builtin"]);
  if (Array.isArray(storedTools)) {
    mergedTools = [...storedTools];
  }

  for (const { path, value: defaultValue } of kernelLeafEntries(defaults)) {
    const segments = path.split(".");
    const defaultHash = hashKernelValue(defaultValue);

    // Per-tool merge over a stored builtin array (a missing array falls through to the
    // scalar branch below via the `tools.builtin` group write).
    if (segments[0] === "tools" && segments[1] === "builtin" && mergedTools !== null) {
      const name = segments[2]!;
      const index = mergedTools.findIndex(
        (entry) => isPlainObject(entry) && entry["name"] === name,
      );
      if (index === -1) {
        // Absent from a present array: a deliberate removal is preserved; only a tool that
        // is new in the latest generation (so this config could never have carried it) is
        // appended.
        if (newInLatestGeneration(path)) {
          mergedTools.push(defaultValue);
          toolsChanged = true;
          advanced.push(path);
        } else {
          kept.push(path);
        }
        continue;
      }
      const storedHash = hashKernelValue(mergedTools[index]);
      if (storedHash === defaultHash) continue;
      if (historicalHashes(path).has(storedHash)) {
        mergedTools[index] = defaultValue;
        toolsChanged = true;
        advanced.push(path);
      } else {
        kept.push(path);
      }
      continue;
    }

    const storedValue =
      segments[0] === "tools" && segments[1] === "builtin"
        ? undefined // no stored array: every default tool is materialized below
        : getAtPath(stored, segments);
    if (storedValue === undefined) {
      if (segments[0] === "tools" && segments[1] === "builtin") {
        // Materialize the whole default array once (per-tool reporting keeps the result
        // granular); repeated leaves only report, the single setIn happens after the loop.
        toolsChanged = true;
        advanced.push(path);
        continue;
      }
      setDeep(segments, defaultValue);
      advanced.push(path);
      continue;
    }
    const storedHash = hashKernelValue(storedValue);
    if (storedHash === defaultHash) continue;
    if (historicalHashes(path).has(storedHash)) {
      setDeep(segments, defaultValue);
      advanced.push(path);
    } else {
      kept.push(path);
    }
  }

  if (toolsChanged) {
    setDeep(["tools", "builtin"], mergedTools ?? defaultTools);
  }
  doc.setIn(["kernel_version"], KERNEL_VERSION);
  await atomicWriteFile(configPath, doc.toString(), { followSymlinks: true });
  return { advanced, kept, kernelVersion: KERNEL_VERSION };
}
